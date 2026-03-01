import WebSocket from "ws";
import { DataSource, DataSourceHealth, NewsEvent } from "../types.js";

interface BweNewsSourceOptions {
  wsUrl: string;
  httpUrl?: string;
  httpFallbackEnabled: boolean;
  httpPollMs: number;
  wsStaleMs: number;
}

interface BweNewsPayload {
  source_name?: unknown;
  news_title?: unknown;
  news_body?: unknown;
  coins_included?: unknown;
  url?: unknown;
  timestamp?: unknown;
}

interface RssItem {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  guid?: string;
}

function toSafeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseCoins(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter(Boolean);
}

function parseTimestampSeconds(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 1_000_000_000_000) {
      return Math.floor(raw / 1000);
    }
    return Math.floor(raw);
  }
  if (typeof raw === "string") {
    const numeric = Number(raw.trim());
    if (Number.isFinite(numeric)) {
      if (numeric > 1_000_000_000_000) {
        return Math.floor(numeric / 1000);
      }
      return Math.floor(numeric);
    }
  }
  return Math.floor(Date.now() / 1000);
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function xmlTagValue(block: string, tagName: string): string | undefined {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(re);
  if (!match || !match[1]) {
    return undefined;
  }
  return decodeXmlEntities(stripCdata(match[1]).trim());
}

function xmlLinkHref(block: string): string | undefined {
  const linkTag = block.match(/<link(?:\s+[^>]*)?>/i)?.[0];
  if (!linkTag) {
    return undefined;
  }
  const href = linkTag.match(/\shref="([^"]+)"/i)?.[1];
  return href?.trim();
}

function parsePubDate(raw: string | undefined): number {
  if (!raw) {
    return Math.floor(Date.now() / 1000);
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return Math.floor(Date.now() / 1000);
  }
  return Math.floor(ms / 1000);
}

function normalizeRichText(raw: string): string {
  return decodeXmlEntities(
    stripCdata(raw)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanTitle(raw: string): string {
  const text = normalizeRichText(raw);
  if (!text) {
    return "";
  }
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+source:\s*https?:\/\/\S+/i, "").trim())
    .filter(Boolean)
    .filter((line) => !/^[-—_]{4,}$/.test(line))
    .filter((line) => !/\(Auto match could be wrong/i.test(line))
    .filter((line) => !/自动匹配可能不准确/.test(line))
    .filter((line) => !/^\d{4}-\d{2}-\d{2}\b/.test(line));
  const picked = lines.sort((a, b) => b.length - a.length)[0] ?? text;
  return picked.slice(0, 400);
}

function cleanBody(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const text = normalizeRichText(raw);
  return text || undefined;
}

function isLikelyTicker(value: string): boolean {
  const coin = value.toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(coin)) {
    return false;
  }
  if (!/[A-Z]/.test(coin)) {
    return false;
  }
  if (/^\d+[KMB]$/.test(coin)) {
    return false;
  }
  if (/^\d+$/.test(coin)) {
    return false;
  }
  return true;
}

function extractCoinsFromText(title: string, body: string | undefined): string[] {
  const text = `${title} ${body ?? ""}`.toUpperCase();
  const out = new Set<string>();

  const dollarMatches = text.match(/\$([A-Z0-9]{2,10})\b/g) ?? [];
  for (const raw of dollarMatches) {
    const coin = raw.slice(1);
    if (isLikelyTicker(coin)) {
      out.add(coin);
    }
  }

  const bracketMatches = text.match(/\(([A-Z0-9]{2,10})\)/g) ?? [];
  for (const raw of bracketMatches) {
    const coin = raw.slice(1, -1);
    if (isLikelyTicker(coin)) {
      out.add(coin);
    }
  }

  const majors = text.match(/\b(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|TON|TRX|LINK|AVAX|DOT|LTC|BCH|ETC|ATOM|UNI|APT|SUI|ARB|OP)\b/g) ?? [];
  for (const coin of majors) {
    out.add(coin);
  }

  return Array.from(out);
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const rssItemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of rssItemBlocks) {
    items.push({
      title: xmlTagValue(block, "title"),
      description: xmlTagValue(block, "description"),
      link: xmlTagValue(block, "link"),
      pubDate: xmlTagValue(block, "pubDate"),
      guid: xmlTagValue(block, "guid")
    });
  }

  if (items.length > 0) {
    return items;
  }

  // Atom fallback.
  const atomEntries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of atomEntries) {
    items.push({
      title: xmlTagValue(block, "title"),
      description: xmlTagValue(block, "summary") ?? xmlTagValue(block, "content"),
      link: xmlLinkHref(block) ?? xmlTagValue(block, "id"),
      pubDate: xmlTagValue(block, "updated") ?? xmlTagValue(block, "published"),
      guid: xmlTagValue(block, "id")
    });
  }
  return items;
}

