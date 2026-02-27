import { StringCodec, Subscription, connect } from "nats";
import { ArbInputEvent, Exchange, SpreadEvent } from "../types.js";

function normalizeExchange(raw: string): Exchange | null {
  const v = raw.trim().toLowerCase();
  if (v === "binance" || v === "bn") {
    return "binance";
  }
  if (v === "okx") {
    return "okx";
  }
  return null;
}

export function normalizeSpreadEvent(payload: SpreadEvent): ArbInputEvent | null {
  const a = normalizeExchange(payload.exchange_a);
  const b = normalizeExchange(payload.exchange_b);
  if (!a || !b || a === b) {
    return null;
  }
  if (!["binance", "okx"].includes(a) || !["binance", "okx"].includes(b)) {
    return null;
  }

  let bpsBinanceToOkx: number;
  let bpsOkxToBinance: number;
  let bestBidBinance: number;
  let bestAskBinance: number;
  let bestBidOkx: number;
  let bestAskOkx: number;

  if (a === "binance" && b === "okx") {
    bpsBinanceToOkx = payload.bps_a_to_b;
    bpsOkxToBinance = payload.bps_b_to_a;
    bestBidBinance = payload.best_bid_a;
    bestAskBinance = payload.best_ask_a;
    bestBidOkx = payload.best_bid_b;
    bestAskOkx = payload.best_ask_b;
  } else {
    bpsBinanceToOkx = payload.bps_b_to_a;
    bpsOkxToBinance = payload.bps_a_to_b;
    bestBidBinance = payload.best_bid_b;
    bestAskBinance = payload.best_ask_b;
    bestBidOkx = payload.best_bid_a;
    bestAskOkx = payload.best_ask_a;
  }

  if (![bestBidBinance, bestAskBinance, bestBidOkx, bestAskOkx].every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }

  return {
    symbol: payload.symbol.toUpperCase(),
    exchange_a: a,
    exchange_b: b,
    best_bid_a: payload.best_bid_a,
    best_ask_a: payload.best_ask_a,
    best_bid_b: payload.best_bid_b,
    best_ask_b: payload.best_ask_b,
    best_bid_binance: bestBidBinance,
    best_ask_binance: bestAskBinance,
    best_bid_okx: bestBidOkx,
    best_ask_okx: bestAskOkx,
    bps_a_to_b: payload.bps_a_to_b,
    bps_b_to_a: payload.bps_b_to_a,
    bps_binance_to_okx: bpsBinanceToOkx,
    bps_okx_to_binance: bpsOkxToBinance,
    ts_ingest: payload.ts_ingest,
    ts_publish: Number.isFinite(payload.ts_publish) ? payload.ts_publish : payload.ts_ingest,
    quality_flag: Array.isArray(payload.quality_flag) ? payload.quality_flag : []
  };
}

export class SpreadSubscriber {
  private sub: Subscription | null = null;
  private closed = false;

  constructor(
    private readonly natsUrl: string,
    private readonly subjectPrefix: string
  ) {}

  async *stream(): AsyncIterable<ArbInputEvent> {
    const sc = StringCodec();
    const nc = await connect({ servers: this.natsUrl, timeout: 2000 });
    const subject = `${this.subjectPrefix}.>`;
    this.sub = nc.subscribe(subject);

    try {
      for await (const msg of this.sub) {
        if (this.closed) {
          break;
        }
        try {
          const raw = JSON.parse(sc.decode(msg.data)) as SpreadEvent;
          const normalized = normalizeSpreadEvent(raw);
          if (normalized) {
            yield normalized;
          }
        } catch {
          // Ignore malformed messages.
        }
      }
    } finally {
      await nc.drain();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.sub?.unsubscribe();
    this.sub = null;
  }
}
