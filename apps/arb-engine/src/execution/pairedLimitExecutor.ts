import { buildLimitLegPlan } from "./limitPricing.js";
import {
  ArbInputEvent,
  Direction,
  Exchange,
  ExchangeExecutionClient,
  ExecutionResultLeg,
  IntentAction,
  LegSide,
  OrderStatus,
  TradeMode
} from "../types.js";

export interface PairedLimitRequest {
  symbol: string;
  direction: Direction;
  action: IntentAction;
  event: ArbInputEvent;
  notionalUsdt: number;
  slippageBps: number;
  orderTtlMs: number;
}

export interface PairedLimitExecutionResult {
  ok: boolean;
  partialFill: boolean;
  status: OrderStatus;
  filledQty: number;
  avgPrice: number;
  hedged: boolean;
  reason?: string;
  legs: ExecutionResultLeg[];
  mode: TradeMode;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function oppositeSide(side: LegSide): LegSide {
  return side === "buy" ? "sell" : "buy";
}

function refMid(event: ArbInputEvent): number {
  const binanceMid = (event.best_bid_binance + event.best_ask_binance) / 2;
  const okxMid = (event.best_bid_okx + event.best_ask_okx) / 2;
  return (binanceMid + okxMid) / 2;
}

export class PairedLimitExecutor {
  constructor(
    private readonly clients: Record<Exchange, ExchangeExecutionClient>,
    private readonly mode: TradeMode
  ) {}

  async execute(request: PairedLimitRequest): Promise<PairedLimitExecutionResult> {
    const mid = refMid(request.event);
    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`invalid_reference_mid:${mid}`);
    }

    const targetBaseQty = request.notionalUsdt / mid;
    const legPlan = buildLimitLegPlan({
      event: request.event,
      direction: request.direction,
      action: request.action,
      slippageBps: request.slippageBps
    });

    const normalizedLegs = await Promise.all(
      legPlan.map(async (leg) => {
        const client = this.clients[leg.exchange];
        const qty = await client.normalizeBaseQty(request.symbol, targetBaseQty);
        const price = await client.normalizeLimitPrice(request.symbol, leg.side, leg.price);
        return { ...leg, qty, price };
      })
    );
    const commonQty = Math.min(...normalizedLegs.map((v) => v.qty));
    if (!Number.isFinite(commonQty) || commonQty <= 0) {
      throw new Error(`invalid_common_qty:${commonQty}`);
    }

    const placed = await Promise.all(
      normalizedLegs.map(async (leg) => {
        try {
          const ack = await this.clients[leg.exchange].placeLimitOrder(
            request.symbol,
            leg.side,
            commonQty,
            leg.price,
            request.action === "close",
            "GTC"
          );
          return { ...leg, ok: true as const, orderId: ack.orderId };
        } catch (error) {
          return {
            ...leg,
            ok: false as const,
            orderId: undefined,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );
    const placementFailed = placed.some((v) => !v.ok);
    if (placementFailed) {
      await Promise.all(
        placed
          .filter((v) => v.ok && v.orderId)
          .map(async (v) => {
            try {
              await this.clients[v.exchange].cancelOrder(request.symbol, v.orderId!);
            } catch {
              // Best effort cancel on partial placement failure.
            }
          })
      );
      return {
        ok: false,
        partialFill: false,
        status: "rejected",
        filledQty: 0,
        avgPrice: 0,
        hedged: false,
        reason: "limit_submit_failed",
        mode: this.mode,
        legs: placed.map((v) => ({
          exchange: v.exchange,
          ok: v.ok,
          orderId: v.orderId,
          status: v.ok ? "new" : "rejected",
          filledQty: 0,
          avgPrice: 0,
          error: v.ok ? undefined : v.error
        }))
      };
    }

    const orderIds = placed.map((v) => ({ exchange: v.exchange, side: v.side, orderId: v.orderId!, price: v.price }));
    const deadline = Date.now() + Math.max(50, request.orderTtlMs);
    let statuses = await this.readStatuses(request.symbol, orderIds);
    while (Date.now() < deadline && statuses.some((v) => v.status === "new" || v.status === "partial")) {
      if (statuses.every((v) => v.status === "filled")) {
        break;
      }
      await sleep(25);
      statuses = await this.readStatuses(request.symbol, orderIds);
    }

    await Promise.all(
      statuses
        .filter((v) => v.status === "new" || v.status === "partial")
        .map(async (v) => {
          try {
            await this.clients[v.exchange].cancelOrder(request.symbol, v.orderId);
          } catch {
            // Continue and re-read status; failure should not crash execution flow.
          }
        })
    );
    statuses = await this.readStatuses(request.symbol, orderIds);

    const byExchange = new Map<Exchange, (typeof statuses)[number]>();
    statuses.forEach((v) => byExchange.set(v.exchange, v));
    const bn = byExchange.get("binance")!;
    const okx = byExchange.get("okx")!;
    const imbalanceQty = Math.abs((bn.filledQty ?? 0) - (okx.filledQty ?? 0));

    let hedged = false;
    let reason: string | undefined;
    if (imbalanceQty > 1e-9) {
      const exposed = (bn.filledQty ?? 0) > (okx.filledQty ?? 0) ? bn : okx;
      const hedgeSide = oppositeSide(exposed.side);
      try {
        await this.clients[exposed.exchange].placeMarketIocOrder(
          request.symbol,
          hedgeSide,
          imbalanceQty,
          true
        );
        hedged = true;
        reason = "hedged_after_partial_fill";
      } catch (error) {
        reason = `hedge_failed:${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const allFilled = statuses.every((v) => v.status === "filled");
    const partialFill = !allFilled;
    const ok = allFilled || hedged;
    const status: OrderStatus = allFilled ? "filled" : hedged ? "canceled" : "partial";
    const legs: ExecutionResultLeg[] = statuses.map((v) => ({
      exchange: v.exchange,
      ok: v.status !== "rejected",
      orderId: v.orderId,
      status: v.status,
      filledQty: v.filledQty,
      avgPrice: v.avgPrice
    }));
    const minFilled = Math.min(...statuses.map((v) => v.filledQty));
    const avgPrice = statuses.reduce((sum, v) => sum + v.avgPrice, 0) / statuses.length;
    return {
      ok,
      partialFill,
      status,
      filledQty: Number.isFinite(minFilled) ? minFilled : 0,
      avgPrice: Number.isFinite(avgPrice) ? avgPrice : 0,
      hedged,
      reason,
      mode: this.mode,
      legs
    };
  }

  private async readStatuses(
    symbol: string,
    legs: Array<{ exchange: Exchange; side: LegSide; orderId: string; price: number }>
  ): Promise<Array<{ exchange: Exchange; side: LegSide; orderId: string; status: OrderStatus; filledQty: number; avgPrice: number }>> {
    const rows = await Promise.all(
      legs.map(async (leg) => {
        const state = await this.clients[leg.exchange].getOrderStatus(symbol, leg.orderId);
        return {
          exchange: leg.exchange,
          side: leg.side,
          orderId: leg.orderId,
          status: state.status,
          filledQty: state.filledQty,
          avgPrice: state.avgPrice || leg.price
        };
      })
    );
    return rows;
  }
}
