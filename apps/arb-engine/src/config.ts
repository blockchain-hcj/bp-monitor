import { RuntimeConfig, StrategyThresholds, SymbolThresholdConfig } from "./types.js";

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid integer env ${name}=${raw}`);
  }
  return value;
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid float env ${name}=${raw}`);
  }
  return value;
}

function parseSymbols(raw: string | undefined): string[] {
  if (!raw) {
    return ["BTCUSDT", "ETHUSDT"];
  }
  return raw
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
}

function parseOkxCtValOverrides(raw: string | undefined): Record<string, number> {
  if (!raw) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) {
      continue;
    }
    const [symbolRaw, valueRaw] = entry.split(":").map((v) => v.trim());
    if (!symbolRaw || !valueRaw) {
      throw new Error(`Invalid OKX_CTVAL_OVERRIDES entry: ${entry}`);
    }
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid OKX_CTVAL_OVERRIDES value: ${entry}`);
    }
    out[symbolRaw.toUpperCase()] = value;
  }
  return out;
}

function normalizeThresholds(symbols: string[], raw: string | undefined): StrategyThresholds {
  const defaultThreshold: SymbolThresholdConfig = {
    binance_to_okx: { open_bps: 12, close_bps: 5 },
    okx_to_binance: { open_bps: 12, close_bps: 5 }
  };

  if (!raw) {
    return Object.fromEntries(symbols.map((s) => [s, defaultThreshold]));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid ARB_THRESHOLDS_JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("ARB_THRESHOLDS_JSON must be an object");
  }

  const source = parsed as Record<string, unknown>;
  const out: StrategyThresholds = {};

  for (const symbol of symbols) {
    const entry = source[symbol] as Record<string, unknown> | undefined;
    if (!entry) {
      out[symbol] = defaultThreshold;
      continue;
    }

    const a = entry.binance_to_okx as Record<string, unknown> | undefined;
    const b = entry.okx_to_binance as Record<string, unknown> | undefined;

    const openA = Number(a?.open_bps);
    const closeA = Number(a?.close_bps);
    const openB = Number(b?.open_bps);
    const closeB = Number(b?.close_bps);

    if (![openA, closeA, openB, closeB].every(Number.isFinite)) {
      throw new Error(`Invalid threshold values for symbol ${symbol}`);
    }
    if (openA <= closeA || openB <= closeB) {
      throw new Error(`open_bps must be > close_bps for symbol ${symbol}`);
    }

    out[symbol] = {
      binance_to_okx: { open_bps: openA, close_bps: closeA },
      okx_to_binance: { open_bps: openB, close_bps: closeB }
    };
  }

  return out;
}

export function loadConfig(): RuntimeConfig {
  const symbols = parseSymbols(process.env.ARB_SYMBOLS);
  return {
    logLevel: (process.env.LOG_LEVEL as RuntimeConfig["logLevel"]) ?? "info",
    controlPort: parseIntEnv("CONTROL_PORT", 18180),
    natsUrl: process.env.NATS_URL ?? "nats://127.0.0.1:4222",
    natsSubjectPrefix: process.env.NATS_SUBJECT_PREFIX ?? "spread",
    tradeMode: (process.env.TRADE_MODE as RuntimeConfig["tradeMode"]) ?? "paper",
    reconcileIntervalMs: parseIntEnv("ARB_RECONCILE_INTERVAL_MS", 5000),
    strategy: {
      symbols,
      thresholds: normalizeThresholds(symbols, process.env.ARB_THRESHOLDS_JSON),
      fee_bps: parseFloatEnv("ARB_DEFAULT_FEE_BPS", 4),
      slippage_bps: parseFloatEnv("ARB_DEFAULT_SLIPPAGE_BPS", 2),
      notional_usdt: parseFloatEnv("ARB_NOTIONAL_USDT", 100),
      event_stale_ms: parseIntEnv("ARB_EVENT_STALE_MS", 3000)
    },
    okxApiKey: process.env.OKX_API_KEY?.trim(),
    okxApiSecret: process.env.OKX_API_SECRET?.trim(),
    okxApiPassphrase: process.env.OKX_API_PASSPHRASE?.trim(),
    okxCtValOverrides: parseOkxCtValOverrides(process.env.OKX_CTVAL_OVERRIDES),
    bnApiKey: process.env.BN_API_KEY?.trim(),
    bnApiSecret: process.env.BN_API_SECRET?.trim()
  };
}

export function setSymbols(config: RuntimeConfig, symbols: string[]): void {
  const next = symbols.map((s) => s.toUpperCase());
  config.strategy.symbols = next;
  config.strategy.thresholds = normalizeThresholds(next, JSON.stringify(config.strategy.thresholds));
}

export function setThresholds(config: RuntimeConfig, thresholds: StrategyThresholds): void {
  config.strategy.thresholds = normalizeThresholds(config.strategy.symbols, JSON.stringify(thresholds));
}
