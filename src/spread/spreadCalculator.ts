import crypto from "node:crypto";
import { SpreadCalculator, SpreadEvent, TopOfBook } from "../types.js";

export class DefaultSpreadCalculator implements SpreadCalculator {
  private readonly schemaVersion = "1.0.0";

  compute(topA: TopOfBook, topB: TopOfBook): SpreadEvent {
    const now = Date.now();
    const midA = (topA.bid + topA.ask) / 2;
    const midB = (topB.bid + topB.ask) / 2;
    const midRef = (midA + midB) / 2;

    const bpsAToB = midRef > 0 ? ((topB.bid - topA.ask) / midRef) * 10_000 : 0;
    const bpsBToA = midRef > 0 ? ((topA.bid - topB.ask) / midRef) * 10_000 : 0;

    const qualityFlag = new Set<string>([...topA.qualityFlag, ...topB.qualityFlag]);
    if (midRef <= 0) {
      qualityFlag.add("invalid_mid_ref");
    }

    const exchangeTs = Math.max(topA.tsExchangeMs, topB.tsExchangeMs);
    const ingestTs = Math.max(topA.tsIngestMs, topB.tsIngestMs);
    const eventId = crypto
      .createHash("sha1")
      .update(`${topA.exchange}:${topA.symbol}:${topA.seq}:${topB.exchange}:${topB.seq}:${ingestTs}`)
      .digest("hex");

    const event: SpreadEvent = {
      schema_version: this.schemaVersion,
      event_id: eventId,
      ts_exchange: exchangeTs,
      ts_ingest: ingestTs,
      ts_publish: now,
      symbol: topA.symbol,
      market_type: "usdt_perp",
      exchange_a: topA.exchange,
      exchange_b: topB.exchange,
      best_bid_a: topA.bid,
      best_ask_a: topA.ask,
      best_bid_b: topB.bid,
      best_ask_b: topB.ask,
      bps_a_to_b: bpsAToB,
      bps_b_to_a: bpsBToA,
      seq_a: topA.seq,
      seq_b: topB.seq,
      staleness_ms_a: topA.staleMs,
      staleness_ms_b: topB.staleMs,
      quality_flag: [...qualityFlag]
    };

    return event;
  }
}
