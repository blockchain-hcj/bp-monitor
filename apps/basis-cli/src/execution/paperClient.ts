import { Exchange, ExchangeClient, ExchangePosition, LegSide, OrderState } from "../types.js";

export class PaperClient implements ExchangeClient {
  private readonly orders = new Map<string, OrderState>();
  private fillDelayMs = 800;

  constructor(private readonly exchange: Exchange) {}

  name(): Exchange {
    return this.exchange;
  }

  async normalizeBaseQty(_symbol: string, baseQty: number): Promise<number> {
    return Math.max(0, baseQty);
  }

  async placeLimitOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    price: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    const id = this.newOrderId(symbol, side, reduceOnly ? "close" : "open");
    this.orders.set(id, {
      orderId: id,
      status: "new",
      filledQty: 0,
      avgPrice: price,
    });
    // Simulate async fill after delay
    setTimeout(() => {
      const order = this.orders.get(id);
      if (order && order.status === "new") {
        this.orders.set(id, {
          ...order,
          status: "filled",
          filledQty: Math.max(0, baseQty),
          avgPrice: Math.max(0, price),
        });
      }
    }, this.fillDelayMs);
    return { orderId: id };
  }

  async placeMarketOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    const id = this.newOrderId(symbol, side, reduceOnly ? "close" : "open");
    this.orders.set(id, {
      orderId: id,
      status: "filled",
      filledQty: Math.max(0, baseQty),
      avgPrice: 0,
    });
    return { orderId: id };
  }

  async getOrderStatus(_symbol: string, orderId: string): Promise<OrderState> {
    return this.orders.get(orderId) ?? {
      orderId,
      status: "rejected",
      filledQty: 0,
      avgPrice: 0,
    };
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<{ ok: boolean }> {
    const prev = this.orders.get(orderId);
    if (!prev) return { ok: false };
    if (prev.status === "filled") return { ok: true };
    this.orders.set(orderId, { ...prev, status: "canceled" });
    return { ok: true };
  }

  async getTickSize(_symbol: string): Promise<number> {
    return 0.01;
  }

  async quantizePrice(price: number, _symbol: string, _side: LegSide): Promise<number> {
    return Math.round(price * 100) / 100;
  }

  async getPosition(symbol: string): Promise<ExchangePosition> {
    return { symbol, longNotionalUsdt: 0, shortNotionalUsdt: 0 };
  }

  private newOrderId(symbol: string, side: LegSide, mode: "open" | "close"): string {
    return `paper-${this.exchange}-${symbol}-${mode}-${side}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}
