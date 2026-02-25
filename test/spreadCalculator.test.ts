import { describe, expect, it } from "vitest";
import { DefaultSpreadCalculator } from "../src/spread/spreadCalculator.js";

describe("DefaultSpreadCalculator", () => {
  it("computes dual-direction bps", () => {
    const calc = new DefaultSpreadCalculator();
    const event = calc.compute(
      {
        exchange: "binance",
        symbol: "BTCUSDT",
        bid: 100,
        ask: 101,
        seq: 1,
        tsExchangeMs: 1000,
        tsIngestMs: 1001,
        staleMs: 1,
        qualityFlag: []
      },
      {
        exchange: "okx",
        symbol: "BTCUSDT",
        bid: 102,
        ask: 103,
        seq: 2,
        tsExchangeMs: 1002,
        tsIngestMs: 1003,
        staleMs: 1,
        qualityFlag: []
      }
    );

    expect(event.bps_a_to_b).toBeGreaterThan(0);
    expect(event.bps_b_to_a).toBeLessThan(0);
    expect(event.exchange_a).toBe("binance");
    expect(event.exchange_b).toBe("okx");
  });

  it("flags invalid mid ref", () => {
    const calc = new DefaultSpreadCalculator();
    const event = calc.compute(
      {
        exchange: "binance",
        symbol: "BTCUSDT",
        bid: 0,
        ask: 0,
        seq: 1,
        tsExchangeMs: 1000,
        tsIngestMs: 1001,
        staleMs: 1,
        qualityFlag: []
      },
      {
        exchange: "okx",
        symbol: "BTCUSDT",
        bid: 0,
        ask: 0,
        seq: 2,
        tsExchangeMs: 1002,
        tsIngestMs: 1003,
        staleMs: 1,
        qualityFlag: []
      }
    );
    expect(event.quality_flag).toContain("invalid_mid_ref");
  });
});
