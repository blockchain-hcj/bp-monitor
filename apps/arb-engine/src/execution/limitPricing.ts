import { ArbInputEvent, Direction, IntentAction, LegSide } from "../types.js";

export interface LimitLegPlan {
  exchange: "binance" | "okx";
  side: LegSide;
  price: number;
}

export interface LimitPricingInput {
  event: ArbInputEvent;
  direction: Direction;
  action: IntentAction;
  slippageBps: number;
}

function sideFor(exchange: "binance" | "okx", direction: Direction, action: IntentAction): LegSide {
  const isOpen = action === "open";
  if (direction === "binance_to_okx") {
    if (exchange === "binance") {
      return isOpen ? "buy" : "sell";
    }
    return isOpen ? "sell" : "buy";
  }
  if (exchange === "okx") {
    return isOpen ? "buy" : "sell";
  }
  return isOpen ? "sell" : "buy";
}

function anchorPrice(event: ArbInputEvent, exchange: "binance" | "okx", side: LegSide): number {
  if (exchange === "binance") {
    return side === "buy" ? event.best_ask_binance : event.best_bid_binance;
  }
  return side === "buy" ? event.best_ask_okx : event.best_bid_okx;
}

function applySlippage(anchor: number, side: LegSide, slippageBps: number): number {
  const ratio = Math.max(0, slippageBps) / 10_000;
  if (side === "buy") {
    return anchor * (1 + ratio);
  }
  return anchor * (1 - ratio);
}

export function buildLimitLegPlan(input: LimitPricingInput): LimitLegPlan[] {
  const bnSide = sideFor("binance", input.direction, input.action);
  const okxSide = sideFor("okx", input.direction, input.action);
  const bnAnchor = anchorPrice(input.event, "binance", bnSide);
  const okxAnchor = anchorPrice(input.event, "okx", okxSide);

  return [
    {
      exchange: "binance",
      side: bnSide,
      price: applySlippage(bnAnchor, bnSide, input.slippageBps)
    },
    {
      exchange: "okx",
      side: okxSide,
      price: applySlippage(okxAnchor, okxSide, input.slippageBps)
    }
  ];
}
