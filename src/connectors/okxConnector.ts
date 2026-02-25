import WebSocket from "ws";
import { AsyncQueue } from "../utils/asyncQueue.js";
import { fromOkxInstId, toOkxInstId } from "../ingestor/symbolMapper.js";
import { ConnectorHealth, ExchangeConnector, OrderbookDelta, OrderbookSnapshot } from "../types.js";

interface OkxBook {
  instId: string;
  bids: [string, string, string, string][];
  asks: [string, string, string, string][];
  ts: string;
  seqId?: number;
  prevSeqId?: number;
}

export class OkxConnector implements ExchangeConnector {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnects = 0;
  private connected = false;
  private lastMessageAtMs = 0;
  private lastError: string | undefined;
  private queue: AsyncQueue<OrderbookDelta> | null = null;

  connect(symbols: string[]): AsyncIterable<OrderbookDelta> {
    this.closed = false;
    this.queue = new AsyncQueue<OrderbookDelta>();
    if (symbols.length === 0) {
      this.queue.end();
      return this.queue.iterate();
    }
    this.openWs(symbols);
    return this.queue.iterate();
  }

  async snapshot(symbol: string): Promise<OrderbookSnapshot> {
    const instId = toOkxInstId(symbol);
    const res = await fetch(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=1`);
    if (!res.ok) {
      throw new Error(`OKX snapshot failed: ${res.status}`);
    }
    const payload = (await res.json()) as { data: OkxBook[] };
    const first = payload.data?.[0];
    if (!first || first.bids.length === 0 || first.asks.length === 0) {
      throw new Error(`OKX snapshot empty for ${symbol}`);
    }
    return {
      exchange: "okx",
      symbol,
      tsExchangeMs: Number(first.ts),
      bid: Number(first.bids[0][0]),
      ask: Number(first.asks[0][0]),
      seq: first.seqId ?? Date.now()
    };
  }

  health(): ConnectorHealth {
    return {
      exchange: "okx",
      connected: this.connected,
      reconnects: this.reconnects,
      lastMessageAtMs: this.lastMessageAtMs,
      lastError: this.lastError
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
    this.queue?.end();
  }

  private openWs(symbols: string[]): void {
    if (this.closed) {
      return;
    }
    this.ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");

    this.ws.on("open", () => {
      this.connected = true;
      this.lastError = undefined;
      const args = symbols.map((symbol) => ({
        channel: "books5",
        instId: toOkxInstId(symbol)
      }));
      this.ws?.send(JSON.stringify({ op: "subscribe", args }));
    });

    this.ws.on("message", (raw) => {
      const parsed = JSON.parse(raw.toString()) as { data?: OkxBook[] };
      if (!parsed.data) {
        return;
      }
      const now = Date.now();
      this.lastMessageAtMs = now;
      for (const item of parsed.data) {
        if (item.bids.length === 0 || item.asks.length === 0) {
          continue;
        }
        this.queue?.push({
          exchange: "okx",
          symbol: fromOkxInstId(item.instId),
          tsExchangeMs: Number(item.ts),
          tsIngestMs: now,
          bid: Number(item.bids[0][0]),
          ask: Number(item.asks[0][0]),
          seq: item.seqId ?? now,
          prevSeq: item.prevSeqId
        });
      }
    });

    this.ws.on("error", (err) => {
      this.lastError = err.message;
    });

    this.ws.on("close", () => {
      this.connected = false;
      if (!this.closed) {
        this.scheduleReconnect(symbols);
      }
    });
  }

  private scheduleReconnect(symbols: string[]): void {
    this.reconnects += 1;
    const delay = Math.min(10_000, 250 * 2 ** Math.min(this.reconnects, 6));
    setTimeout(() => {
      if (!this.closed) {
        this.openWs(symbols);
      }
    }, delay);
  }
}
