import WebSocket from "ws";
import { AsyncQueue } from "../utils/asyncQueue.js";
import { ConnectorHealth, ExchangeConnector, OrderbookDelta, OrderbookSnapshot } from "../types.js";

interface BinanceBookTicker {
  s: string;
  b: string;
  a: string;
  u: number;
  E?: number;
  T?: number;
}

export class BinanceConnector implements ExchangeConnector {
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
    this.openWs(symbols.map((s) => s.toLowerCase()));
    return this.queue.iterate();
  }

  async snapshot(symbol: string): Promise<OrderbookSnapshot> {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`);
    if (!res.ok) {
      throw new Error(`Binance snapshot failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      symbol: string;
      bidPrice: string;
      askPrice: string;
      time?: number;
      updateId?: number;
    };
    return {
      exchange: "binance",
      symbol,
      tsExchangeMs: data.time ?? Date.now(),
      bid: Number(data.bidPrice),
      ask: Number(data.askPrice),
      seq: data.updateId ?? Date.now()
    };
  }

  health(): ConnectorHealth {
    return {
      exchange: "binance",
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

  private openWs(lowerSymbols: string[]): void {
    if (this.closed) {
      return;
    }
    const streams = lowerSymbols.map((s) => `${s}@bookTicker`).join("/");
    const url = `wss://fstream.binance.com/stream?streams=${streams}`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.connected = true;
      this.lastError = undefined;
    });

    this.ws.on("message", (raw) => {
      const parsed = JSON.parse(raw.toString()) as { data?: BinanceBookTicker };
      if (!parsed.data) {
        return;
      }
      const data = parsed.data;
      const now = Date.now();
      this.lastMessageAtMs = now;
      this.queue?.push({
        exchange: "binance",
        symbol: data.s,
        tsExchangeMs: data.T ?? data.E ?? now,
        tsIngestMs: now,
        bid: Number(data.b),
        ask: Number(data.a),
        seq: data.u
      });
    });

    this.ws.on("error", (err) => {
      this.lastError = err.message;
    });

    this.ws.on("close", () => {
      this.connected = false;
      if (!this.closed) {
        this.scheduleReconnect(lowerSymbols);
      }
    });
  }

  private scheduleReconnect(lowerSymbols: string[]): void {
    this.reconnects += 1;
    const delay = Math.min(10_000, 250 * 2 ** Math.min(this.reconnects, 6));
    setTimeout(() => {
      if (!this.closed) {
        this.openWs(lowerSymbols);
      }
    }, delay);
  }
}
