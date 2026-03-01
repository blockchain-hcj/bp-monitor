export type AlertSeverity = "info" | "warn" | "error" | "critical";

export interface Alert {
  id: string;
  ts: string;
  ts_ms: number;
  severity: AlertSeverity;
  source: string;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
  group?: string;
}

export interface AlertInput {
  severity: AlertSeverity;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
  group?: string;
  source?: string;
}

export interface AckedAlert extends Alert {
  acked?: boolean;
  ack_ts?: string;
  ack_ts_ms?: number;
  acked_by?: string;
}

export interface AlertClientOptions {
  hubUrl: string;
  source: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface AlertSendResult {
  ok: boolean;
  status?: number;
  alert: Alert;
  error?: string;
}
