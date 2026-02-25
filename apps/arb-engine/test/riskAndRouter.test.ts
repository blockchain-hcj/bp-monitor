import { describe, expect, it } from "vitest";
import { RiskGuard } from "../src/risk/guard.js";
import { StateStore } from "../src/strategy/stateStore.js";
import { ExecutionRouter } from "../src/execution/router.js";

describe("RiskGuard", () => {
  it("switches to close_only when quality flags are present", () => {
    const store = new StateStore();
    const guard = new RiskGuard(store);

    guard.onEvent({
      symbol: "BTCUSDT",
      exchange_a: "binance",
      exchange_b: "okx",
      bps_a_to_b: 1,
      bps_b_to_a: 2,
      bps_binance_to_okx: 1,
      bps_okx_to_binance: 2,
      ts_ingest: Date.now(),
      quality_flag: ["stale"]
    });

    expect(store.getRiskMode()).toBe("close_only");
  });
});

describe("ExecutionRouter paper mode", () => {
  it("returns successful simulated execution", async () => {
    const router = new ExecutionRouter({
      logLevel: "info",
      controlPort: 1,
      natsUrl: "nats://127.0.0.1:4222",
      natsSubjectPrefix: "spread",
      tradeMode: "paper",
      reconcileIntervalMs: 1000,
      okxCtValOverrides: {},
      strategy: {
        symbols: ["BTCUSDT"],
        thresholds: {
          BTCUSDT: {
            binance_to_okx: { open_bps: 10, close_bps: 5 },
            okx_to_binance: { open_bps: 10, close_bps: 5 }
          }
        },
        fee_bps: 2,
        slippage_bps: 1,
        notional_usdt: 100,
        event_stale_ms: 3000
      }
    });

    const result = await router.execute({
      action: "open",
      symbol: "BTCUSDT",
      direction: "binance_to_okx",
      reason: "test",
      raw_bps: 10,
      net_bps: 7,
      ts: Date.now(),
      legs: [
        {
          exchange: "binance",
          side: "buy",
          symbol: "BTCUSDT",
          notional_usdt: 100,
          reduce_only: false
        },
        {
          exchange: "okx",
          side: "sell",
          symbol: "BTCUSDT",
          notional_usdt: 100,
          reduce_only: false
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("paper");
    expect(result.legs.every((v) => v.ok)).toBe(true);
  });
});
