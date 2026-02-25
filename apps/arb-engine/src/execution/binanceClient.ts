import crypto from "node:crypto";
import { ExchangeExecutionClient, ExchangePosition, LegSide } from "../types.js";

function toQuery(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

interface SymbolTradeRule {
  stepSizeRaw: string;
  minQtyRaw: string;
  marketStepSizeRaw: string;
  marketMinQtyRaw: string;
  stepSize: number;
  minQty: number;
  marketStepSize: number;
  marketMinQty: number;
  qtyPrecision: number;
  marketQtyPrecision: number;
}

export class BinanceClient implements ExchangeExecutionClient {
  private readonly baseUrl = "https://fapi.binance.com";
  private readonly ruleCache = new Map<string, SymbolTradeRule>();
  private hedgeMode: boolean | null = null;

  constructor(
    private readonly apiKey?: string,
    private readonly apiSecret?: string
  ) {}

  name() {
    return "binance" as const;
  }

  async normalizeBaseQty(symbol: string, baseQty: number): Promise<number> {
    this.assertCredential();
    const rules = await this.getSymbolTradeRule(symbol);
    return Number(this.quantizeQuantity(baseQty, rules, true));
  }

  async placeMarketIocOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    this.assertCredential();
    const rules = await this.getSymbolTradeRule(symbol);
    const baseQuantity = this.quantizeQuantity(baseQty, rules, true);
    const hedgeMode = await this.isHedgeMode();
    let lastErrorText = "";

    for (let decimals = rules.marketQtyPrecision; decimals >= 0; decimals -= 1) {
      const quantity = this.reformatQuantity(baseQuantity, decimals);
      const ts = Date.now();
      const params: Record<string, string | number | boolean> = {
        symbol,
        side: side.toUpperCase(),
        type: "MARKET",
        quantity,
        timestamp: ts,
        recvWindow: 5000
      };
      if (hedgeMode) {
        params.positionSide = this.inferPositionSide(side, reduceOnly);
      } else {
        params.reduceOnly = reduceOnly;
      }

      const query = toQuery(params);
      const signature = sign(this.apiSecret!, query);
      const res = await fetch(`${this.baseUrl}/fapi/v1/order?${query}&signature=${signature}`, {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": this.apiKey!
        }
      });

      if (res.ok) {
        const payload = (await res.json()) as { orderId?: number };
        return { orderId: String(payload.orderId ?? "unknown") };
      }

      const msg = await res.text();
      lastErrorText = `Binance order failed: ${res.status} ${msg}; symbol=${symbol}; qty=${quantity}; side=${side}; reduceOnly=${reduceOnly}`;
      if (!msg.includes("\"code\":-1111")) {
        throw new Error(lastErrorText);
      }
    }

    throw new Error(lastErrorText || `Binance order failed: precision fallback exhausted; symbol=${symbol}`);
  }

  async getPosition(symbol: string): Promise<ExchangePosition> {
    this.assertCredential();
    const ts = Date.now();
    const query = toQuery({ timestamp: ts, recvWindow: 5000 });
    const signature = sign(this.apiSecret!, query);
    const res = await fetch(`${this.baseUrl}/fapi/v2/positionRisk?${query}&signature=${signature}`, {
      headers: {
        "X-MBX-APIKEY": this.apiKey!
      }
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Binance position query failed: ${res.status} ${msg}`);
    }

    const rows = (await res.json()) as Array<{ symbol: string; positionAmt: string; markPrice: string }>;
    const matched = rows.filter((v) => v.symbol === symbol);
    if (matched.length === 0) {
      return { symbol, longNotionalUsdt: 0, shortNotionalUsdt: 0 };
    }

    let longNotionalUsdt = 0;
    let shortNotionalUsdt = 0;
    for (const row of matched) {
      const amt = Number(row.positionAmt);
      const px = Number(row.markPrice);
      const notional = Math.abs(amt * px);
      if (!Number.isFinite(notional) || notional <= 0) {
        continue;
      }
      if (amt > 0) {
        longNotionalUsdt += notional;
      } else if (amt < 0) {
        shortNotionalUsdt += notional;
      }
    }
    return { symbol, longNotionalUsdt, shortNotionalUsdt };
  }

  private async getReferencePrice(symbol: string): Promise<number> {
    const res = await fetch(`${this.baseUrl}/fapi/v1/ticker/bookTicker?symbol=${symbol}`);
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

  private inferPositionSide(side: LegSide, reduceOnly: boolean): "LONG" | "SHORT" {
    if (side === "buy") {
      return reduceOnly ? "SHORT" : "LONG";
    }
    return reduceOnly ? "LONG" : "SHORT";
  }

  private quantizeQuantity(rawQty: number, rules: SymbolTradeRule, marketOrder: boolean): string {
    const precision = Math.max(0, marketOrder ? rules.marketQtyPrecision : rules.qtyPrecision);
    const scale = 10 ** precision;
    const step = marketOrder ? rules.marketStepSize : rules.stepSize;
    const minQty = marketOrder ? rules.marketMinQty : rules.minQty;
    const stepInt = Math.max(1, Math.round(step * scale));
    const minInt = Math.ceil(minQty * scale);

    let qtyInt = Math.floor((rawQty * scale) / stepInt) * stepInt;
    if (qtyInt < minInt) {
      qtyInt = Math.ceil(minInt / stepInt) * stepInt;
    }

    return (qtyInt / scale).toFixed(precision);
  }

  private async getSymbolTradeRule(symbol: string): Promise<SymbolTradeRule> {
    const cached = this.ruleCache.get(symbol);
    if (cached) {
      return cached;
    }

    const res = await fetch(`${this.baseUrl}/fapi/v1/exchangeInfo?symbol=${symbol}`);
    if (!res.ok) {
      throw new Error(`Binance exchangeInfo failed: ${res.status}`);
    }
    const payload = (await res.json()) as {
      symbols?: Array<{
        quantityPrecision?: number;
        filters?: Array<{ filterType?: string; stepSize?: string; minQty?: string }>;
      }>;
    };
    const item = payload.symbols?.[0];
    const lot = item?.filters?.find((f) => f.filterType === "LOT_SIZE");
    const marketLot = item?.filters?.find((f) => f.filterType === "MARKET_LOT_SIZE");
    if (!item || !lot?.stepSize || !lot.minQty) {
      throw new Error(`Binance LOT_SIZE not found for ${symbol}`);
    }
    const marketStepRaw = marketLot?.stepSize ?? lot.stepSize;
    const marketMinRaw = marketLot?.minQty ?? lot.minQty;

    const stepPrecision = this.decimalsFromStepSize(lot.stepSize);
    const marketStepPrecision = this.decimalsFromStepSize(marketStepRaw);
    const quantityPrecision = item.quantityPrecision ?? stepPrecision;
    const rule: SymbolTradeRule = {
      stepSizeRaw: lot.stepSize,
      minQtyRaw: lot.minQty,
      marketStepSizeRaw: marketStepRaw,
      marketMinQtyRaw: marketMinRaw,
      stepSize: Number(lot.stepSize),
      minQty: Number(lot.minQty),
      marketStepSize: Number(marketStepRaw),
      marketMinQty: Number(marketMinRaw),
      qtyPrecision: Math.min(stepPrecision, quantityPrecision),
      marketQtyPrecision: Math.min(marketStepPrecision, quantityPrecision)
    };
    this.ruleCache.set(symbol, rule);
    return rule;
  }

  private decimalsFromStepSize(stepSize: string): number {
    if (!stepSize.includes(".")) {
      return 0;
    }
    const frac = stepSize.split(".")[1];
    return frac.replace(/0+$/, "").length;
  }

  private reformatQuantity(quantity: string, decimals: number): string {
    const value = Number(quantity);
    if (!Number.isFinite(value) || value <= 0) {
      return quantity;
    }
    const factor = 10 ** Math.max(0, decimals);
    const floored = Math.floor(value * factor) / factor;
    return floored.toFixed(Math.max(0, decimals));
  }

  private async isHedgeMode(): Promise<boolean> {
    if (this.hedgeMode !== null) {
      return this.hedgeMode;
    }
    const ts = Date.now();
    const query = toQuery({ timestamp: ts, recvWindow: 5000 });
    const signature = sign(this.apiSecret!, query);
    const res = await fetch(`${this.baseUrl}/fapi/v1/positionSide/dual?${query}&signature=${signature}`, {
      headers: {
        "X-MBX-APIKEY": this.apiKey!
      }
    });
    if (!res.ok) {
      throw new Error(`Binance hedge mode query failed: ${res.status}`);
    }
    const payload = (await res.json()) as { dualSidePosition?: boolean | string };
    this.hedgeMode =
      payload.dualSidePosition === true ||
      payload.dualSidePosition === "true";
    return this.hedgeMode;
  }

  private assertCredential(): void {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Binance credentials are required in live mode");
    }
  }
}
