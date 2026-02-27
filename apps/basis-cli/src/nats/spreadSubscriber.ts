import { StringCodec, connect, NatsConnection, Subscription } from "nats";
import { PriceSnapshot, SpreadEvent } from "../types.js";

function normalizeEpochMs(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Heuristics by magnitude:
  // seconds:   ~1e9-1e10
  // millis:    ~1e12-1e13
  // micros:    ~1e15-1e16
  // nanos:     ~1e18-1e19
  if (n < 1e11) return Math.round(n * 1000);
  if (n < 1e14) return Math.round(n);
  if (n < 1e17) return Math.round(n / 1000);
  return Math.round(n / 1_000_000);
}

function normalizeExchange(raw: string): "binance" | "okx" | null {
  const v = raw.trim().toLowerCase();
  if (v === "binance" || v === "bn") return "binance";
  if (v === "okx") return "okx";
  return null;
}

export class SpreadSubscriber {
  private nc: NatsConnection | null = null;
  private discoverySub: Subscription | null = null;
  private priceSub: Subscription | null = null;
  private closed = false;
  private _connected = false;
  private activeSymbol: string | null = null;
  private subjectPrefix: string;

  private _onSnapshot: ((snap: PriceSnapshot) => void) | null = null;
  private _onConnect: (() => void) | null = null;
  private _onDisconnect: (() => void) | null = null;
  private _onSymbolDiscovered: ((symbol: string) => void) | null = null;
  private discoveryRunning = false;
  private symbolSubjectMap = new Map<string, string>();
  private currentPriceSubject: string | null = null;

  /** debug counters */
  msgTotal = 0;
  msgMatched = 0;
  msgParseFail = 0;
  msgSnapshotOk = 0;
  msgSnapshotNull = 0;
  msgPriceChanged = 0;
  private lastRateTsMs = Date.now();
  private lastRateMatched = 0;
  private lastRateChanged = 0;
  private _matchedPerSec = 0;
  private _changedPerSec = 0;
  private lastSnapshotKey: string | null = null;

  get priceSubject(): string | null {
    return this.currentPriceSubject;
  }

  get matchedPerSec(): number {
    if (Date.now() - this.lastRateTsMs > 1500) {
      return 0;
    }
    return this._matchedPerSec;
  }

  get changedPerSec(): number {
    if (Date.now() - this.lastRateTsMs > 1500) {
      return 0;
    }
    return this._changedPerSec;
  }

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

