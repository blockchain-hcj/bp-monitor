export interface AlertHubConfig {
  host: string;
  port: number;
  ringSize: number;
  wsPath: string;
  corsOrigin: string;
  natsEnabled: boolean;
  natsUrl: string;
  natsSubject: string;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid integer env ${name}=${raw}`);
  }
  return value;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean env ${name}=${raw}`);
}

function normalizeWsPath(value: string): string {
  const base = value.trim() || "/ws";
  return base.startsWith("/") ? base : `/${base}`;
}

export function loadConfig(): AlertHubConfig {
  return {
    host: process.env.ALERT_HUB_HOST?.trim() || "127.0.0.1",
    port: parseIntEnv("ALERT_HUB_PORT", 18280),
    ringSize: Math.max(1, Math.min(parseIntEnv("ALERT_HUB_RING_SIZE", 500), 5_000)),
    wsPath: normalizeWsPath(process.env.ALERT_HUB_WS_PATH ?? "/ws"),
    corsOrigin: process.env.ALERT_HUB_CORS_ORIGIN?.trim() || "*",
    natsEnabled: parseBoolEnv("ALERT_HUB_NATS_ENABLED", false),
    natsUrl: process.env.NATS_URL ?? "nats://127.0.0.1:4222",
    natsSubject: process.env.ALERT_HUB_NATS_SUBJECT?.trim() || "alerts.>"
  };
}
