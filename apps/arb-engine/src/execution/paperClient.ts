import { Exchange, ExchangeExecutionClient, ExchangePosition, LegSide, OrderState, TimeInForce } from "../types.js";

export class PaperClient implements ExchangeExecutionClient {
  private readonly orders = new Map<string, OrderState>();

  constructor(private readonly exchange: Exchange) {}

  name(): Exchange {
    return this.exchange;
  }

  async normalizeBaseQty(_symbol: string, baseQty: number): Promise<number> {
    return Math.max(0, baseQty);
  }

  async normalizeLimitPrice(_symbol: string, _side: LegSide, rawPrice: number): Promise<number> {
    return Math.max(0, rawPrice);
  }

  async placeMarketIocOrder(
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
      avgPrice: 0
    });
    return { orderId: id };
  }

  async placeLimitOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    price: number,
    reduceOnly: boolean,
    _tif: TimeInForce
  ): Promise<{ orderId: string }> {
    const id = this.newOrderId(symbol, side, reduceOnly ? "close" : "open");
    this.orders.set(id, {
      orderId: id,
      status: "filled",
      filledQty: Math.max(0, baseQty),
      avgPrice: Math.max(0, price)
    });
    return { orderId: id };
  }

  async getOrderStatus(_symbol: string, orderId: string): Promise<OrderState> {
    return (
      this.orders.get(orderId) ?? {
        orderId,
        status: "rejected",
        filledQty: 0,
        avgPrice: 0
      }
    );
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<{ ok: boolean }> {
    const previous = this.orders.get(orderId);
    if (!previous) {
      return { ok: false };
    }
    if (previous.status === "filled") {
      return { ok: true };
    }
    this.orders.set(orderId, { ...previous, status: "canceled" });
    return { ok: true };
  }

  async getPosition(symbol: string): Promise<ExchangePosition> {
    return { symbol, longNotionalUsdt: 0, shortNotionalUsdt: 0 };
  }

  private newOrderId(symbol: string, side: LegSide, mode: "open" | "close"): string {
    return `paper-${this.exchange}-${symbol}-${mode}-${side}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}
