import { parentPort, workerData } from "node:worker_threads";
import { BinanceConnector } from "../connectors/binanceConnector.js";
import { OkxConnector } from "../connectors/okxConnector.js";
import { TopOfBookStore } from "../ingestor/topOfBookStore.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { NatsEventPublisher } from "../publisher/natsPublisher.js";
import { DefaultSpreadCalculator } from "../spread/spreadCalculator.js";
import { PostgresSpreadRepository } from "../storage/postgresRepository.js";
import {
  MainToWorkerMessage,
  OrderbookDelta,
  RuntimeConfig,
  SpreadEvent,
  WorkerConfigUpdateMessage,
  WorkerToMainMessage
} from "../types.js";
import { Logger } from "../utils/logger.js";
import { TaskLimiter } from "../utils/taskLimiter.js";

interface WorkerData {
  workerId: number;
  symbols: string[];
  config: RuntimeConfig;
}

class MonitorWorkerService {
  private readonly workerId: number;
  private readonly logger: Logger;
  private readonly metrics = new MetricsRegistry();
  private readonly topStore = new TopOfBookStore();
  private readonly calc = new DefaultSpreadCalculator();
  private readonly publisher: NatsEventPublisher;
  private readonly repo: PostgresSpreadRepository;
  private readonly binance = new BinanceConnector();
  private readonly okx = new OkxConnector();
  private readonly limiter = new TaskLimiter(2000);
  private symbols: string[];
  private thresholds: RuntimeConfig["thresholds"];
  private running = false;
  private config: RuntimeConfig;
  private lastEventAtMs = 0;
  private readonly snapshotInFlight = new Set<string>();
  private readonly persistedDbBucketBySymbol = new Map<string, number>();
  private retentionCleanupInFlight = false;

  constructor(params: WorkerData) {
    this.workerId = params.workerId;
    this.config = params.config;
    this.symbols = params.symbols;
    this.thresholds = params.config.thresholds;
    this.publisher = new NatsEventPublisher(params.config);
    this.repo = new PostgresSpreadRepository(params.config);
    this.logger = new Logger(params.config.logLevel, `worker-${this.workerId}`);
  }

  async start(): Promise<void> {
    this.running = true;
    await this.publisher.init();
    await this.repo.init();

    this.runConnector("binance");
    this.runConnector("okx");

    setInterval(() => this.emitHealth(), 1000).unref();
    if (this.config.dbRetentionDays > 0 && this.config.dbRetentionCleanupIntervalMs > 0) {
      setInterval(
        () => {
          void this.runRetentionCleanup();
        },
        Math.max(60_000, this.config.dbRetentionCleanupIntervalMs)
      ).unref();
      void this.runRetentionCleanup();
    }
    this.emit({ type: "ready", workerId: this.workerId });
  }

  async stop(): Promise<void> {
    this.running = false;
    await Promise.all([this.binance.close(), this.okx.close()]);
    await Promise.all([this.publisher.close(), this.repo.close()]);
  }

  async applyConfig(update: WorkerConfigUpdateMessage): Promise<void> {
    if (update.thresholds) {
      this.thresholds = update.thresholds;
    }

    if (update.symbols) {
      this.symbols = update.symbols;
      this.trimDbSamplingState();
      await Promise.all([this.binance.close(), this.okx.close()]);
      if (this.running) {
        this.runConnector("binance");
        this.runConnector("okx");
      }
    }
  }

