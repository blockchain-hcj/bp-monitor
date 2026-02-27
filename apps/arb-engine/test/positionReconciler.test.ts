import { describe, expect, it } from "vitest";
import { PositionReconciler } from "../src/position/positionReconciler.js";
import { StateStore } from "../src/strategy/stateStore.js";
import { RiskGuard } from "../src/risk/guard.js";

describe("PositionReconciler", () => {
  it("syncs local state from exchange positions", async () => {
    const store = new StateStore();
    const risk = new RiskGuard(store);

    const fakeRouter = {
      client(exchange: "binance" | "okx") {
        return {
          async normalizeBaseQty(_symbol: string, baseQty: number) {
            return baseQty;
          },
          async normalizeLimitPrice(_symbol: string, _side: "buy" | "sell", rawPrice: number) {
            return rawPrice;
          },
          async placeMarketIocOrder() {
            return { orderId: "x" };
          },
          async placeLimitOrder() {
            return { orderId: "x" };
          },
          async getOrderStatus(_symbol: string, orderId: string) {
            return { orderId, status: "filled" as const, filledQty: 1, avgPrice: 1 };
          },
          async cancelOrder() {
            return { ok: true };
          },
          async getPosition(symbol: string) {
            if (exchange === "binance") {
              return { symbol, longNotionalUsdt: 100, shortNotionalUsdt: 0 };
            }
            return { symbol, longNotionalUsdt: 0, shortNotionalUsdt: 100 };
          },
          name() {
            return exchange;
          }
        };
      }
    };

    const reconciler = new PositionReconciler(
      {
        logLevel: "info",
        controlPort: 1,
        natsUrl: "",
        natsSubjectPrefix: "",
        tradeMode: "live",
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
          fee_bps: 1,
          slippage_bps: 1,
          notional_usdt: 100,
          event_stale_ms: 1000
        }
      },
      fakeRouter as never,
      store,
      risk
    );

    await reconciler.reconcileOnce();
    expect(store.getPosition("BTCUSDT", "binance_to_okx").isOpen).toBe(true);
    expect(store.getPosition("BTCUSDT", "okx_to_binance").isOpen).toBe(false);
  });
});
