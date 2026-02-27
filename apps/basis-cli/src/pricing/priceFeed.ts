import { PriceSnapshot } from "../types.js";

const STALE_MS = 3000;

export class PriceFeed {
  private _snapshot: PriceSnapshot | null = null;

  get snapshot(): PriceSnapshot | null {
    return this._snapshot;
  }

  get isStale(): boolean {
    if (!this._snapshot) return true;
    const lagMs = Math.max(0, Date.now() - this._snapshot.tsMs);
    return lagMs > STALE_MS;
  }

  update(snap: PriceSnapshot): void {
    this._snapshot = snap;
  }

  clear(): void {
    this._snapshot = null;
  }

  midPrice(): number {
    if (!this._snapshot) return 0;
    return (this._snapshot.binanceBid + this._snapshot.binanceAsk + this._snapshot.okxBid + this._snapshot.okxAsk) / 4;
  }
}
