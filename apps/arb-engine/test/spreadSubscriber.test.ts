import { describe, expect, it } from "vitest";
import { normalizeSpreadEvent } from "../src/nats/spreadSubscriber.js";

describe("normalizeSpreadEvent", () => {
  it("maps bn alias and keeps binance->okx spread", () => {
    const event = normalizeSpreadEvent({
      symbol: "btcusdt",
      exchange_a: "bn",
      exchange_b: "okx",
      best_bid_a: 100,
      best_ask_a: 101,
      best_bid_b: 102,
      best_ask_b: 103,
      bps_a_to_b: 10,
      bps_b_to_a: -3,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: []
    });

    expect(event).not.toBeNull();
    expect(event?.symbol).toBe("BTCUSDT");
    expect(event?.bps_binance_to_okx).toBe(10);
    expect(event?.bps_okx_to_binance).toBe(-3);
    expect(event?.best_bid_binance).toBe(100);
    expect(event?.best_ask_okx).toBe(103);
  });

  it("remaps bps when event arrives as okx->binance", () => {
    const event = normalizeSpreadEvent({
      symbol: "BTCUSDT",
      exchange_a: "okx",
      exchange_b: "binance",
      best_bid_a: 98,
      best_ask_a: 99,
      best_bid_b: 100,
      best_ask_b: 101,
      bps_a_to_b: 7,
      bps_b_to_a: 2,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: []
    });

    expect(event?.bps_binance_to_okx).toBe(2);
    expect(event?.bps_okx_to_binance).toBe(7);
    expect(event?.best_ask_binance).toBe(101);
    expect(event?.best_bid_okx).toBe(98);
  });

  it("filters unsupported exchange pair", () => {
    const event = normalizeSpreadEvent({
      symbol: "BTCUSDT",
      exchange_a: "deepbook",
      exchange_b: "okx",
      best_bid_a: 1,
      best_ask_a: 1.1,
      best_bid_b: 1,
      best_ask_b: 1.1,
      bps_a_to_b: 1,
      bps_b_to_a: 1,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: []
    });

    expect(event).toBeNull();
  });

  it("filters event with invalid best bid/ask", () => {
    const event = normalizeSpreadEvent({
      symbol: "BTCUSDT",
      exchange_a: "binance",
      exchange_b: "okx",
      best_bid_a: 100,
      best_ask_a: 0,
      best_bid_b: 100,
      best_ask_b: 101,
      bps_a_to_b: 1,
      bps_b_to_a: 2,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: []
    });
    expect(event).toBeNull();
  });
});