function looksLikeXml(contentType: string | null, body: string): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("xml") || normalized.includes("rss") || normalized.includes("atom")) {
    return true;
  }
  const head = body.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<rss") || head.startsWith("<feed");
}

export class BweNewsSource implements DataSource {
  readonly name = "bwenews";
  onEvent: (event: NewsEvent) => void = () => {};

  private readonly wsUrl: string;
  private readonly httpUrl?: string;
  private readonly httpFallbackEnabled: boolean;
  private readonly httpPollMs: number;
  private readonly wsStaleMs: number;
  private ws: WebSocket | null = null;
  private closed = false;
  private connected = false;
  private reconnects = 0;
  private lastMessageAtMs = 0;
  private lastError: string | undefined;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private httpPollTimer: NodeJS.Timeout | null = null;
  private readonly seenKeys = new Set<string>();
  private readonly seenQueue: string[] = [];
  private readonly maxSeen = 500;
  private lastEmittedTsSec = 0;

  constructor(options: BweNewsSourceOptions) {
    this.wsUrl = options.wsUrl;
    this.httpUrl = options.httpUrl;
    this.httpFallbackEnabled = options.httpFallbackEnabled;
    this.httpPollMs = Math.max(1_000, options.httpPollMs);
    this.wsStaleMs = Math.max(3_000, options.wsStaleMs);
  }

  start(): void {
    this.closed = false;
    this.openWs();
    void this.pollHttpLatest("bootstrap");
    if (this.httpFallbackEnabled && this.httpUrl) {
      this.httpPollTimer = setInterval(() => {
        void this.pollHttpLatest("fallback");
      }, this.httpPollMs);
      this.httpPollTimer.unref();
    }
  }

  health(): DataSourceHealth {
    return {
      source: this.name,
      connected: this.connected,
      reconnects: this.reconnects,
      lastMessageAtMs: this.lastMessageAtMs,
      lastError: this.lastError
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
      this.httpPollTimer = null;
    }
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
  }

