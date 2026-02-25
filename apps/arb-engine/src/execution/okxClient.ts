import crypto from "node:crypto";
import { ExchangeExecutionClient, ExchangePosition, LegSide } from "../types.js";

function toInstId(symbol: string): string {
  const normalized = symbol.toUpperCase();
  if (!normalized.endsWith("USDT")) {
    throw new Error(`Unsupported symbol for OKX swap: ${symbol}`);
  }
  const base = normalized.slice(0, -4);
  return `${base}-USDT-SWAP`;
}

export class OkxClient implements ExchangeExecutionClient {
  private readonly baseUrl = "https://www.okx.com";

  constructor(
    private readonly apiKey?: string,
    private readonly apiSecret?: string,
    private readonly passphrase?: string,
    private readonly ctValOverrides: Record<string, number> = {}
  ) {}

  name() {
    return "okx" as const;
  }

  async normalizeBaseQty(symbol: string, baseQty: number): Promise<number> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const ctVal = await this.getContractValue(symbol, instId);
    const contracts = Math.floor(baseQty / ctVal);
    if (contracts <= 0) {
      return 0;
    }
    return contracts * ctVal;
  }

  async placeMarketIocOrder(
    symbol: string,
    side: LegSide,
    baseQty: number,
    reduceOnly: boolean
  ): Promise<{ orderId: string }> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const ctVal = await this.getContractValue(symbol, instId);
    const contracts = Math.max(1, Math.round(baseQty / ctVal));

    const body = {
      instId,
      tdMode: "cross",
      side,
      ordType: "market",
      sz: String(contracts),
      reduceOnly
    };

    const payload = await this.privateRequest<{ data?: Array<{ ordId?: string; sCode?: string; sMsg?: string }> }>(
      "POST",
      "/api/v5/trade/order",
      body
    );

    const first = payload.data?.[0];
    if (!first || (first.sCode && first.sCode !== "0")) {
      throw new Error(
        `OKX order failed: ${first?.sCode ?? "unknown"} ${first?.sMsg ?? ""}; symbol=${symbol}; baseQty=${baseQty}; ctVal=${ctVal}; sz=${contracts}`
      );
    }
    return { orderId: first.ordId ?? "unknown" };
  }

  async getPosition(symbol: string): Promise<ExchangePosition> {
    this.assertCredential();
    const instId = toInstId(symbol);
    const payload = await this.privateRequest<{ data?: Array<{ pos?: string; notionalUsd?: string }> }>(
      "GET",
      `/api/v5/account/positions?instType=SWAP&instId=${instId}`
    );

    const rows = payload.data ?? [];
    if (rows.length === 0) {
      return { symbol, longNotionalUsdt: 0, shortNotionalUsdt: 0 };
    }

    let longNotionalUsdt = 0;
    let shortNotionalUsdt = 0;
    for (const row of rows) {
      const pos = Number(row.pos ?? "0");
      const notional = Math.abs(Number(row.notionalUsd ?? "0"));
      if (!Number.isFinite(notional) || notional <= 0) {
        continue;
      }
      if (pos > 0) {
        longNotionalUsdt += notional;
      } else if (pos < 0) {
        shortNotionalUsdt += notional;
      }
    }
    return { symbol, longNotionalUsdt, shortNotionalUsdt };
  }

  private async getLastPrice(instId: string): Promise<number> {
    const res = await fetch(`${this.baseUrl}/api/v5/market/ticker?instId=${instId}`);
    if (!res.ok) {
      throw new Error(`OKX ticker failed: ${res.status}`);
    }
    const payload = (await res.json()) as { data?: Array<{ last: string }> };
    const last = Number(payload.data?.[0]?.last ?? "0");
    if (!Number.isFinite(last) || last <= 0) {
      throw new Error(`Invalid OKX last price for ${instId}`);
    }
    return last;
  }

  private async getContractValue(symbol: string, instId: string): Promise<number> {
    const override = this.ctValOverrides[symbol.toUpperCase()];
    if (Number.isFinite(override) && override > 0) {
      return override;
    }
    const res = await fetch(`${this.baseUrl}/api/v5/public/instruments?instType=SWAP&instId=${instId}`);
    if (!res.ok) {
      throw new Error(`OKX instruments failed: ${res.status}`);
    }
    const payload = (await res.json()) as { data?: Array<{ ctVal: string }> };
    const ctVal = Number(payload.data?.[0]?.ctVal ?? "0");
    if (!Number.isFinite(ctVal) || ctVal <= 0) {
      throw new Error(`Invalid ctVal for ${instId}`);
    }
    return ctVal;
  }

  private async privateRequest<T>(method: "GET" | "POST", pathWithQuery: string, body?: unknown): Promise<T> {
    const ts = new Date().toISOString();
    const bodyText = body ? JSON.stringify(body) : "";
    const prehash = `${ts}${method}${pathWithQuery}${bodyText}`;
    const signature = crypto.createHmac("sha256", this.apiSecret!).update(prehash).digest("base64");

    const res = await fetch(`${this.baseUrl}${pathWithQuery}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": this.apiKey!,
        "OK-ACCESS-SIGN": signature,
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": this.passphrase!
      },
      body: bodyText || undefined
    });

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
}
