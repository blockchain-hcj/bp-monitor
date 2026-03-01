import crypto from "node:crypto";
import { ExchangeClient, ExchangePosition, LegSide, OpenOrderState, OrderState } from "../types.js";
import { fetchWithContext } from "./errorFormat.js";

function toInstId(symbol: string): string {
  const normalized = symbol.toUpperCase();
  if (!normalized.endsWith("USDT")) {
    throw new Error(`Unsupported symbol for OKX swap: ${symbol}`);
  }
  const base = normalized.slice(0, -4);
  return `${base}-USDT-SWAP`;
}

interface InstrumentRule {
  ctVal: number;
  tickSz: number;
}

export class OkxClient implements ExchangeClient {
  private readonly baseUrl = "https://www.okx.com";
  private readonly instrumentCache = new Map<string, InstrumentRule>();

  constructor(
    private readonly apiKey?: string,
    private readonly apiSecret?: string,
    private readonly passphrase?: string
  ) {}

  name() {
    return "okx" as const;
  }

  async normalizeBaseQty(symbol: string, baseQty: number): Promise<number> {
    const instId = toInstId(symbol);
    const rule = await this.getInstrumentRule(symbol, instId);
    const contracts = Math.floor(baseQty / rule.ctVal);
    if (contracts <= 0) return 0;
    return contracts * rule.ctVal;
  }

  async placeLimitOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    price: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const rule = await this.getInstrumentRule(symbol, instId);
    const contracts = Math.max(1, Math.round(baseQty / rule.ctVal));
    const normalizedPrice = this.quantizePriceInternal(price, rule.tickSz, side);

    const body = {
      instId,
      tdMode: "cross",
      side,
      ordType: "limit",
      px: String(normalizedPrice),
      sz: String(contracts),
      reduceOnly,
    };

    const payload = await this.privateRequest<{ data?: Array<{ ordId?: string; sCode?: string; sMsg?: string }> }>(
      "POST",
      "/api/v5/trade/order",
      body
    );

