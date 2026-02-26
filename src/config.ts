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

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean env ${name}=${value}`);
}

function parseDeepbookPoolMap(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return { SUIUSDT: "SUI_USDC" };
  }
  const entries = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbolRaw, poolRaw] = entry.split(":").map((v) => v.trim());
      if (!symbolRaw || !poolRaw) {
        throw new Error(`Invalid DEEPBOOK_POOL_MAP entry: ${entry}`);
      }
      return [symbolRaw.toUpperCase(), poolRaw] as const;
    });
  return Object.fromEntries(entries);
}

export function loadConfig(): RuntimeConfig {
  const cpuCount = Math.max(1, os.cpus().length - 1);
  return {
    nodeId: process.env.NODE_ID ?? `node-${process.pid}`,
    logLevel: (process.env.LOG_LEVEL as RuntimeConfig["logLevel"]) ?? "info",
    marketType: "usdt_perp",
    symbols: parseSymbols(process.env.SYMBOLS),
    symbolDiscovery: {
      enabled: parseBoolEnv("SYMBOL_DISCOVERY_ENABLED", true),
      refreshIntervalMs: parseIntEnv("SYMBOL_DISCOVERY_REFRESH_MS", 300_000),
      binanceExchangeInfoUrl: process.env.BINANCE_EXCHANGE_INFO_URL ?? "https://fapi.binance.com/fapi/v1/exchangeInfo",
      okxInstrumentsUrl:
        process.env.OKX_INSTRUMENTS_URL ?? "https://www.okx.com/api/v5/public/instruments?instType=SWAP"
    },
    universe: {
      coreMaxSymbols: parseIntEnv("CORE_MAX_SYMBOLS", 40),
      watchScanIntervalMs: parseIntEnv("WATCH_SCAN_INTERVAL_MS", 15_000)
    },
    basisCandidate: {
      feeBps: parseFloatEnv("BASIS_FEE_BPS", 4),
      slippageBps: parseFloatEnv("BASIS_SLIPPAGE_BPS", 2),
      stableWindowMs: parseIntEnv("BASIS_STABLE_WINDOW_MS", 600_000),
      stableBinSizeBps: parseFloatEnv("BASIS_STABLE_BIN_SIZE_BPS", 2),
      stableMinBandWidthBps: parseFloatEnv("BASIS_STABLE_MIN_BAND_WIDTH_BPS", 20),
      stableMinHitRatio: parseFloatEnv("BASIS_STABLE_MIN_HIT_RATIO", 0.65),
      stableMaxBandStdBps: parseFloatEnv("BASIS_STABLE_MAX_BAND_STD_BPS", 8),
      spikeAbsNetBps: parseFloatEnv("BASIS_SPIKE_ABS_NET_BPS", 35),
      spikeDelta1mBps: parseFloatEnv("BASIS_SPIKE_DELTA_1M_BPS", 15)
    },
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
    deepbook: {
      enabled: parseBoolEnv("DEEPBOOK_ENABLED", false),
      network: (process.env.DEEPBOOK_NETWORK as "mainnet" | "testnet") ?? "mainnet",
      rpcUrl: process.env.DEEPBOOK_RPC_URL?.trim() || "https://fullnode.mainnet.sui.io:443",
      address: process.env.DEEPBOOK_ADDRESS ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
      pollIntervalMs: parseIntEnv("DEEPBOOK_POLL_INTERVAL_MS", 1000),
      symbolPoolMap: parseDeepbookPoolMap(process.env.DEEPBOOK_POOL_MAP)
    },
    thresholds: {
      minBpsAbs: parseFloatEnv("MIN_BPS_ABS", 0)
    }
  };
}
