import os from "node:os";
import { Worker } from "node:worker_threads";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./control/httpServer.js";
import { PostgresSpreadReadRepository } from "./control/spreadReadRepository.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { ThresholdConfig, WorkerToMainMessage } from "./types.js";
import { assignSymbols } from "./utils/hash.js";
import { Logger } from "./utils/logger.js";

interface WorkerState {
  workerId: number;
  worker: Worker;
  ready: boolean;
  lastHealthAtMs: number;
  connected: boolean;
  lastEventAtMs: number;
  symbols: string[];
  error?: string;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel, "main");
  const metrics = new MetricsRegistry();
  const spreadReadRepo = new PostgresSpreadReadRepository(config.postgresUrl);

  const desiredWorkers = Math.max(1, Math.min(config.workerCount, os.cpus().length, config.symbols.length));
  const workers = new Map<number, WorkerState>();
  const isTsRuntime = import.meta.url.endsWith(".ts");

  const workerScript = isTsRuntime
    ? new URL("./worker/monitorWorker.bootstrap.mjs", import.meta.url)
    : new URL("./worker/monitorWorker.js", import.meta.url);

  for (let workerId = 0; workerId < desiredWorkers; workerId += 1) {
    const shardSymbols = assignSymbols(config.symbols, desiredWorkers, workerId);
    const worker = new Worker(workerScript, {
      workerData: {
        workerId,
        symbols: shardSymbols,
        config
      },
      // Worker entry is bootstrap .mjs in dev, then imports .ts with tsx enabled.
      execArgv: isTsRuntime ? ["--import", "tsx"] : []
    });

    const state: WorkerState = {
      workerId,
      worker,
      ready: false,
      lastHealthAtMs: 0,
      connected: false,
      lastEventAtMs: 0,
      symbols: shardSymbols
    };
    workers.set(workerId, state);

    worker.on("message", (raw: WorkerToMainMessage) => {
      if (raw.type === "ready") {
        const current = workers.get(raw.workerId);
        if (current) {
          current.ready = true;
        }
        return;
      }

      if (raw.type === "health") {
        const current = workers.get(raw.workerId);
        if (!current) {
          return;
        }
        current.lastHealthAtMs = Date.now();
        current.connected = raw.connected;
        current.lastEventAtMs = raw.lastEventAtMs;
        current.symbols = raw.symbols;
        current.error = raw.error;
        return;
      }

      if (raw.type === "metric") {
        metrics.setGauge(`spread_${raw.metric}_worker_${raw.workerId}`, raw.value);
      }
    });

    worker.on("error", (error) => {
      logger.error("worker error", { workerId, error: error.message });
      metrics.incCounter("spread_worker_error_total");
    });

    worker.on("exit", (code) => {
      logger.warn("worker exited", { workerId, code });
      metrics.incCounter("spread_worker_exit_total");
    });
  }

  const state = {
    getHealth: () => {
      const healthWorkers = [...workers.values()].map((w) => ({
        workerId: w.workerId,
        ready: w.ready,
        connected: w.connected,
        lastHealthAtMs: w.lastHealthAtMs,
        lastEventAtMs: w.lastEventAtMs,
        symbols: w.symbols,
        error: w.error
      }));
      const allConnected = healthWorkers.every((w) => w.connected);
      return {
        ok: allConnected,
        workers: healthWorkers
      };
    },
    getReady: () => {
      const workersReady = [...workers.values()].filter((w) => w.ready).length;
      return {
        ready: workersReady === workers.size,
        workersReady,
        workersTotal: workers.size
      };
    },
    getMetrics: () => {
      metrics.setGauge("spread_workers_total", workers.size);
      metrics.setGauge("spread_workers_ready", [...workers.values()].filter((w) => w.ready).length);
      metrics.setGauge("spread_workers_connected", [...workers.values()].filter((w) => w.connected).length);
      return metrics.renderPrometheus();
    },
    getSymbols: () => [...config.symbols],
    updateSymbols: (symbols: string[]) => {
      config.symbols = symbols;
      for (const w of workers.values()) {
        const assigned = assignSymbols(symbols, workers.size, w.workerId);
        w.symbols = assigned;
        w.worker.postMessage({ type: "update-config", symbols: assigned });
      }
      metrics.incCounter("spread_config_symbols_update_total");
    },
    updateThresholds: (thresholds: ThresholdConfig) => {
      config.thresholds = thresholds;
      for (const w of workers.values()) {
        w.worker.postMessage({ type: "update-config", thresholds });
      }
      metrics.incCounter("spread_config_threshold_update_total");
    }
  };

  await startHttpServer(config.controlPort, state, spreadReadRepo);
  logger.info("control plane started", { port: config.controlPort, workers: workers.size });

  const shutdown = async () => {
    logger.info("shutdown started");
    await Promise.all([...workers.values()].map((w) => w.worker.terminate()));
    await spreadReadRepo.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
