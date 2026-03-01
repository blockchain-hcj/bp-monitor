import { randomUUID } from "node:crypto";
import { Alert, AlertClientOptions, AlertInput, AlertSendResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 1500;

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function toAlert(input: AlertInput, fallbackSource: string): Alert {
  const tsMs = Date.now();
  return {
    id: randomUUID(),
    ts: new Date(tsMs).toISOString(),
    ts_ms: tsMs,
    severity: input.severity,
    source: (input.source ?? fallbackSource).trim() || fallbackSource,
    title: input.title,
    body: input.body,
    meta: input.meta,
    group: input.group
  };
}

export class AlertClient {
  private readonly endpoint: string;
  private readonly source: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(options: AlertClientOptions) {
    this.endpoint = `${trimTrailingSlash(options.hubUrl)}/alerts`;
    this.source = options.source;
    this.timeoutMs = Math.max(200, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.headers = options.headers ?? {};
  }

  fire(input: AlertInput): void {
    void this.send(input);
  }

  async send(input: AlertInput): Promise<AlertSendResult> {
    const alert = toAlert(input, this.source);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref();

    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.headers
        },
        body: JSON.stringify(alert),
        signal: controller.signal
      });
      return {
        ok: res.ok,
        status: res.status,
        alert,
        error: res.ok ? undefined : `http_${res.status}`
      };
    } catch (error) {
      return {
        ok: false,
        alert,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
