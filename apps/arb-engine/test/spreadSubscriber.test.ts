import { describe, expect, it } from "vitest";
import { normalizeSpreadEvent } from "../src/nats/spreadSubscriber.js";

describe("normalizeSpreadEvent", () => {
  it("maps bn alias and keeps binance->okx spread", () => {
    const event = normalizeSpreadEvent({
      symbol: "btcusdt",
      exchange_a: "bn",
      exchange_b: "okx",
      bps_a_to_b: 10,
      bps_b_to_a: -3,
      ts_ingest: Date.now(),
      quality_flag: []
    });

    expect(event).not.toBeNull();
    expect(event?.symbol).toBe("BTCUSDT");
    expect(event?.bps_binance_to_okx).toBe(10);
    expect(event?.bps_okx_to_binance).toBe(-3);
  });

  it("remaps bps when event arrives as okx->binance", () => {
    const event = normalizeSpreadEvent({
      symbol: "BTCUSDT",
      exchange_a: "okx",
      exchange_b: "binance",
      bps_a_to_b: 7,
      bps_b_to_a: 2,
      ts_ingest: Date.now(),
      quality_flag: []
    });

    expect(event?.bps_binance_to_okx).toBe(2);
    expect(event?.bps_okx_to_binance).toBe(7);
  });

  it("filters unsupported exchange pair", () => {
    const event = normalizeSpreadEvent({
      symbol: "BTCUSDT",
      exchange_a: "deepbook",
      exchange_b: "okx",
      bps_a_to_b: 1,
      bps_b_to_a: 1,
      ts_ingest: Date.now(),
      quality_flag: []
    });

    expect(event).toBeNull();
  });
});
