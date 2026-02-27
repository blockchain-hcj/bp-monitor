import { describe, expect, it } from "vitest";
import { PairedLimitExecutor } from "../src/execution/pairedLimitExecutor.js";
import { ExchangeExecutionClient, OrderState } from "../src/types.js";

class FakeClient implements ExchangeExecutionClient {
  private idSeq = 0;
  public readonly marketOrders: Array<{ side: "buy" | "sell"; qty: number; reduceOnly: boolean }> = [];
  public readonly canceled: string[] = [];

  constructor(
    private readonly exchange: "binance" | "okx",
    private readonly statusSequences: Record<string, OrderState[]>
  ) {}

  name() {
    return this.exchange;
  }

  async normalizeBaseQty(_symbol: string, baseQty: number): Promise<number> {
    return baseQty;
  }

  async normalizeLimitPrice(_symbol: string, _side: "buy" | "sell", rawPrice: number): Promise<number> {
    return rawPrice;
  }

  async placeMarketIocOrder(
    _symbol: string,
    side: "buy" | "sell",
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    this.marketOrders.push({ side, qty: baseQty, reduceOnly });
    return { orderId: `${this.exchange}-mkt-${++this.idSeq}` };
  }

  async placeLimitOrder(): Promise<{ orderId: string }> {
    const id = `${this.exchange}-lim-${++this.idSeq}`;
    if (!this.statusSequences[id]) {
      this.statusSequences[id] = [{ orderId: id, status: "new", filledQty: 0, avgPrice: 0 }];
    }
    return { orderId: id };
  }

  async getOrderStatus(_symbol: string, orderId: string): Promise<OrderState> {
    const sequence = this.statusSequences[orderId];
    if (!sequence || sequence.length === 0) {
      return { orderId, status: "rejected", filledQty: 0, avgPrice: 0 };
    }
    const current = sequence[0];
    if (sequence.length > 1) {
      sequence.shift();
    }
    return current;
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<{ ok: boolean }> {
    this.canceled.push(orderId);
    return { ok: true };
  }

  async getPosition(symbol: string): Promise<{ symbol: string; longNotionalUsdt: number; shortNotionalUsdt: number }> {
    return { symbol, longNotionalUsdt: 0, shortNotionalUsdt: 0 };
  }
}

function buildEvent() {
  return {
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
}

describe("PairedLimitExecutor", () => {
  it("succeeds when both legs are filled", async () => {
    const bnStatus: Record<string, OrderState[]> = {
      "binance-lim-1": [{ orderId: "binance-lim-1", status: "filled", filledQty: 1, avgPrice: 101 }]
    };
    const okxStatus: Record<string, OrderState[]> = {
      "okx-lim-1": [{ orderId: "okx-lim-1", status: "filled", filledQty: 1, avgPrice: 102 }]
    };
    const bn = new FakeClient("binance", bnStatus);
    const okx = new FakeClient("okx", okxStatus);
    const executor = new PairedLimitExecutor({ binance: bn, okx }, "paper");

    const result = await executor.execute({
      symbol: "BTCUSDT",
      direction: "binance_to_okx",
      action: "open",
      event: buildEvent(),
      notionalUsdt: 100,
      slippageBps: 2,
      orderTtlMs: 200
    });

    expect(result.ok).toBe(true);
    expect(result.partialFill).toBe(false);
    expect(result.status).toBe("filled");
    expect(result.hedged).toBe(false);
  });

  it("hedges after partial fill", async () => {
    const bn = new FakeClient("binance", {
      "binance-lim-1": [{ orderId: "binance-lim-1", status: "filled", filledQty: 1, avgPrice: 101 }]
    });
    const okx = new FakeClient("okx", {
      "okx-lim-1": [{ orderId: "okx-lim-1", status: "canceled", filledQty: 0, avgPrice: 0 }]
    });
    const executor = new PairedLimitExecutor({ binance: bn, okx }, "paper");

    const result = await executor.execute({
      symbol: "BTCUSDT",
      direction: "binance_to_okx",
      action: "open",
      event: buildEvent(),
      notionalUsdt: 100,
      slippageBps: 2,
      orderTtlMs: 50
    });

    expect(result.partialFill).toBe(true);
    expect(result.hedged).toBe(true);
    expect(result.reason).toBe("hedged_after_partial_fill");
    expect(bn.marketOrders).toHaveLength(1);
    expect(bn.marketOrders[0].side).toBe("sell");
    expect(bn.marketOrders[0].reduceOnly).toBe(true);
  });

  it("cancels both legs when no fills", async () => {
    const bn = new FakeClient("binance", {
      "binance-lim-1": [{ orderId: "binance-lim-1", status: "new", filledQty: 0, avgPrice: 0 }]
    });
    const okx = new FakeClient("okx", {
      "okx-lim-1": [{ orderId: "okx-lim-1", status: "new", filledQty: 0, avgPrice: 0 }]
    });
    const executor = new PairedLimitExecutor({ binance: bn, okx }, "paper");

    const result = await executor.execute({
      symbol: "BTCUSDT",
      direction: "binance_to_okx",
      action: "open",
      event: buildEvent(),
      notionalUsdt: 100,
      slippageBps: 2,
      orderTtlMs: 50
    });

    expect(result.ok).toBe(false);
    expect(result.partialFill).toBe(true);
    expect(bn.canceled).toContain("binance-lim-1");
    expect(okx.canceled).toContain("okx-lim-1");
  });
});
