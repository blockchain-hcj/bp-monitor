import { BinanceClient } from "./binanceClient.js";
import { OkxClient } from "./okxClient.js";
import { PaperClient } from "./paperClient.js";
import { ExecutionIntent, ExecutionResult, Exchange, ExchangeExecutionClient, RuntimeConfig } from "../types.js";

export class ExecutionRouter {
  private readonly clients: Record<Exchange, ExchangeExecutionClient>;

  constructor(private readonly config: RuntimeConfig) {
    if (config.tradeMode === "paper") {
      this.clients = {
        binance: new PaperClient("binance"),
        okx: new PaperClient("okx")
      };
      return;
    }

    this.clients = {
      binance: new BinanceClient(config.bnApiKey, config.bnApiSecret),
      okx: new OkxClient(config.okxApiKey, config.okxApiSecret, config.okxApiPassphrase, config.okxCtValOverrides)
    };
  }

  client(exchange: Exchange): ExchangeExecutionClient {
    return this.clients[exchange];
  }

  async execute(intent: ExecutionIntent): Promise<ExecutionResult> {
    if (this.config.tradeMode === "paper") {
      return {
        ok: true,
        partialFill: false,
        status: "filled",
        filledQty: 0,
        avgPrice: 0,
        mode: "paper",
        legs: intent.legs.map((leg, idx) => ({
          exchange: leg.exchange,
          ok: true,
          status: "filled",
          filledQty: 0,
          avgPrice: 0,
          orderId: `paper-${intent.action}-${leg.exchange}-${Date.now()}-${idx}`
        }))
      };
    }

    const referencePrice = await this.getReferencePrice(intent.symbol);
    const targetBaseQty = intent.legs[0].notional_usdt / referencePrice;
    const normalized = await Promise.all(
      intent.legs.map(async (leg) => ({
        exchange: leg.exchange,
        qty: await this.clients[leg.exchange].normalizeBaseQty(leg.symbol, targetBaseQty)
      }))
    );
    const commonBaseQty = Math.min(...normalized.map((v) => v.qty));
    if (!Number.isFinite(commonBaseQty) || commonBaseQty <= 0) {
      throw new Error(
        `Invalid common base qty for ${intent.symbol}: ${commonBaseQty}; legNorm=${normalized
          .map((v) => `${v.exchange}:${v.qty}`)
          .join(",")}`
      );
    }

    console.log(
      `[arb][size] symbol=${intent.symbol} targetBaseQty=${targetBaseQty.toFixed(6)} commonBaseQty=${commonBaseQty.toFixed(6)} legs=${normalized
        .map((v) => `${v.exchange}:${v.qty}`)
        .join(",")}`
    );

    const legs = await Promise.all(
      intent.legs.map(async (leg) => {
        try {
          const ack = await this.clients[leg.exchange].placeMarketIocOrder(
            leg.symbol,
            leg.side,
            commonBaseQty,
            leg.reduce_only
          );
          return {
            exchange: leg.exchange,
            ok: true,
            orderId: ack.orderId,
            status: "filled" as const,
            filledQty: commonBaseQty,
            avgPrice: 0
          };
        } catch (error) {
          return {
            exchange: leg.exchange,
            ok: false,
            status: "rejected" as const,
            filledQty: 0,
            avgPrice: 0,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
    );

    const okCount = legs.filter((v) => v.ok).length;
    const filledLegs = legs.filter((v) => v.ok && Number.isFinite(v.filledQty));
    const filledQty = filledLegs.length > 0 ? Math.min(...filledLegs.map((v) => v.filledQty ?? 0)) : 0;
    const avgPrice =
      filledLegs.length > 0 ? filledLegs.reduce((sum, leg) => sum + (leg.avgPrice ?? 0), 0) / filledLegs.length : 0;
    return {
      ok: okCount === legs.length,
      partialFill: okCount > 0 && okCount < legs.length,
      status: okCount === legs.length ? "filled" : okCount > 0 ? "partial" : "rejected",
      filledQty,
      avgPrice,
      legs,
      mode: "live"
    };
  }

  private async getReferencePrice(symbol: string): Promise<number> {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`);
    if (!res.ok) {
      throw new Error(`Binance ticker failed: ${res.status}`);
    }
    const data = (await res.json()) as { bidPrice: string; askPrice: string };
    const bid = Number(data.bidPrice);
    const ask = Number(data.askPrice);
    const mid = (bid + ask) / 2;
    if (!Number.isFinite(mid) || mid <= 0) {
      throw new Error(`Invalid Binance reference price for ${symbol}`);
    }
    return mid;
  }
}
