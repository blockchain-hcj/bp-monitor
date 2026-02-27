import { StringCodec, connect, NatsConnection, Subscription } from "nats";
import { PriceSnapshot, SpreadEvent } from "../types.js";

function normalizeExchange(raw: string): "binance" | "okx" | null {
  const v = raw.trim().toLowerCase();
  if (v === "binance" || v === "bn") return "binance";
  if (v === "okx") return "okx";
  return null;
}

export class SpreadSubscriber {
  private nc: NatsConnection | null = null;
  private sub: Subscription | null = null;
  private closed = false;
  private _connected = false;
  private activeSymbol: string | null = null;
  private subjectPrefix: string;

  private _onSnapshot: ((snap: PriceSnapshot) => void) | null = null;
  private _onConnect: (() => void) | null = null;
  private _onDisconnect: (() => void) | null = null;
  private _onSymbolDiscovered: ((symbol: string) => void) | null = null;

  /** debug counters */
  msgTotal = 0;
  msgMatched = 0;
  msgParseFail = 0;

  constructor(
    private readonly natsUrl: string,
    subject: string
  ) {
    // Extract prefix: "spread.binance_okx.ETHUSDT" → "spread.binance_okx"
    const parts = subject.split(".");
    this.activeSymbol = parts[parts.length - 1] || null;
    this.subjectPrefix = parts.slice(0, -1).join(".");
  }

  get connected(): boolean {
    return this._connected;
  }

  onSnapshot(cb: (snap: PriceSnapshot) => void) {
    this._onSnapshot = cb;
  }

  onConnect(cb: () => void) {
    this._onConnect = cb;
  }

  onDisconnect(cb: () => void) {
    this._onDisconnect = cb;
  }

  onSymbolDiscovered(cb: (symbol: string) => void) {
    this._onSymbolDiscovered = cb;
  }

  async connect(): Promise<void> {
    const sc = StringCodec();
    this.nc = await connect({ servers: this.natsUrl, timeout: 5000 });
    this._connected = true;
    this._onConnect?.();

    this.nc.closed().then(() => {
      this._connected = false;
      this._onDisconnect?.();
    });

    // NATS.js v2 status events for disconnect/reconnect
    (async () => {
      if (!this.nc) return;
      for await (const s of this.nc.status()) {
        if (s.type === "disconnect" || s.type === "error") {
          this._connected = false;
          this._onDisconnect?.();
        } else if (s.type === "reconnect") {
          this._connected = true;
          this._onConnect?.();
        }
      }
    })().catch(() => {});

    // Single wildcard subscription for everything
    const wildcard = `${this.subjectPrefix}.>`;
    this.sub = this.nc.subscribe(wildcard);
    const seen = new Set<string>();

    (async () => {
      if (!this.sub) return;
      for await (const msg of this.sub) {
        if (this.closed) break;
        this.msgTotal++;

        // Extract symbol from subject
        const subjectParts = msg.subject.split(".");
        const symbol = subjectParts[subjectParts.length - 1];

        // Discovery: notify new symbols
        if (symbol && !seen.has(symbol)) {
          seen.add(symbol);
          this._onSymbolDiscovered?.(symbol);
        }

        // Only parse snapshot for the active symbol
        if (symbol !== this.activeSymbol) continue;
        this.msgMatched++;

        try {
          const raw = JSON.parse(sc.decode(msg.data)) as SpreadEvent;
          const snapshot = this.toSnapshot(raw);
          if (snapshot) this._onSnapshot?.(snapshot);
        } catch {
          this.msgParseFail++;
        }
      }
    })().catch(() => {});
  }

  async close(): Promise<void> {
    this.closed = true;
    this._connected = false;
    this.sub?.unsubscribe();
    this.sub = null;
    if (this.nc) {
      await this.nc.drain().catch(() => {});
      this.nc = null;
    }
  }

  switchSubject(newSubject: string): void {
    // Just change the active symbol filter — no need to re-subscribe
    const parts = newSubject.split(".");
    this.activeSymbol = parts[parts.length - 1] || null;
    this.msgMatched = 0;
  }

  private toSnapshot(raw: SpreadEvent): PriceSnapshot | null {
    const a = normalizeExchange(raw.exchange_a);
    const b = normalizeExchange(raw.exchange_b);
    if (!a || !b || a === b) return null;

    let binanceBid: number, binanceAsk: number, okxBid: number, okxAsk: number;
    let bpsBinanceToOkx: number, bpsOkxToBinance: number;

    if (a === "binance" && b === "okx") {
      binanceBid = raw.best_bid_a;
      binanceAsk = raw.best_ask_a;
      okxBid = raw.best_bid_b;
      okxAsk = raw.best_ask_b;
      bpsBinanceToOkx = raw.bps_a_to_b;
      bpsOkxToBinance = raw.bps_b_to_a;
    } else if (a === "okx" && b === "binance") {
      binanceBid = raw.best_bid_b;
      binanceAsk = raw.best_ask_b;
      okxBid = raw.best_bid_a;
      okxAsk = raw.best_ask_a;
      bpsBinanceToOkx = raw.bps_b_to_a;
      bpsOkxToBinance = raw.bps_a_to_b;
    } else {
      return null;
    }

    if (![binanceBid, binanceAsk, okxBid, okxAsk].every((v) => Number.isFinite(v) && v > 0)) {
      return null;
    }

    return {
      binanceBid,
      binanceAsk,
      okxBid,
      okxAsk,
      bpsBinanceToOkx,
      bpsOkxToBinance,
      tsMs: Number.isFinite(raw.ts_publish) ? raw.ts_publish : raw.ts_ingest,
    };
  }
}
