import { describe, expect, it } from "vitest";
import { TopOfBookStore } from "../src/ingestor/topOfBookStore.js";

describe("TopOfBookStore", () => {
  it("flags sequence gap", () => {
    const store = new TopOfBookStore();
    store.upsert(
      {
        exchange: "okx",
        symbol: "BTCUSDT",
        tsExchangeMs: Date.now(),
        tsIngestMs: Date.now(),
        bid: 100,
        ask: 101,
        seq: 10,
        prevSeq: 9
      },
      1000
    );

    const top = store.upsert(
      {
        exchange: "okx",
        symbol: "BTCUSDT",
        tsExchangeMs: Date.now(),
        tsIngestMs: Date.now(),
        bid: 100,
        ask: 101,
        seq: 20,
        prevSeq: 11
      },
      1000
    );

    expect(top.qualityFlag).toContain("seq_gap");
  });
});
