export type Exchange = "binance" | "okx";
export type TradeMode = "paper" | "live";
export type RiskMode = "normal" | "close_only";
export type Direction = "binance_to_okx" | "okx_to_binance";
export type IntentAction = "open" | "close";
export type LegSide = "buy" | "sell";
export type TimeInForce = "GTC" | "IOC";
export type OrderStatus = "new" | "partial" | "filled" | "canceled" | "rejected";

export interface SpreadEvent {
  symbol: string;
  exchange_a: string;
  exchange_b: string;
  best_bid_a: number;
  best_ask_a: number;
  best_bid_b: number;
  best_ask_b: number;
  bps_a_to_b: number;
  bps_b_to_a: number;
  ts_ingest: number;
  ts_publish: number;
  quality_flag: string[];
}

export interface ArbInputEvent {
  symbol: string;
  exchange_a: Exchange;
  exchange_b: Exchange;
  best_bid_a: number;
  best_ask_a: number;
  best_bid_b: number;
  best_ask_b: number;
  best_bid_binance: number;
  best_ask_binance: number;
  best_bid_okx: number;
  best_ask_okx: number;
  bps_a_to_b: number;
  bps_b_to_a: number;
  bps_binance_to_okx: number;
  bps_okx_to_binance: number;
  ts_ingest: number;
  ts_publish: number;
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
  status?: OrderStatus;
  filledQty?: number;
  avgPrice?: number;
  error?: string;
}

export interface ExecutionResult {
  ok: boolean;
  partialFill: boolean;
  status: OrderStatus;
  filledQty: number;
  avgPrice: number;
  legs: ExecutionResultLeg[];
  mode: TradeMode;
}

export interface OrderAck {
  orderId: string;
}

export interface OrderState {
  orderId: string;
  status: OrderStatus;
  filledQty: number;
  avgPrice: number;
}

export interface ExchangePosition {
  symbol: string;
  longNotionalUsdt: number;
  shortNotionalUsdt: number;
}

export interface ExchangeExecutionClient {
  name(): Exchange;
  normalizeBaseQty(symbol: string, baseQty: number): Promise<number>;
  normalizeLimitPrice(symbol: string, side: LegSide, rawPrice: number): Promise<number>;
  placeMarketIocOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<OrderAck>;
  placeLimitOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    price: number,
    reduceOnly: boolean,
    tif: TimeInForce
  ): Promise<OrderAck>;
  getOrderStatus(symbol: string, orderId: string): Promise<OrderState>;
  cancelOrder(symbol: string, orderId: string): Promise<{ ok: boolean }>;
  getPosition(symbol: string): Promise<ExchangePosition>;
}

export interface HealthState {
  ready: boolean;
  lastEventAtMs: number;
  lastError?: string;
}