    // 1. Discovery subscription — wildcard, lightweight, only extracts symbol names
    this.resumeDiscovery();
    // 2. Price subscription — exact subject for current symbol
    this.startPriceSub();
  }

  async close(): Promise<void> {
    this.closed = true;
    this._connected = false;
    this.discoverySub?.unsubscribe();
    this.discoverySub = null;
    this.discoveryRunning = false;
    this.priceSub?.unsubscribe();
    this.priceSub = null;
    this.currentPriceSubject = null;
    if (this.nc) {
      await this.nc.drain().catch(() => {});
      this.nc = null;
    }
  }

  switchSubject(newSubject: string): void {
    const parts = newSubject.split(".");
    this.activeSymbol = parts[parts.length - 1] || null;
    this.msgMatched = 0;
    this.msgSnapshotOk = 0;
    this.msgSnapshotNull = 0;
    this.msgPriceChanged = 0;
    this.lastRateTsMs = Date.now();
    this.lastRateMatched = 0;
    this.lastRateChanged = 0;
    this._matchedPerSec = 0;
    this._changedPerSec = 0;
    this.lastSnapshotKey = null;
    this.priceSub?.unsubscribe();
    this.priceSub = null;
    this.startPriceSub();
  }

  pauseDiscovery(): void {
    this.discoverySub?.unsubscribe();
    this.discoverySub = null;
    this.discoveryRunning = false;
  }

  resumeDiscovery(): void {
    if (!this.nc || this.discoveryRunning) return;

    const sc = StringCodec();
    const wildcard = `${this.subjectPrefix}.>`;
    this.discoverySub = this.nc.subscribe(wildcard);
    this.discoveryRunning = true;
    const seen = new Set<string>();

    (async () => {
      if (!this.discoverySub) return;
      let count = 0;
      for await (const msg of this.discoverySub) {
        if (this.closed) break;
        this.msgTotal++;

        // Yield periodically so rendering/keyboard remain responsive under burst traffic.
        if (++count % 100 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        const subjectParts = msg.subject.split(".");
        const subjectSymbol = (subjectParts[subjectParts.length - 1] ?? "").toUpperCase();

        if (subjectSymbol && !seen.has(subjectSymbol)) {
          seen.add(subjectSymbol);
          this.symbolSubjectMap.set(subjectSymbol, msg.subject);
          this._onSymbolDiscovered?.(subjectSymbol);
        }
      }
      this.discoveryRunning = false;
    })().catch(() => {
      this.discoveryRunning = false;
    });
  }

  private startPriceSub(): void {
    if (!this.nc || !this.activeSymbol) return;
    const sc = StringCodec();
    const symbolUpper = this.activeSymbol.toUpperCase();
    const subject = `${this.subjectPrefix}.${symbolUpper}`;
    this.currentPriceSubject = subject;
    this.priceSub = this.nc.subscribe(subject);

    (async () => {
      if (!this.priceSub) return;
      let count = 0;
      for await (const msg of this.priceSub) {
        if (this.closed) break;
        // Yield periodically so rendering/keyboard remain responsive under burst traffic.
        if (++count % 100 === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        let raw: SpreadEvent;
        try {
          raw = JSON.parse(sc.decode(msg.data)) as SpreadEvent;
        } catch {
          this.msgParseFail++;
          continue;
        }

        if (String(raw.symbol ?? "").toUpperCase() !== symbolUpper) {
          continue;
        }

        this.msgMatched++;
        const now = Date.now();
        this.refreshRates(now);

        const snapshot = this.toSnapshot(raw);
        if (snapshot) {
          this.msgSnapshotOk++;
          const nextKey = this.snapshotKey(snapshot);
          if (nextKey !== this.lastSnapshotKey) {
            this.lastSnapshotKey = nextKey;
            this.msgPriceChanged++;
            this.refreshRates(now);
          }
          this._onSnapshot?.(snapshot);
        } else {
          this.msgSnapshotNull++;
        }
      }
    })().catch(() => {});
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

    const recvTs = Date.now();
    const sourceTs = normalizeEpochMs(raw.ts_publish) ?? normalizeEpochMs(raw.ts_ingest) ?? recvTs;

    return {
      binanceBid,
      binanceAsk,
      okxBid,
      okxAsk,
      bpsBinanceToOkx,
      bpsOkxToBinance,
      // Keep source-side freshness semantics for stale checks.
      tsMs: sourceTs,
      tsRecvMs: recvTs,
    };
  }

  private refreshRates(now: number): void {
    if (now - this.lastRateTsMs < 1000) {
      return;
    }
    const dt = Math.max(1, now - this.lastRateTsMs);
    const dm = this.msgMatched - this.lastRateMatched;
    const dc = this.msgPriceChanged - this.lastRateChanged;
    this._matchedPerSec = (dm * 1000) / dt;
    this._changedPerSec = (dc * 1000) / dt;
    this.lastRateTsMs = now;
    this.lastRateMatched = this.msgMatched;
    this.lastRateChanged = this.msgPriceChanged;
  }

  private snapshotKey(s: PriceSnapshot): string {
    return [
      s.binanceBid,
      s.binanceAsk,
      s.okxBid,
      s.okxAsk,
      s.bpsBinanceToOkx,
      s.bpsOkxToBinance,
    ].join("|");
  }
}
