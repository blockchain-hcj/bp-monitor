import { describe, expect, it } from "vitest";
import { buildLimitLegPlan } from "../src/execution/limitPricing.js";

const baseEvent = {
  symbol: "BTCUSDT",
  exchange_a: "binance" as const,
  exchange_b: "okx" as const,
  best_bid_a: 100,
  best_ask_a: 101,
  best_bid_b: 102,
  best_ask_b: 103,
  best_bid_binance: 100,
  best_ask_binance: 101,
  best_bid_okx: 102,
  best_ask_okx: 103,
  bps_a_to_b: 10,
  bps_b_to_a: -3,
  bps_binance_to_okx: 10,
  bps_okx_to_binance: -3,
  ts_ingest: Date.now(),
  ts_publish: Date.now(),
  quality_flag: []
};

describe("buildLimitLegPlan", () => {
  it("prices open binance_to_okx with ask/bid anchors", () => {
    const legs = buildLimitLegPlan({
      event: baseEvent,
      direction: "binance_to_okx",
      action: "open",
      slippageBps: 10
    });

    expect(legs).toHaveLength(2);
    const binance = legs.find((v) => v.exchange === "binance")!;
    const okx = legs.find((v) => v.exchange === "okx")!;
    expect(binance.side).toBe("buy");
    expect(okx.side).toBe("sell");
    expect(binance.price).toBeCloseTo(101.101, 6);
    expect(okx.price).toBeCloseTo(101.898, 6);
  });

  it("reverses side for close", () => {
    const legs = buildLimitLegPlan({
      event: baseEvent,
      direction: "binance_to_okx",
      action: "close",
      slippageBps: 10
    });
    const binance = legs.find((v) => v.exchange === "binance")!;
    const okx = legs.find((v) => v.exchange === "okx")!;
    expect(binance.side).toBe("sell");
    expect(okx.side).toBe("buy");
    expect(binance.price).toBeCloseTo(99.9, 6);
    expect(okx.price).toBeCloseTo(103.103, 6);
  });

  it("supports open okx_to_binance direction", () => {
    const legs = buildLimitLegPlan({
      event: baseEvent,
      direction: "okx_to_binance",
      action: "open",
      slippageBps: 5
    });
    const binance = legs.find((v) => v.exchange === "binance")!;
    const okx = legs.find((v) => v.exchange === "okx")!;
    expect(binance.side).toBe("sell");
    expect(okx.side).toBe("buy");
    expect(binance.price).toBeCloseTo(99.95, 6);
    expect(okx.price).toBeCloseTo(103.0515, 6);
  });
});