  private runConnector(exchange: "binance" | "okx"): void {
    if (this.symbols.length === 0) {
      return;
    }
    const stream = exchange === "binance" ? this.binance.connect(this.symbols) : this.okx.connect(this.symbols);
    void (async () => {
      try {
        for await (const delta of stream) {
          if (!this.running) {
            break;
          }
          await this.handleDelta(delta);
        }
      } catch (error) {
        this.logger.error("connector stream failed", {
          exchange,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    })();
  }

  private async handleDelta(delta: OrderbookDelta): Promise<void> {
    const top = this.topStore.upsert(delta, this.config.staleMsLimit);
    if (top.qualityFlag.includes("seq_gap")) {
      this.metrics.incCounter("spread_seq_gap_total");
      await this.recoverSnapshot(delta);
    }

    const binanceTop = this.topStore.get("binance", delta.symbol);
    const okxTop = this.topStore.get("okx", delta.symbol);
    if (!binanceTop || !okxTop) {
      return;
    }

    const event = this.calc.compute(binanceTop, okxTop);
    const minBpsAbs = Math.max(0, this.thresholds.minBpsAbs);
    if (Math.abs(event.bps_a_to_b) < minBpsAbs && Math.abs(event.bps_b_to_a) < minBpsAbs) {
      return;
    }

    event.ts_publish = Date.now();
    const dbPersistPlan = this.planDbPersist(event);
    if (!dbPersistPlan.persist) {
      this.metrics.incCounter("spread_db_sampled_drop_total");
    }
    const accepted = this.limiter.tryRun(async () => {
      const start = Date.now();
      try {
        const dbInsertPromise = dbPersistPlan.persist ? this.repo.insert(event) : Promise.resolve();
        await Promise.all([this.publisher.publishSpread(event), dbInsertPromise]);
        this.lastEventAtMs = Date.now();
        this.metrics.incCounter("spread_event_published_total");
        this.metrics.observe("spread_e2e_latency_ms", this.lastEventAtMs - event.ts_ingest);
      } catch (error) {
        if (dbPersistPlan.persist && dbPersistPlan.bucket !== null) {
          const currentBucket = this.persistedDbBucketBySymbol.get(event.symbol);
          if (currentBucket === dbPersistPlan.bucket) {
            this.persistedDbBucketBySymbol.delete(event.symbol);
          }
        }
        this.metrics.incCounter("spread_event_publish_error_total");
        this.logger.error("event pipeline failed", {
          symbol: event.symbol,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        this.metrics.observe("spread_pipeline_duration_ms", Date.now() - start);
      }
    });

    if (!accepted) {
      if (dbPersistPlan.persist && dbPersistPlan.bucket !== null) {
        const currentBucket = this.persistedDbBucketBySymbol.get(event.symbol);
        if (currentBucket === dbPersistPlan.bucket) {
          this.persistedDbBucketBySymbol.delete(event.symbol);
        }
      }
      this.metrics.incCounter("spread_backpressure_drop_total");
    }
  }

  private planDbPersist(event: SpreadEvent): { persist: boolean; bucket: number | null } {
    const sampleIntervalMs = Math.max(0, this.config.dbSampleIntervalMs);
    if (sampleIntervalMs <= 1) {
      return { persist: true, bucket: null };
    }

    const bucket = Math.floor(event.ts_ingest / sampleIntervalMs);
    const previousBucket = this.persistedDbBucketBySymbol.get(event.symbol);
    if (previousBucket === bucket) {
      return { persist: false, bucket };
    }
    this.persistedDbBucketBySymbol.set(event.symbol, bucket);
    return { persist: true, bucket };
  }

  private trimDbSamplingState(): void {
    const activeSymbols = new Set(this.symbols);
    for (const symbol of this.persistedDbBucketBySymbol.keys()) {
      if (!activeSymbols.has(symbol)) {
        this.persistedDbBucketBySymbol.delete(symbol);
      }
    }
  }

  private async runRetentionCleanup(): Promise<void> {
    if (this.retentionCleanupInFlight) {
      return;
    }
    const retentionDays = Math.max(0, this.config.dbRetentionDays);
    if (retentionDays <= 0) {
      return;
    }
    this.retentionCleanupInFlight = true;
    try {
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const deleted = await this.repo.purgeOlderThan(cutoffMs);
      if (deleted > 0) {
        this.metrics.incCounter("spread_db_retention_deleted_total", deleted);
        this.logger.info("db retention cleanup completed", { deleted, retentionDays });
      }
    } catch (error) {
      this.metrics.incCounter("spread_db_retention_error_total");
      this.logger.error("db retention cleanup failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.retentionCleanupInFlight = false;
    }
  }

  private async recoverSnapshot(delta: OrderbookDelta): Promise<void> {
    const key = `${delta.exchange}:${delta.symbol}`;
    if (this.snapshotInFlight.has(key)) {
      return;
    }
    this.snapshotInFlight.add(key);
    try {
      const snapshot =
        delta.exchange === "binance"
          ? await this.binance.snapshot(delta.symbol)
          : await this.okx.snapshot(delta.symbol);
      this.topStore.upsert(
        {
          exchange: snapshot.exchange,
          symbol: snapshot.symbol,
          tsExchangeMs: snapshot.tsExchangeMs,
          tsIngestMs: Date.now(),
          bid: snapshot.bid,
          ask: snapshot.ask,
          seq: snapshot.seq
        },
        this.config.staleMsLimit
      );
      this.metrics.incCounter("spread_snapshot_recover_total");
    } catch (error) {
      this.metrics.incCounter("spread_snapshot_recover_error_total");
      this.logger.error("snapshot recovery failed", {
        exchange: delta.exchange,
        symbol: delta.symbol,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.snapshotInFlight.delete(key);
    }
  }

  private emitHealth(): void {
    const health = {
      type: "health" as const,
      workerId: this.workerId,
      connected: this.binance.health().connected && this.okx.health().connected,
      lastEventAtMs: this.lastEventAtMs,
      symbols: this.symbols,
      error: this.binance.health().lastError ?? this.okx.health().lastError
    };
    this.emit(health);

    const inflight = this.limiter.inflight();
    this.emit({ type: "metric", workerId: this.workerId, metric: "spread_worker_inflight", value: inflight });
  }

  metricsSnapshot(): string {
    return this.metrics.renderPrometheus();
  }

  private emit(message: WorkerToMainMessage): void {
    parentPort?.postMessage(message);
  }
}

const params = workerData as WorkerData;
const service = new MonitorWorkerService(params);

parentPort?.on("message", async (msg: MainToWorkerMessage) => {
  if (msg.type === "update-config") {
    await service.applyConfig(msg);
  }
});

void service.start();

process.on("SIGINT", async () => {
  await service.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await service.stop();
  process.exit(0);
});
