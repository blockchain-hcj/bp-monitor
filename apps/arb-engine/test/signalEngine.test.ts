import { describe, expect, it } from "vitest";
import { SignalEngine } from "../src/strategy/signalEngine.js";
import { StateStore } from "../src/strategy/stateStore.js";

describe("SignalEngine", () => {
  const baseConfig = {
    symbols: ["BTCUSDT"],
    thresholds: {
      BTCUSDT: {
        binance_to_okx: { open_bps: 10, close_bps: 4 },
        okx_to_binance: { open_bps: 11, close_bps: 5 }
      }
    },
    fee_bps: 2,
    slippage_bps: 1,
    notional_usdt: 100,
    event_stale_ms: 5000
  };

  it("opens only when net bps exceeds open threshold", () => {
    const store = new StateStore();
    const engine = new SignalEngine(baseConfig, store);

    const intents = engine.evaluate({
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
      bps_a_to_b: 15,
      bps_b_to_a: 0,
      bps_binance_to_okx: 15,
      bps_okx_to_binance: 0,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: []
    });

    expect(intents).toHaveLength(1);
    expect(intents[0].action).toBe("open");
    expect(intents[0].direction).toBe("binance_to_okx");
    expect(intents[0].net_bps).toBe(12);
  });

  it("closes when net bps drops below close threshold", () => {
    const store = new StateStore();
    store.setOpen("BTCUSDT", "binance_to_okx", 12, "test");
    const engine = new SignalEngine(baseConfig, store);

    const intents = engine.evaluate({
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
      bps_a_to_b: 7,
      bps_b_to_a: 0,
      bps_binance_to_okx: 7,
      bps_okx_to_binance: 0,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: []
    });

    expect(intents).toHaveLength(1);
    expect(intents[0].action).toBe("close");
  });

  it("does not open in close_only mode", () => {
    const store = new StateStore();
    store.setRiskMode("close_only");
    const engine = new SignalEngine(baseConfig, store);

    const intents = engine.evaluate({
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
      bps_a_to_b: 20,
      bps_b_to_a: 0,
      bps_binance_to_okx: 20,
      bps_okx_to_binance: 0,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: []
    });

    expect(intents).toHaveLength(0);
  });

  it("does not open when quality flags exist", () => {
    const store = new StateStore();
    const engine = new SignalEngine(baseConfig, store);
    const intents = engine.evaluate({
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
      bps_a_to_b: 20,
      bps_b_to_a: 0,
      bps_binance_to_okx: 20,
      bps_okx_to_binance: 0,
      ts_ingest: Date.now(),
      ts_publish: Date.now(),
      quality_flag: ["stale"]
    });
    expect(intents).toHaveLength(0);
  });
});
