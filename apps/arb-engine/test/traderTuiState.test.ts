import { describe, expect, it } from "vitest";
import { buildTraderScreen } from "../src/cli/traderTuiState.js";

describe("buildTraderScreen", () => {
  it("renders key market and execution fields", () => {
    const lines = buildTraderScreen(
      {
        symbol: "BTCUSDT",
        direction: "binance_to_okx",
        qtyUsdt: 100,
        slippageBps: 2,
        orderTtlMs: 200
      },
      {
        riskMode: "normal",
        positionOpen: true,
        tradeEnabled: false,
        uiTick: 1,
        uiTime: "2026-02-27T12:00:00.000Z",
        latestEvent: {
          symbol: "BTCUSDT",
          exchange_a: "binance",
          exchange_b: "okx",
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
        },
        lastExecution: {
          ok: true,
          partialFill: false,
          status: "filled",
          filledQty: 1,
          avgPrice: 101,
          hedged: false,
          legs: [
            { exchange: "binance", ok: true, status: "filled", filledQty: 1, avgPrice: 101, orderId: "1" },
            { exchange: "okx", ok: true, status: "filled", filledQty: 1, avgPrice: 102, orderId: "2" }
          ],
          mode: "paper"
        },
        lastError: null
      }
    );

    expect(lines[0]).toContain("Basis Trader CLI");
    expect(lines.some((v) => v.includes("ui_tick=1"))).toBe(true);
    expect(lines.some((v) => v.includes("binance bid/ask"))).toBe(true);
    expect(lines.some((v) => v.includes("trade_enabled=N"))).toBe(true);
    expect(lines.some((v) => v.includes("last_exec ok=Y"))).toBe(true);
  });
});
