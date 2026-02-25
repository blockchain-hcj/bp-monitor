export type Exchange = "binance" | "okx";
export type MarketType = "usdt_perp";

export interface OrderbookDelta {
  exchange: Exchange;
  symbol: string;
  tsExchangeMs: number;
  tsIngestMs: number;
  bid: number;
  ask: number;
  seq: number;
  prevSeq?: number;
}

export interface OrderbookSnapshot {
  exchange: Exchange;
  symbol: string;
  tsExchangeMs: number;
  bid: number;
  ask: number;
  seq: number;
}

export interface ConnectorHealth {
  exchange: Exchange;
  connected: boolean;
  reconnects: number;
  lastMessageAtMs: number;
  lastError?: string;
}

export interface ExchangeConnector {
  connect(symbols: string[]): AsyncIterable<OrderbookDelta>;
  snapshot(symbol: string): Promise<OrderbookSnapshot>;
  health(): ConnectorHealth;
  close(): Promise<void>;
}

export interface TopOfBook {
  exchange: Exchange;
  symbol: string;
  bid: number;
  ask: number;
  seq: number;
  tsExchangeMs: number;
  tsIngestMs: number;
  staleMs: number;
  qualityFlag: string[];
}

export interface SpreadEvent {
  schema_version: string;
  event_id: string;
  ts_exchange: number;
  ts_ingest: number;
  ts_publish: number;
  symbol: string;
  market_type: MarketType;
  exchange_a: Exchange;
  exchange_b: Exchange;
  best_bid_a: number;
  best_ask_a: number;
  best_bid_b: number;
  best_ask_b: number;
  bps_a_to_b: number;
  bps_b_to_a: number;
  seq_a: number;
  seq_b: number;
  staleness_ms_a: number;
  staleness_ms_b: number;
  quality_flag: string[];
}

export interface SpreadCalculator {
  compute(topA: TopOfBook, topB: TopOfBook): SpreadEvent;
}

export interface PublishAck {
  stream: string;
  seq: number;
}

export interface EventPublisher {
  publishSpread(event: SpreadEvent): Promise<PublishAck>;
  close(): Promise<void>;
}

export interface SpreadRepository {
  insert(event: SpreadEvent): Promise<void>;
  close(): Promise<void>;
}

export interface ThresholdConfig {
  minBpsAbs: number;
}

export interface RuntimeConfig {
  nodeId: string;
  logLevel: "debug" | "info" | "warn" | "error";
  marketType: MarketType;
  symbols: string[];
  staleMsLimit: number;
  workerCount: number;
  controlPort: number;
  natsUrl: string;
  natsStream: string;
  natsSubjectPrefix: string;
  postgresUrl: string;
  publishTimeoutMs: number;
  publishRetries: number;
  dbInsertTimeoutMs: number;
  dbSampleIntervalMs: number;
  dbRetentionDays: number;
  dbRetentionCleanupIntervalMs: number;
  thresholds: ThresholdConfig;
}

export interface WorkerInitMessage {
  type: "init";
  workerId: number;
  symbols: string[];
  config: RuntimeConfig;
}

export interface WorkerConfigUpdateMessage {
  type: "update-config";
  symbols?: string[];
  thresholds?: ThresholdConfig;
}

export type MainToWorkerMessage = WorkerInitMessage | WorkerConfigUpdateMessage;

export interface WorkerHealthMessage {
  type: "health";
  workerId: number;
  connected: boolean;
  lastEventAtMs: number;
  symbols: string[];
  error?: string;
}

export interface WorkerMetricMessage {
  type: "metric";
  workerId: number;
  metric: string;
  value: number;
}

export interface WorkerReadyMessage {
  type: "ready";
  workerId: number;
}

export type WorkerToMainMessage = WorkerHealthMessage | WorkerMetricMessage | WorkerReadyMessage;
