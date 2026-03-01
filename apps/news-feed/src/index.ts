import http from "node:http";
import { AlertClient, AlertInput, AlertSeverity } from "alert-sdk";
import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { BweNewsSource } from "./sources/bweNews.js";
import { DataSource, NewsEvent } from "./types.js";

const CRITICAL_KEYWORDS = ["hack", "exploit", "rug", "emergency", "halt", "suspend"];
const WARN_KEYWORDS = ["delist", "maintenance", "delay", "issue", "vulnerability"];

function classifySeverity(title: string): AlertSeverity {
  const lower = title.toLowerCase();
  if (CRITICAL_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return "critical";
  }
  if (WARN_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return "warn";
  }
  return "info";
}

function shouldPushByWatchCoins(eventCoins: string[], watchCoins: Set<string>): boolean {
  if (watchCoins.size === 0) {
    return true;
  }
  if (eventCoins.length === 0) {
    // Do not silently drop macro/news alerts when symbol extraction is missing.
    return true;
  }
  return eventCoins.some((coin) => watchCoins.has(coin.toUpperCase()));
}

function toAlertInput(event: NewsEvent): AlertInput {
  const sourceName = event.sourceName.trim().toLowerCase() || "unknown";
  return {
    severity: classifySeverity(event.title),
    source: `news:${sourceName}`,
    group: "news",
    title: event.title,
    body: event.url || event.body,
    meta: {
      coins: event.coins,
      url: event.url,
      source_ts: event.timestamp,
      raw: event.raw
    }
  };
}

async function closeHttpServer(server: http.Server, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      resolve();
    }, timeoutMs);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const alertClient = new AlertClient({
    hubUrl: config.alertHubUrl,
    source: "news-feed"
  });

  const sources: DataSource[] = [];
  if (config.bweNewsEnabled) {
    sources.push(
      new BweNewsSource({
        wsUrl: config.bweNewsWsUrl,
        httpUrl: config.bweNewsHttpUrl,
        httpFallbackEnabled: config.bweNewsHttpFallbackEnabled,
        httpPollMs: config.bweNewsHttpPollMs,
        wsStaleMs: config.bweNewsWsStaleMs
      })
    );
  }

  for (const source of sources) {
    source.onEvent = (event) => {
      if (!shouldPushByWatchCoins(event.coins, config.watchCoins)) {
        return;
      }
      alertClient.fire(toAlertInput(event));
    };
    source.start();
  }

  const startedAtMs = Date.now();
  const healthServer = await startHealthServer({
    host: config.host,
    port: config.controlPort,
    startedAtMs,
    getSourcesHealth: () => sources.map((source) => source.health())
  });

  console.log(
    `[news-feed] started control=${config.host}:${config.controlPort} alert_hub=${config.alertHubUrl} watch_coins=${config.watchCoins.size ? Array.from(config.watchCoins).join(",") : "ALL"} sources=${sources.map((s) => s.name).join(",") || "none"}`
  );

  let shuttingDown = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      process.exit(1);
      return;
    }
    shuttingDown = true;
    console.log(`[news-feed] ${signal} received, shutting down...`);

    try {
      await Promise.all([
        Promise.all(sources.map((source) => source.close())),
        closeHttpServer(healthServer, 1_500)
      ]);
      console.log("[news-feed] shutdown complete");
      process.exit(0);
    } catch (error) {
      console.error("[news-feed] shutdown failed", error instanceof Error ? error.message : String(error));
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