  private openWs(): void {
    if (this.closed) {
      return;
    }

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", () => {
      this.connected = true;
      this.lastError = undefined;
    });

    this.ws.on("message", (raw) => {
      const nowMs = Date.now();
      this.lastMessageAtMs = nowMs;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        return;
      }

      const record = toSafeObject(parsed);
      if (!record) {
        return;
      }

      const payload = record as BweNewsPayload;
      if (typeof payload.news_title !== "string" || !payload.news_title.trim()) {
        return;
      }
      const title = cleanTitle(payload.news_title);
      if (!title) {
        return;
      }

      const event: NewsEvent = {
        sourceName: typeof payload.source_name === "string" && payload.source_name.trim() ? payload.source_name.trim() : this.name,
        title,
        body: typeof payload.news_body === "string" ? cleanBody(payload.news_body) : undefined,
        url: typeof payload.url === "string" ? payload.url.trim() : undefined,
        coins: parseCoins(payload.coins_included),
        timestamp: parseTimestampSeconds(payload.timestamp),
        raw: record
      };

      try {
        this.emitIfNew(event);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    });

    this.ws.on("error", (error) => {
      this.lastError = error.message;
    });

    this.ws.on("close", () => {
      this.connected = false;
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    this.reconnects += 1;
    const delayMs = Math.min(10_000, 250 * 2 ** Math.min(this.reconnects, 6));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) {
        this.openWs();
      }
    }, delayMs);
    this.reconnectTimer.unref();
  }

  private async pollHttpLatest(mode: "bootstrap" | "fallback"): Promise<void> {
    if (!this.httpUrl || this.closed) {
      return;
    }
    if (mode === "fallback") {
      const stale = !this.connected || Date.now() - this.lastMessageAtMs > this.wsStaleMs;
      if (!stale) {
        return;
      }
    }

    try {
      const res = await fetch(this.httpUrl, {
        method: "GET",
        headers: { accept: "application/json, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8" }
      });
      if (!res.ok) {
        this.lastError = `http_${res.status}`;
        return;
      }
      const contentType = res.headers.get("content-type");
      const body = await res.text();
      const events = this.extractEventsFromHttp(contentType, body);
      const selected = this.selectEventsToEmit(events, mode);
      for (const event of selected) {
        this.emitIfNew(event);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private selectEventsToEmit(events: NewsEvent[], mode: "bootstrap" | "fallback"): NewsEvent[] {
    if (events.length === 0) {
      return [];
    }
    if (mode === "bootstrap") {
      return [events[events.length - 1]];
    }
    const newer = events.filter((event) => event.timestamp > this.lastEmittedTsSec);
    if (newer.length > 0) {
      return newer;
    }
    return [events[events.length - 1]];
  }

  private extractEventsFromHttp(contentType: string | null, body: string): NewsEvent[] {
    if (looksLikeXml(contentType, body)) {
      return this.extractEventsFromXml(body);
    }
    return this.extractEventsFromJson(body);
  }

  private extractEventsFromJson(body: string): NewsEvent[] {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      this.lastError = "http_invalid_json";
      return [];
    }
    const list = this.pickItemList(payload);
    const out: NewsEvent[] = [];
    for (const item of list) {
      const record = toSafeObject(item);
      if (!record) {
        continue;
      }
      const parsed = this.parseEventRecord(record);
      if (parsed) {
        out.push(parsed);
      }
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }

  private extractEventsFromXml(xml: string): NewsEvent[] {
    const items = parseRssItems(xml);
    const out: NewsEvent[] = [];
    for (const item of items) {
      const title = item.title ? cleanTitle(item.title) : "";
      if (!title) {
        continue;
      }
      const body = cleanBody(item.description);
      const url = item.link?.trim() || item.guid?.trim();
      out.push({
        sourceName: this.name,
        title,
        body,
        url,
        coins: extractCoinsFromText(title, body),
        timestamp: parsePubDate(item.pubDate),
        raw: {
          source_name: this.name,
          news_title: title,
          news_body: body,
          url,
          timestamp: item.pubDate
        }
      });
    }
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }

  private pickItemList(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }
    const record = toSafeObject(payload);
    if (!record) {
      return [];
    }
    if (Array.isArray(record.data)) {
      return record.data;
    }
    if (Array.isArray(record.items)) {
      return record.items;
    }
    return [record];
  }

  private parseEventRecord(record: Record<string, unknown>): NewsEvent | null {
    const payload = record as BweNewsPayload;
    if (typeof payload.news_title !== "string" || !payload.news_title.trim()) {
      return null;
    }
    const title = cleanTitle(payload.news_title);
    if (!title) {
      return null;
    }
    return {
      sourceName: typeof payload.source_name === "string" && payload.source_name.trim() ? payload.source_name.trim() : this.name,
      title,
      body: typeof payload.news_body === "string" ? cleanBody(payload.news_body) : undefined,
      url: typeof payload.url === "string" ? payload.url.trim() : undefined,
      coins: parseCoins(payload.coins_included),
      timestamp: parseTimestampSeconds(payload.timestamp),
      raw: record
    };
  }

  private emitIfNew(event: NewsEvent): void {
    const key = `${event.timestamp}|${event.title}|${event.url ?? ""}`;
    if (this.seenKeys.has(key)) {
      return;
    }
    this.lastEmittedTsSec = Math.max(this.lastEmittedTsSec, event.timestamp);
    this.seenKeys.add(key);
    this.seenQueue.push(key);
    if (this.seenQueue.length > this.maxSeen) {
      const dropped = this.seenQueue.shift();
      if (dropped) {
        this.seenKeys.delete(dropped);
      }
    }
    this.onEvent(event);
  }
}
