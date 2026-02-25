import { OrderbookDelta, TopOfBook } from "../types.js";

const keyOf = (exchange: string, symbol: string): string => `${exchange}:${symbol}`;

export class TopOfBookStore {
  private readonly store = new Map<string, TopOfBook>();

  upsert(delta: OrderbookDelta, staleMsLimit: number): TopOfBook {
    const key = keyOf(delta.exchange, delta.symbol);
    const existing = this.store.get(key);
    const qualityFlag = new Set<string>();

    if (existing && delta.seq <= existing.seq) {
      qualityFlag.add("out_of_order");
    }

    if (existing && delta.prevSeq !== undefined && delta.prevSeq !== existing.seq) {
      qualityFlag.add("seq_gap");
    }

    if (delta.bid <= 0 || delta.ask <= 0 || delta.bid > delta.ask) {
      qualityFlag.add("invalid_top");
    }

    const staleMs = Math.max(0, Date.now() - delta.tsExchangeMs);
    if (staleMs > staleMsLimit) {
      qualityFlag.add("stale");
    }

    const top: TopOfBook = {
      exchange: delta.exchange,
      symbol: delta.symbol,
      bid: delta.bid,
      ask: delta.ask,
      seq: delta.seq,
      tsExchangeMs: delta.tsExchangeMs,
      tsIngestMs: delta.tsIngestMs,
      staleMs,
      qualityFlag: [...qualityFlag]
    };

    this.store.set(key, top);
    return top;
  }

  get(exchange: string, symbol: string): TopOfBook | undefined {
    return this.store.get(keyOf(exchange, symbol));
  }
}
