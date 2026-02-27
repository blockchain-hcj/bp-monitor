import { parentPort, workerData } from "node:worker_threads";
import { BinanceConnector } from "../connectors/binanceConnector.js";
import { DeepbookConnector } from "../connectors/deepbookConnector.js";
import { OkxConnector } from "../connectors/okxConnector.js";
import { TopOfBookStore } from "../ingestor/topOfBookStore.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { NatsEventPublisher } from "../publisher/natsPublisher.js";
import { DefaultSpreadCalculator } from "../spread/spreadCalculator.js";
import { PostgresSpreadRepository } from "../storage/postgresRepository.js";
import {
  Exchange,
  ExchangeConnector,
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
  private readonly deepbook: DeepbookConnector;
  private readonly connectors: Record<Exchange, ExchangeConnector>;
  private readonly limiter = new TaskLimiter(2000);
  private readonly dbLimiter = new TaskLimiter(500);
  private symbols: string[];
  private thresholds: RuntimeConfig["thresholds"];
  private running = false;
  private config: RuntimeConfig;
  private lastEventAtMs = 0;
  private readonly snapshotInFlight = new Set<string>();
  private readonly persistedDbBucketByPair = new Map<string, number>();
  private retentionCleanupInFlight = false;

  constructor(params: WorkerData) {
    this.workerId = params.workerId;
    this.config = params.config;
    this.symbols = params.symbols;
    this.thresholds = params.config.thresholds;
    this.publisher = new NatsEventPublisher(params.config);
    this.repo = new PostgresSpreadRepository(params.config);
    this.logger = new Logger(params.config.logLevel, `worker-${this.workerId}`);
    this.deepbook = new DeepbookConnector(params.config.deepbook);
    this.connectors = {
      binance: this.binance,
      okx: this.okx,
      deepbook: this.deepbook
    };
  }

  async start(): Promise<void> {
    this.running = true;
    await this.publisher.init();
    await this.repo.init();

    for (const exchange of this.enabledExchanges()) {
      this.runConnector(exchange);
    }

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
    await Promise.all(this.enabledExchanges().map((exchange) => this.connectors[exchange].close()));
    await Promise.all([this.publisher.close(), this.repo.close()]);
  }

  async applyConfig(update: WorkerConfigUpdateMessage): Promise<void> {
    if (update.thresholds) {
      this.thresholds = update.thresholds;
    }

    if (update.symbols) {
      this.symbols = update.symbols;
      this.trimDbSamplingState();
      await Promise.all(this.enabledExchanges().map((exchange) => this.connectors[exchange].close()));
      if (this.running) {
        for (const exchange of this.enabledExchanges()) {
          this.runConnector(exchange);
        }
      }
    }
  }

  private enabledExchanges(): Exchange[] {
    return this.config.deepbook.enabled ? ["binance", "okx", "deepbook"] : ["binance", "okx"];
  }

  private runConnector(exchange: Exchange): void {
    if (this.symbols.length === 0) {
      return;
    }
    const stream = this.connectors[exchange].connect(this.symbols);
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
      // Snapshot recovery runs in background so high-frequency delta consumption is not blocked.
      void this.recoverSnapshot(delta);
    }

    const tops = this.enabledExchanges()
      .map((exchange) => this.topStore.get(exchange, delta.symbol))
      .filter((top): top is NonNullable<typeof top> => Boolean(top));
    if (tops.length < 2) {
      return;
    }

    for (let i = 0; i < tops.length - 1; i += 1) {
      for (let j = i + 1; j < tops.length; j += 1) {
        const event = this.calc.compute(tops[i], tops[j]);
        this.pipelineEvent(event);
      }
    }
  }

  private pipelineEvent(event: SpreadEvent): void {
    const minBpsAbs = Math.max(0, this.thresholds.minBpsAbs);
    if (Math.abs(event.bps_a_to_b) < minBpsAbs && Math.abs(event.bps_b_to_a) < minBpsAbs) {
      return;
    }
    event.ts_publish = Date.now();
    const dbPersistPlan = this.planDbPersist(event);
    if (!dbPersistPlan.persist) {
      this.metrics.incCounter("spread_db_sampled_drop_total");
    }

    // 1. NATS publish — fire-and-forget, not gated by any limiter
    try {
      if (this.publisher.publishSpreadFire) {
        this.publisher.publishSpreadFire(event);
      } else {
        void this.publisher.publishSpread(event);
      }
      this.lastEventAtMs = Date.now();
      this.metrics.incCounter("spread_event_published_total");
      this.metrics.observe("spread_e2e_latency_ms", this.lastEventAtMs - event.ts_ingest);
    } catch (error) {
      this.metrics.incCounter("spread_event_publish_error_total");
      this.logger.error("nats publish failed", {
        symbol: event.symbol,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 2. DB insert — independently gated by dbLimiter, failure does not affect NATS
    if (dbPersistPlan.persist) {
      const accepted = this.dbLimiter.tryRun(async () => {
        const start = Date.now();
        try {
          await this.repo.insert(event);
        } catch (error) {
          if (dbPersistPlan.bucket !== null && dbPersistPlan.key) {
            const currentBucket = this.persistedDbBucketByPair.get(dbPersistPlan.key);
            if (currentBucket === dbPersistPlan.bucket) {
              this.persistedDbBucketByPair.delete(dbPersistPlan.key);
            }
          }
          this.metrics.incCounter("spread_db_insert_error_total");
          this.logger.error("db insert failed", {
            symbol: event.symbol,
            error: error instanceof Error ? error.message : String(error)
          });
        } finally {
          this.metrics.observe("spread_pipeline_duration_ms", Date.now() - start);
        }
      });

      if (!accepted) {
        if (dbPersistPlan.bucket !== null && dbPersistPlan.key) {
          const currentBucket = this.persistedDbBucketByPair.get(dbPersistPlan.key);
          if (currentBucket === dbPersistPlan.bucket) {
            this.persistedDbBucketByPair.delete(dbPersistPlan.key);
          }
        }
        this.metrics.incCounter("spread_db_backpressure_drop_total");
      }
    }
  }

  private planDbPersist(event: SpreadEvent): { persist: boolean; bucket: number | null; key: string | null } {
    const sampleIntervalMs = Math.max(0, this.config.dbSampleIntervalMs);
    if (sampleIntervalMs <= 1) {
      return { persist: true, bucket: null, key: null };
    }

    const key = `${event.symbol}:${event.exchange_a}:${event.exchange_b}`;
    const bucket = Math.floor(event.ts_ingest / sampleIntervalMs);
    const previousBucket = this.persistedDbBucketByPair.get(key);
    if (previousBucket === bucket) {
      return { persist: false, bucket, key };
    }
    this.persistedDbBucketByPair.set(key, bucket);
    return { persist: true, bucket, key };
  }

  private trimDbSamplingState(): void {
    const activeSymbols = new Set(this.symbols);
    for (const key of this.persistedDbBucketByPair.keys()) {
      const symbol = key.split(":")[0];
      if (!activeSymbols.has(symbol)) {
        this.persistedDbBucketByPair.delete(key);
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
      const snapshot = await this.connectors[delta.exchange].snapshot(delta.symbol);
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
    const exchanges = this.enabledExchanges();
    const connectorHealth = exchanges.map((exchange) => this.connectors[exchange].health());
    const health = {
      type: "health" as const,
      workerId: this.workerId,
      connected: connectorHealth.every((item) => item.connected),
      lastEventAtMs: this.lastEventAtMs,
      symbols: this.symbols,
      error: connectorHealth.map((item) => item.lastError).find(Boolean)
    };
    this.emit(health);

    const inflight = this.limiter.inflight();
    this.emit({ type: "metric", workerId: this.workerId, metric: "spread_worker_inflight", value: inflight });
    const dbInflight = this.dbLimiter.inflight();
    this.emit({ type: "metric", workerId: this.workerId, metric: "spread_worker_db_inflight", value: dbInflight });
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
