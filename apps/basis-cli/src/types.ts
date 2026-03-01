export type Exchange = "binance" | "okx";
export type TradeMode = "paper" | "live";
export type Direction = "binance_to_okx" | "okx_to_binance";
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

export interface PriceSnapshot {
  binanceBid: number;
  binanceAsk: number;
  okxBid: number;
  okxAsk: number;
  bpsBinanceToOkx: number;
  bpsOkxToBinance: number;
  // Source-side event time (publish/ingest), used for market freshness.
  tsMs: number;
  // Local receive time, used for transport/consumer freshness.
  tsRecvMs: number;
}

export interface OrderState {
  orderId: string;
  status: OrderStatus;
  filledQty: number;
  avgPrice: number;
}

export interface OpenOrderState extends OrderState {
  side: LegSide;
  price: number;
  updateTimeMs: number;
}

export interface LegOrderState {
  exchange: Exchange;
  side: LegSide;
  orderId: string;
  limitPrice: number;
  status: OrderStatus;
  filledQty: number;
  avgPrice: number;
  placedAtMs: number;
  amendCount: number;
}

export type SessionPhase =
  | "IDLE"
  | "PLACING"
  | "MONITORING"
  | "FILLED"
  | "CANCELLED"
  | "TIMEOUT";

export interface SessionState {
  phase: SessionPhase;
  binanceLeg: LegOrderState | null;
  okxLeg: LegOrderState | null;
  logs: LogEntry[];
  natsConnected: boolean;
  priceStale: boolean;
}

export interface LogEntry {
  tsMs: number;
  text: string;
}

export interface CliConfig {
  symbol: string;
  direction: Direction;
  quantity: number;
  slippageBps: number;
  timeoutSec: number;
  mode: TradeMode;
  natsUrl: string;
  natsSubjectPrefix: string;
  okxApiKey?: string;
  okxApiSecret?: string;
  okxApiPassphrase?: string;
  bnApiKey?: string;
  bnApiSecret?: string;
  bnHedgeMode: "auto" | "hedge" | "oneway";
  feeBps: number;
}

export interface ExchangeClient {
  name(): Exchange;
  normalizeBaseQty(symbol: string, baseQty: number): Promise<number>;
  placeLimitOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    price: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }>;
  placeMarketOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }>;
  getOrderStatus(symbol: string, orderId: string): Promise<OrderState>;
  getOpenOrders(symbol: string): Promise<OpenOrderState[]>;
  cancelOrder(symbol: string, orderId: string): Promise<{ ok: boolean }>;
  getTickSize(symbol: string): Promise<number>;
  quantizePrice(price: number, symbol: string, side: LegSide): Promise<number>;
  getPosition(symbol: string): Promise<ExchangePosition>;
}

export interface LimitPrices {
  binancePrice: number;
  okxPrice: number;
}

export interface ExchangePosition {
  symbol: string;
  longQty: number;
  shortQty: number;
  longNotionalUsdt: number;
  shortNotionalUsdt: number;
  longAvgEntryPrice: number;
  shortAvgEntryPrice: number;
}

export type Screen = "SYMBOL_SELECT" | "DASHBOARD";

export interface AppState {
  screen: Screen;
  symbolList: string[];
  filteredSymbols: string[];
  searchInput: string;
  selectedIndex: number;
  symbol: string;
  direction: Direction;
  quantity: number;
  slippageBps: number;
  binancePosition: ExchangePosition | null;
  okxPosition: ExchangePosition | null;
  editingSlippage: boolean;
  slippageInput: string;
}
