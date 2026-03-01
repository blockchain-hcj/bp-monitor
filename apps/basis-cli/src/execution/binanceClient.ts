import crypto from "node:crypto";
import { ExchangeClient, ExchangePosition, LegSide, OpenOrderState, OrderState } from "../types.js";
import { fetchWithContext } from "./errorFormat.js";

function toQuery(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

interface SymbolTradeRule {
  stepSize: number;
  minQty: number;
  qtyPrecision: number;
  tickSize: number;
  pricePrecision: number;
}

export class BinanceClient implements ExchangeClient {
  private readonly baseUrl = "https://fapi.binance.com";
  private readonly ruleCache = new Map<string, SymbolTradeRule>();
  private hedgeMode: boolean | null = null;

  constructor(
    private readonly apiKey?: string,
    private readonly apiSecret?: string,
    private readonly hedgeModeOverride: boolean | null = null
  ) {}

  name() {
    return "binance" as const;
  }

  async normalizeBaseQty(symbol: string, baseQty: number): Promise<number> {
    const rules = await this.getSymbolTradeRule(symbol);
    const precision = Math.max(0, rules.qtyPrecision);
    const scale = 10 ** precision;
    const stepInt = Math.max(1, Math.round(rules.stepSize * scale));
    const minInt = Math.ceil(rules.minQty * scale);

    let qtyInt = Math.floor((baseQty * scale) / stepInt) * stepInt;
    if (qtyInt < minInt) {
      qtyInt = Math.ceil(minInt / stepInt) * stepInt;
    }
    return Number((qtyInt / scale).toFixed(precision));
  }

  async placeLimitOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    price: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    this.assertCredential();
    const rules = await this.getSymbolTradeRule(symbol);
    const quantity = this.formatQuantity(baseQty, rules);
    const normalizedPrice = this.formatPrice(price, rules, side);
    const hedgeMode = await this.isHedgeMode();
    const ts = Date.now();

    const params: Record<string, string | number | boolean> = {
      symbol,
      side: side.toUpperCase(),
      type: "LIMIT",
      quantity,
      price: normalizedPrice,
      timeInForce: "GTC",
      timestamp: ts,
      recvWindow: 5000,
    };
    if (hedgeMode) {
      params.positionSide = this.inferPositionSide(side, reduceOnly);
    } else {
      params.reduceOnly = reduceOnly;
    }

    const query = toQuery(params);
    const signature = sign(this.apiSecret!, query);
    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v1/order?${query}&signature=${signature}`,
      {
        method: "POST",
        headers: { "X-MBX-APIKEY": this.apiKey! },
      },
      `POST /fapi/v1/order LIMIT symbol=${symbol}`
    );

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Binance limit order failed: ${res.status} ${msg}; symbol=${symbol}; qty=${quantity}; price=${normalizedPrice}`);
    }
    const payload = (await res.json()) as { orderId?: number };
    return { orderId: String(payload.orderId ?? "unknown") };
  }

  async placeMarketOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    this.assertCredential();
    const rules = await this.getSymbolTradeRule(symbol);
    const quantity = this.formatQuantity(baseQty, rules);
    const hedgeMode = await this.isHedgeMode();
    const ts = Date.now();

    const params: Record<string, string | number | boolean> = {
      symbol,
      side: side.toUpperCase(),
      type: "MARKET",
      quantity,
      timestamp: ts,
      recvWindow: 5000,
    };
    if (hedgeMode) {
      params.positionSide = this.inferPositionSide(side, reduceOnly);
    } else {
      params.reduceOnly = reduceOnly;
    }

    const query = toQuery(params);
    const signature = sign(this.apiSecret!, query);
    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v1/order?${query}&signature=${signature}`,
      {
        method: "POST",
        headers: { "X-MBX-APIKEY": this.apiKey! },
      },
      `POST /fapi/v1/order MARKET symbol=${symbol}`
    );

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Binance market order failed: ${res.status} ${msg}; symbol=${symbol}; qty=${quantity}`);
    }
    const payload = (await res.json()) as { orderId?: number };
    return { orderId: String(payload.orderId ?? "unknown") };
  }

  async getOrderStatus(symbol: string, orderId: string): Promise<OrderState> {
    this.assertCredential();
    const ts = Date.now();
    const query = toQuery({ symbol, orderId, timestamp: ts, recvWindow: 5000 });
    const signature = sign(this.apiSecret!, query);
    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v1/order?${query}&signature=${signature}`,
      { headers: { "X-MBX-APIKEY": this.apiKey! } },
      `GET /fapi/v1/order status symbol=${symbol} orderId=${orderId}`
    );
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Binance order status failed: ${res.status} ${msg}`);
    }
    const payload = (await res.json()) as { status?: string; executedQty?: string; avgPrice?: string };
    return {
      orderId,
      status: this.mapStatus(payload.status),
      filledQty: Number(payload.executedQty ?? "0"),
      avgPrice: Number(payload.avgPrice ?? "0"),
    };
  }

  async getOpenOrders(symbol: string): Promise<OpenOrderState[]> {
    this.assertCredential();
    const ts = Date.now();
    const query = toQuery({ symbol, timestamp: ts, recvWindow: 5000 });
    const signature = sign(this.apiSecret!, query);
    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v1/openOrders?${query}&signature=${signature}`,
      { headers: { "X-MBX-APIKEY": this.apiKey! } },
      `GET /fapi/v1/openOrders symbol=${symbol}`
    );
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Binance open orders failed: ${res.status} ${msg}`);
    }
    const payload = (await res.json()) as Array<{
      orderId?: number | string;
      side?: string;
      price?: string;
      executedQty?: string;
      avgPrice?: string;
      status?: string;
      updateTime?: number;
    }>;
    return payload
      .map((row): OpenOrderState => ({
        orderId: String(row.orderId ?? "unknown"),
        side: row.side?.toUpperCase() === "SELL" ? "sell" : "buy",
        price: Number(row.price ?? "0"),
        status: this.mapStatus(row.status),
        filledQty: Number(row.executedQty ?? "0"),
        avgPrice: Number(row.avgPrice ?? "0"),
        updateTimeMs: Number(row.updateTime ?? Date.now()),
      }))
      .filter((row) => row.status === "new" || row.status === "partial");
  }

  async cancelOrder(symbol: string, orderId: string): Promise<{ ok: boolean }> {
    this.assertCredential();
    const ts = Date.now();
    const query = toQuery({ symbol, orderId, timestamp: ts, recvWindow: 5000 });
    const signature = sign(this.apiSecret!, query);
    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v1/order?${query}&signature=${signature}`,
      {
        method: "DELETE",
        headers: { "X-MBX-APIKEY": this.apiKey! },
      },
      `DELETE /fapi/v1/order symbol=${symbol} orderId=${orderId}`
    );
    return { ok: res.ok };
  }

  async getTickSize(symbol: string): Promise<number> {
    const rules = await this.getSymbolTradeRule(symbol);
    return rules.tickSize;
  }

  async quantizePrice(price: number, symbol: string, side: LegSide): Promise<number> {
    const rules = await this.getSymbolTradeRule(symbol);
    return Number(this.formatPrice(price, rules, side));
  }

  async getPosition(symbol: string): Promise<ExchangePosition> {
    this.assertCredential();
    const ts = Date.now();
    const query = toQuery({ timestamp: ts, recvWindow: 5000 });
    const signature = sign(this.apiSecret!, query);
    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v2/positionRisk?${query}&signature=${signature}`,
      { headers: { "X-MBX-APIKEY": this.apiKey! } },
      `GET /fapi/v2/positionRisk symbol=${symbol}`
    );

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Binance position query failed: ${res.status} ${msg}`);
    }

    const rows = (await res.json()) as Array<{
      symbol: string;
      positionAmt: string;
      markPrice: string;
      entryPrice?: string;
    }>;
    const matched = rows.filter((v) => v.symbol === symbol);
    if (matched.length === 0) {
      return {
        symbol,
        longQty: 0,
        shortQty: 0,
        longNotionalUsdt: 0,
        shortNotionalUsdt: 0,
        longAvgEntryPrice: 0,
        shortAvgEntryPrice: 0,
      };
    }

    let longQty = 0;
    let shortQty = 0;
    let longNotionalUsdt = 0;
    let shortNotionalUsdt = 0;
    let longEntryQty = 0;
    let shortEntryQty = 0;
    let longEntryCost = 0;
    let shortEntryCost = 0;
    for (const row of matched) {
      const amt = Number(row.positionAmt);
      const px = Number(row.markPrice);
      const entry = Number(row.entryPrice ?? "0");
      const notional = Math.abs(amt * px);
      if (!Number.isFinite(notional) || notional <= 0) continue;
      if (amt > 0) {
        longQty += amt;
        longNotionalUsdt += notional;
        if (Number.isFinite(entry) && entry > 0) {
          longEntryQty += amt;
          longEntryCost += amt * entry;
        }
      } else if (amt < 0) {
        const absAmt = Math.abs(amt);
        shortQty += absAmt;
        shortNotionalUsdt += notional;
        if (Number.isFinite(entry) && entry > 0) {
          shortEntryQty += absAmt;
          shortEntryCost += absAmt * entry;
        }
      }
    }
    return {
      symbol,
      longQty,
      shortQty,
      longNotionalUsdt,
      shortNotionalUsdt,
      longAvgEntryPrice: longEntryQty > 0 ? longEntryCost / longEntryQty : 0,
      shortAvgEntryPrice: shortEntryQty > 0 ? shortEntryCost / shortEntryQty : 0,
    };
  }

  private formatQuantity(rawQty: number, rules: SymbolTradeRule): string {
    const precision = Math.max(0, rules.qtyPrecision);
    const scale = 10 ** precision;
    const stepInt = Math.max(1, Math.round(rules.stepSize * scale));
    const minInt = Math.ceil(rules.minQty * scale);

    let qtyInt = Math.floor((rawQty * scale) / stepInt) * stepInt;
    if (qtyInt < minInt) {
      qtyInt = Math.ceil(minInt / stepInt) * stepInt;
    }
    return (qtyInt / scale).toFixed(precision);
  }

  private formatPrice(rawPrice: number, rules: SymbolTradeRule, side: LegSide): string {
    const precision = Math.max(0, rules.pricePrecision);
    const tick = Math.max(rules.tickSize, 1e-12);
    const normalizedRaw =
      side === "buy"
        ? Math.ceil(rawPrice / tick) * tick
        : Math.floor(rawPrice / tick) * tick;
    const normalized = Math.max(tick, normalizedRaw);
    return normalized.toFixed(precision);
  }

  private async getSymbolTradeRule(symbol: string): Promise<SymbolTradeRule> {
    const cached = this.ruleCache.get(symbol);
    if (cached) return cached;

    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v1/exchangeInfo?symbol=${symbol}`,
      undefined,
      `GET /fapi/v1/exchangeInfo symbol=${symbol}`
    );
    if (!res.ok) throw new Error(`Binance exchangeInfo failed: ${res.status}`);

    const payload = (await res.json()) as {
      symbols?: Array<{
        pricePrecision?: number;
        quantityPrecision?: number;
        filters?: Array<{ filterType?: string; stepSize?: string; tickSize?: string; minQty?: string }>;
      }>;
    };
    const item = payload.symbols?.[0];
    const lot = item?.filters?.find((f) => f.filterType === "LOT_SIZE");
    const priceFilter = item?.filters?.find((f) => f.filterType === "PRICE_FILTER");
    if (!item || !lot?.stepSize || !lot.minQty || !priceFilter?.tickSize) {
      throw new Error(`Binance LOT_SIZE/PRICE_FILTER not found for ${symbol}`);
    }

    const stepPrecision = this.decimalsFromStep(lot.stepSize);
    const qtyPrecision = Math.min(stepPrecision, item.quantityPrecision ?? stepPrecision);
    const tickPrecision = this.decimalsFromStep(priceFilter.tickSize);
    const rule: SymbolTradeRule = {
      stepSize: Number(lot.stepSize),
      minQty: Number(lot.minQty),
      qtyPrecision,
      tickSize: Number(priceFilter.tickSize),
      // Use tick precision as floor to avoid over-coarse rounding when exchangeInfo pricePrecision is smaller.
      pricePrecision: Math.max(tickPrecision, item.pricePrecision ?? 0),
    };
    this.ruleCache.set(symbol, rule);
    return rule;
  }

  private decimalsFromStep(stepSize: string): number {
    const raw = stepSize.trim().toLowerCase();
    const expMatch = raw.match(/e-(\d+)$/);
    if (expMatch) {
      const exp = Number(expMatch[1]);
      return Number.isFinite(exp) && exp >= 0 ? exp : 0;
    }
    if (raw.includes(".")) {
      return raw.split(".")[1].replace(/0+$/, "").length;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    let decimals = 0;
    let x = n;
    while (decimals < 12 && Math.abs(Math.round(x) - x) > 1e-10) {
      x *= 10;
      decimals += 1;
    }
    return decimals;
  }

  private async isHedgeMode(): Promise<boolean> {
    if (this.hedgeModeOverride !== null) {
      this.hedgeMode = this.hedgeModeOverride;
      return this.hedgeMode;
    }
    if (this.hedgeMode !== null) return this.hedgeMode;
    const ts = Date.now();
    const query = toQuery({ timestamp: ts, recvWindow: 5000 });
    const signature = sign(this.apiSecret!, query);
    const res = await this.fetchBinance(
      `${this.baseUrl}/fapi/v1/positionSide/dual?${query}&signature=${signature}`,
      { headers: { "X-MBX-APIKEY": this.apiKey! } },
      "GET /fapi/v1/positionSide/dual"
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Binance hedge mode query failed: ${res.status} ${body}; tip=check server clock sync, futures API permission, and IP whitelist`
      );
    }
    const payload = (await res.json()) as { dualSidePosition?: boolean | string };
    this.hedgeMode = payload.dualSidePosition === true || payload.dualSidePosition === "true";
    return this.hedgeMode;
  }

  private inferPositionSide(side: LegSide, reduceOnly: boolean): "LONG" | "SHORT" {
    if (side === "buy") return reduceOnly ? "SHORT" : "LONG";
    return reduceOnly ? "LONG" : "SHORT";
  }

  private assertCredential(): void {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Binance credentials are required in live mode");
    }
  }

  private fetchBinance(url: string, init: RequestInit | undefined, context: string): Promise<Response> {
    return fetchWithContext(url, init, `Binance ${context}`);
  }

  private mapStatus(statusRaw: string | undefined): OrderState["status"] {
    const s = statusRaw?.toUpperCase() ?? "";
    if (s === "FILLED") return "filled";
    if (s === "PARTIALLY_FILLED") return "partial";
    if (s === "CANCELED" || s === "EXPIRED") return "canceled";
    if (s === "REJECTED") return "rejected";
    return "new";
  }
}
