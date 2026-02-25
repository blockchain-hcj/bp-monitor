import os from "node:os";
import { RuntimeConfig } from "./types.js";

function parseSymbols(raw: string | undefined): string[] {
  if (!raw) {
    return ["BTCUSDT", "ETHUSDT"];
  }
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function parseIntEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer env ${name}=${value}`);
  }
  return parsed;
}

function parseFloatEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid float env ${name}=${value}`);
  }
  return parsed;
}

export function loadConfig(): RuntimeConfig {
  const cpuCount = Math.max(1, os.cpus().length - 1);
  return {
    nodeId: process.env.NODE_ID ?? `node-${process.pid}`,
    logLevel: (process.env.LOG_LEVEL as RuntimeConfig["logLevel"]) ?? "info",
    marketType: "usdt_perp",
    symbols: parseSymbols(process.env.SYMBOLS),
    staleMsLimit: parseIntEnv("STALE_MS_LIMIT", 1500),
    workerCount: parseIntEnv("WORKER_COUNT", cpuCount),
    controlPort: parseIntEnv("CONTROL_PORT", 18080),
    natsUrl: process.env.NATS_URL ?? "nats://127.0.0.1:4222",
    natsStream: process.env.NATS_STREAM ?? "SPREAD_EVENTS",
    natsSubjectPrefix: process.env.NATS_SUBJECT_PREFIX ?? "spread",
    postgresUrl: process.env.POSTGRES_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/monitors",
    publishTimeoutMs: parseIntEnv("PUBLISH_TIMEOUT_MS", 200),
    publishRetries: parseIntEnv("PUBLISH_RETRIES", 2),
    dbInsertTimeoutMs: parseIntEnv("DB_INSERT_TIMEOUT_MS", 300),
    dbSampleIntervalMs: parseIntEnv("DB_SAMPLE_INTERVAL_MS", 1_000),
    dbRetentionDays: parseIntEnv("DB_RETENTION_DAYS", 7),
    dbRetentionCleanupIntervalMs: parseIntEnv("DB_RETENTION_CLEANUP_INTERVAL_MS", 3_600_000),
    thresholds: {
      minBpsAbs: parseFloatEnv("MIN_BPS_ABS", 0)
    }
  };
}
