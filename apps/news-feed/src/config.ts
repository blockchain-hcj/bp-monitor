export interface NewsFeedConfig {
  host: string;
  controlPort: number;
  alertHubUrl: string;
  watchCoins: Set<string>;
  bweNewsEnabled: boolean;
  bweNewsWsUrl: string;
  bweNewsHttpUrl?: string;
  bweNewsHttpFallbackEnabled: boolean;
  bweNewsHttpPollMs: number;
  bweNewsWsStaleMs: number;
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

function parseWatchCoins(raw: string | undefined): Set<string> {
  if (!raw || !raw.trim()) {
    return new Set<string>();
  }
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  );
}

export function loadConfig(): NewsFeedConfig {
  const httpUrl = process.env.BWE_NEWS_HTTP_URL?.trim();
  return {
    host: process.env.CONTROL_HOST?.trim() || "127.0.0.1",
    controlPort: parseIntEnv("CONTROL_PORT", 18380),
    alertHubUrl: process.env.ALERT_HUB_URL?.trim() || "http://127.0.0.1:18280",
    watchCoins: parseWatchCoins(process.env.WATCH_COINS),
    bweNewsEnabled: parseBoolEnv("BWE_NEWS_ENABLED", true),
    bweNewsWsUrl: process.env.BWE_NEWS_WS_URL?.trim() || "wss://bwenews-api.bwe-ws.com/ws",
    bweNewsHttpUrl: httpUrl || "https://rss-public.bwe-ws.com/",
    bweNewsHttpFallbackEnabled: parseBoolEnv("BWE_NEWS_HTTP_FALLBACK_ENABLED", true),
    bweNewsHttpPollMs: parseIntEnv("BWE_NEWS_HTTP_POLL_MS", 15_000),
    bweNewsWsStaleMs: parseIntEnv("BWE_NEWS_WS_STALE_MS", 45_000)
  };
}