    const first = payload.data?.[0];
    if (!first || (first.sCode && first.sCode !== "0")) {
      throw new Error(`OKX limit order failed: ${first?.sCode ?? "unknown"} ${first?.sMsg ?? ""}; symbol=${symbol}; px=${normalizedPrice}; sz=${contracts}`);
    }
    return { orderId: first.ordId ?? "unknown" };
  }

  async placeMarketOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const rule = await this.getInstrumentRule(symbol, instId);
    const contracts = Math.max(1, Math.round(baseQty / rule.ctVal));

    const body = {
      instId,
      tdMode: "cross",
      side,
      ordType: "market",
      sz: String(contracts),
      reduceOnly,
    };

    const payload = await this.privateRequest<{ data?: Array<{ ordId?: string; sCode?: string; sMsg?: string }> }>(
      "POST",
      "/api/v5/trade/order",
      body
    );

    const first = payload.data?.[0];
    if (!first || (first.sCode && first.sCode !== "0")) {
      throw new Error(`OKX market order failed: ${first?.sCode ?? "unknown"} ${first?.sMsg ?? ""}; symbol=${symbol}; sz=${contracts}`);
    }
    return { orderId: first.ordId ?? "unknown" };
  }

  async getOrderStatus(symbol: string, orderId: string): Promise<OrderState> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const payload = await this.privateRequest<{
      data?: Array<{ state?: string; fillSz?: string; avgPx?: string; fillPx?: string }>;
    }>("GET", `/api/v5/trade/order?instId=${instId}&ordId=${encodeURIComponent(orderId)}`);

    const first = payload.data?.[0];
    if (!first) {
      return { orderId, status: "rejected", filledQty: 0, avgPrice: 0 };
    }
    return {
      orderId,
      status: this.mapStatus(first.state),
      filledQty: Number(first.fillSz ?? "0"),
      avgPrice: Number(first.avgPx ?? first.fillPx ?? "0"),
    };
  }

  async getOpenOrders(symbol: string): Promise<OpenOrderState[]> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const payload = await this.privateRequest<{
      data?: Array<{
        ordId?: string;
        side?: string;
        px?: string;
        fillSz?: string;
        avgPx?: string;
        state?: string;
        uTime?: string;
      }>;
    }>("GET", `/api/v5/trade/orders-pending?instType=SWAP&instId=${instId}`);

    const rows = payload.data ?? [];
    return rows
      .map((row): OpenOrderState => ({
        orderId: String(row.ordId ?? "unknown"),
        side: row.side === "sell" ? "sell" : "buy",
        price: Number(row.px ?? "0"),
        status: this.mapStatus(row.state),
        filledQty: Number(row.fillSz ?? "0"),
        avgPrice: Number(row.avgPx ?? "0"),
        updateTimeMs: Number(row.uTime ?? Date.now()),
      }))
      .filter((row) => row.status === "new" || row.status === "partial");
  }

  async cancelOrder(symbol: string, orderId: string): Promise<{ ok: boolean }> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const payload = await this.privateRequest<{ data?: Array<{ sCode?: string }> }>("POST", "/api/v5/trade/cancel-order", {
      instId,
      ordId: orderId,
    });
    const code = payload.data?.[0]?.sCode;
    return { ok: !code || code === "0" };
  }

  async getTickSize(symbol: string): Promise<number> {
    const instId = toInstId(symbol);
    const rule = await this.getInstrumentRule(symbol, instId);
    return rule.tickSz;
  }

  async quantizePrice(price: number, symbol: string, side: LegSide): Promise<number> {
    const instId = toInstId(symbol);
    const rule = await this.getInstrumentRule(symbol, instId);
    return this.quantizePriceInternal(price, rule.tickSz, side);
  }

  async getPosition(symbol: string): Promise<ExchangePosition> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const payload = await this.privateRequest<{
      data?: Array<{ pos?: string; notionalUsd?: string; avgPx?: string }>;
    }>(
      "GET",
      `/api/v5/account/positions?instType=SWAP&instId=${instId}`
    );

    const rows = payload.data ?? [];
    if (rows.length === 0) {
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
    for (const row of rows) {
      const pos = Number(row.pos ?? "0");
      const notional = Math.abs(Number(row.notionalUsd ?? "0"));
      const avgPx = Number(row.avgPx ?? "0");
      if (!Number.isFinite(notional) || notional <= 0) continue;
      if (pos > 0) {
        longQty += pos;
        longNotionalUsdt += notional;
        if (Number.isFinite(avgPx) && avgPx > 0) {
          longEntryQty += pos;
          longEntryCost += pos * avgPx;
        }
      } else if (pos < 0) {
        const absPos = Math.abs(pos);
        shortQty += absPos;
        shortNotionalUsdt += notional;
        if (Number.isFinite(avgPx) && avgPx > 0) {
          shortEntryQty += absPos;
          shortEntryCost += absPos * avgPx;
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

  private quantizePriceInternal(rawPrice: number, tickSz: number, side: LegSide): number {
    const tick = Math.max(tickSz, 1e-12);
    const scale = Math.round(1 / tick);
    if (!Number.isFinite(scale) || scale <= 0) {
      return Math.max(0, rawPrice);
    }
    const normalized =
      side === "buy"
        ? Math.ceil(rawPrice * scale) / scale
        : Math.floor(rawPrice * scale) / scale;
    return Math.max(tick, normalized);
  }

  private async getInstrumentRule(symbol: string, instId: string): Promise<InstrumentRule> {
    const cached = this.instrumentCache.get(instId);
    if (cached) return cached;

    const res = await this.fetchOkx(
      `${this.baseUrl}/api/v5/public/instruments?instType=SWAP&instId=${instId}`,
      undefined,
      `GET /api/v5/public/instruments instId=${instId}`
    );
    if (!res.ok) throw new Error(`OKX instruments failed: ${res.status}`);

    const payload = (await res.json()) as { data?: Array<{ ctVal: string; tickSz?: string }> };
    const ctVal = Number(payload.data?.[0]?.ctVal ?? "0");
    const tickSz = Number(payload.data?.[0]?.tickSz ?? "0");
    const normalizedCtVal = Number.isFinite(ctVal) && ctVal > 0 ? ctVal : 0;
    const normalizedTick = Number.isFinite(tickSz) && tickSz > 0 ? tickSz : 0.1;
    if (!Number.isFinite(normalizedCtVal) || normalizedCtVal <= 0) {
      throw new Error(`Invalid ctVal for ${instId}`);
    }
    const rule = { ctVal: normalizedCtVal, tickSz: normalizedTick };
    this.instrumentCache.set(instId, rule);
    return rule;
  }

  private async privateRequest<T>(method: "GET" | "POST", pathWithQuery: string, body?: unknown): Promise<T> {
    const ts = new Date().toISOString();
    const bodyText = body ? JSON.stringify(body) : "";
    const prehash = `${ts}${method}${pathWithQuery}${bodyText}`;
    const signature = crypto.createHmac("sha256", this.apiSecret!).update(prehash).digest("base64");

    const res = await this.fetchOkx(
      `${this.baseUrl}${pathWithQuery}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "OK-ACCESS-KEY": this.apiKey!,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": ts,
          "OK-ACCESS-PASSPHRASE": this.passphrase!,
        },
        body: bodyText || undefined,
      },
      `${method} ${pathWithQuery}`
    );

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`OKX private request failed: ${res.status} ${msg}`);
    }
    return (await res.json()) as T;
  }

  private assertCredential(): void {
    if (!this.apiKey || !this.apiSecret || !this.passphrase) {
      throw new Error("OKX credentials are required in live mode");
    }
  }

  private fetchOkx(url: string, init: RequestInit | undefined, context: string): Promise<Response> {
    return fetchWithContext(url, init, `OKX ${context}`);
  }

  private mapStatus(stateRaw: string | undefined): OrderState["status"] {
    const s = (stateRaw ?? "").toLowerCase();
    if (s === "filled") return "filled";
    if (s === "partially_filled") return "partial";
    if (s === "canceled" || s === "mmp_canceled") return "canceled";
    if (s === "rejected") return "rejected";
    return "new";
  }
}
