export interface NewsEvent {
  sourceName: string;
  title: string;
  body?: string;
  url?: string;
  coins: string[];
  timestamp: number;
  raw?: Record<string, unknown>;
}

export interface DataSourceHealth {
  source: string;
  connected: boolean;
  reconnects: number;
  lastMessageAtMs: number;
  lastError?: string;
}

export interface DataSource {
  readonly name: string;
  start(): void;
  onEvent: (event: NewsEvent) => void;
  health(): DataSourceHealth;
  close(): Promise<void>;
}
