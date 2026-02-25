export type Exchange = "binance" | "okx";
export type TradeMode = "paper" | "live";
export type RiskMode = "normal" | "close_only";
export type Direction = "binance_to_okx" | "okx_to_binance";
export type IntentAction = "open" | "close";
export type LegSide = "buy" | "sell";

export interface SpreadEvent {
  symbol: string;
  exchange_a: string;
  exchange_b: string;
  bps_a_to_b: number;
  bps_b_to_a: number;
  ts_ingest: number;
  quality_flag: string[];
}

export interface ArbInputEvent {
  symbol: string;
  exchange_a: Exchange;
  exchange_b: Exchange;
  bps_a_to_b: number;
  bps_b_to_a: number;
  bps_binance_to_okx: number;
  bps_okx_to_binance: number;
  ts_ingest: number;
  quality_flag: string[];
}

export interface ThresholdPair {
  open_bps: number;
  close_bps: number;
}

export interface SymbolThresholdConfig {
  binance_to_okx: ThresholdPair;
  okx_to_binance: ThresholdPair;
}

export type StrategyThresholds = Record<string, SymbolThresholdConfig>;

export interface StrategyConfig {
  symbols: string[];
  thresholds: StrategyThresholds;
  fee_bps: number;
  slippage_bps: number;
  notional_usdt: number;
  event_stale_ms: number;
}

export interface RuntimeConfig {
  logLevel: "debug" | "info" | "warn" | "error";
  controlPort: number;
  natsUrl: string;
  natsSubjectPrefix: string;
  tradeMode: TradeMode;
  reconcileIntervalMs: number;
  strategy: StrategyConfig;
  okxApiKey?: string;
  okxApiSecret?: string;
  okxApiPassphrase?: string;
  okxCtValOverrides: Record<string, number>;
  bnApiKey?: string;
  bnApiSecret?: string;
}

export interface PositionLeg {
  exchange: Exchange;
  side: LegSide;
  notional_usdt: number;
}

export interface PositionState {
  symbol: string;
  direction: Direction;
  isOpen: boolean;
  openedAtMs?: number;
  lastNetBps?: number;
  reason?: string;
}

export interface ExecutionLeg {
  exchange: Exchange;
  side: LegSide;
  symbol: string;
  notional_usdt: number;
  reduce_only: boolean;
}

export interface ExecutionIntent {
  action: IntentAction;
  symbol: string;
  direction: Direction;
  reason: string;
  raw_bps: number;
  net_bps: number;
  legs: ExecutionLeg[];
  ts: number;
}

export interface DirectionSnapshot {
  direction: Direction;
  isOpen: boolean;
  raw_bps: number;
  net_bps: number;
  open_bps: number;
  close_bps: number;
  gap_to_open_bps: number;
  gap_to_close_bps: number;
  can_open_now: boolean;
  should_close_now: boolean;
}

export interface ExecutionResultLeg {
  exchange: Exchange;
  ok: boolean;
  orderId?: string;
  error?: string;
}

export interface ExecutionResult {
  ok: boolean;
  partialFill: boolean;
  legs: ExecutionResultLeg[];
  mode: TradeMode;
}

export interface ExchangePosition {
  symbol: string;
  longNotionalUsdt: number;
  shortNotionalUsdt: number;
}

export interface ExchangeExecutionClient {
  name(): Exchange;
  normalizeBaseQty(symbol: string, baseQty: number): Promise<number>;
  placeMarketIocOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }>;
  getPosition(symbol: string): Promise<ExchangePosition>;
}

export interface HealthState {
  ready: boolean;
  lastEventAtMs: number;
  lastError?: string;
}
