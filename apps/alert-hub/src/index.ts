import { loadConfig } from "./config.js";
import { HubWsServer } from "./broadcast/wsServer.js";
import { normalizeAlertPayload } from "./ingest/httpIngest.js";
import { startNatsIngest } from "./ingest/natsIngest.js";
import { AlertStore } from "./store/alertStore.js";
import { startHttpServer } from "./control/httpServer.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out in ${timeoutMs}ms`)), timeoutMs);
    timer.unref();
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function closeHttpServer(server: import("node:http").Server, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Force close sockets if graceful close stalls.
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      resolve();
    }, timeoutMs);
    timer.unref();

    server.close((err) => {
      clearTimeout(timer);
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new AlertStore(config.ringSize);
  const wsServer = new HubWsServer(config.wsPath, () => store.list({ limit: config.ringSize }));

  const ingestPayload = (payload: unknown): { alertId: string; deduped: boolean } => {
    const alert = normalizeAlertPayload(payload);
    const result = store.upsert(alert);
    if (result.isNew) {
      wsServer.broadcastAlert(result.alert);
    }
    return {
      alertId: result.alert.id,
      deduped: !result.isNew
    };
  };

  const server = await startHttpServer({
    config,
    store,
    wsServer,
    ingestPayload
  });

  const natsIngest = await startNatsIngest({
    enabled: config.natsEnabled,
    natsUrl: config.natsUrl,
    subject: config.natsSubject,
    onPayload: (payload) => {
      try {
        ingestPayload(payload);
      } catch (error) {
        console.error("[alert-hub][nats] ingest failed", error instanceof Error ? error.message : String(error));
      }
    }
  });

  console.log(
    `[alert-hub] started http=${config.host}:${config.port} ws=${config.wsPath} ring=${config.ringSize} nats=${config.natsEnabled ? "on" : "off"}`
  );

  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      console.warn("[alert-hub] force exit on repeated signal");
      process.exit(1);
      return;
    }
    shuttingDown = true;
    console.log(`[alert-hub] ${signal} received, shutting down...`);

    try {
      await withTimeout(Promise.all([natsIngest.close(), wsServer.close(), closeHttpServer(server, 1_500)]), 4_000, "shutdown");
      console.log("[alert-hub] shutdown complete");
      process.exit(0);
    } catch (error) {
      console.error("[alert-hub] shutdown timeout, forcing exit", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
