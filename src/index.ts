import os from "node:os";
import { Worker } from "node:worker_threads";
import { loadConfig } from "./config.js";
import { BasisCandidatesService } from "./control/basisCandidatesService.js";
import { BasisCandidatesQuery } from "./control/basisCandidatesService.js";
import { startHttpServer } from "./control/httpServer.js";
import { PostgresSpreadReadRepository } from "./control/spreadReadRepository.js";
import { SymbolDiscoveryService } from "./discovery/symbolDiscovery.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { BasisCandidateEngine } from "./strategy/basisCandidateEngine.js";
import { ThresholdConfig, WorkerToMainMessage } from "./types.js";
import { UniverseManager } from "./universe/universeManager.js";
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
  const basisEngine = new BasisCandidateEngine(config.basisCandidate);
  const basisService = new BasisCandidatesService(spreadReadRepo, basisEngine, config.basisCandidate.stableWindowMs);
  const discovery = new SymbolDiscoveryService(config.symbolDiscovery, config.symbols);
  const universeManager = new UniverseManager(config.universe);
  universeManager.updateDiscoveredSymbols(await discovery.refresh());

  let assignedSymbols = universeManager.getCoreSymbols();
  const desiredWorkers = Math.max(1, Math.min(config.workerCount, os.cpus().length, Math.max(1, assignedSymbols.length)));
  const workers = new Map<number, WorkerState>();
  const isTsRuntime = import.meta.url.endsWith(".ts");

  const workerScript = isTsRuntime
    ? new URL("./worker/monitorWorker.bootstrap.mjs", import.meta.url)
    : new URL("./worker/monitorWorker.js", import.meta.url);

  for (let workerId = 0; workerId < desiredWorkers; workerId += 1) {
    const shardSymbols = assignSymbols(assignedSymbols, desiredWorkers, workerId);
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

  const updateWorkerSymbols = (symbols: string[]) => {
    const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const next = normalized.length > 0 ? normalized : assignedSymbols;
    assignedSymbols = next;
    config.symbols = next;
    for (const w of workers.values()) {
      const workerSymbols = assignSymbols(next, workers.size, w.workerId);
      w.symbols = workerSymbols;
      w.worker.postMessage({ type: "update-config", symbols: workerSymbols });
    }
    metrics.incCounter("spread_config_symbols_update_total");
  };

  if (config.symbolDiscovery.enabled && config.symbolDiscovery.refreshIntervalMs > 0) {
    setInterval(
      () => {
        void (async () => {
          const discovered = await discovery.refresh();
          universeManager.updateDiscoveredSymbols(discovered);
          const nextCore = universeManager.getCoreSymbols();
          if (nextCore.join(",") !== assignedSymbols.join(",")) {
            updateWorkerSymbols(nextCore);
          }
        })();
      },
      Math.max(5_000, config.symbolDiscovery.refreshIntervalMs)
    ).unref();
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
    getSymbols: () => universeManager.getAllSymbols(),
    getSymbolPools: () => ({
      core: universeManager.getCoreSymbols(),
      watch: universeManager.getWatchSymbols()
    }),
    getBasisCandidates: async (query: BasisCandidatesQuery) =>
      basisService.listCandidates(query, {
        core: universeManager.getCoreSymbols(),
        watch: universeManager.getWatchSymbols()
      }),
    updateSymbols: (symbols: string[]) => {
      universeManager.updateDiscoveredSymbols(symbols);
      updateWorkerSymbols(universeManager.getCoreSymbols());
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
