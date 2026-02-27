import crypto from "node:crypto";
import { parseArgs } from "node:util";

type ProbeOptions = {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  recvWindow: number;
  real: boolean;
  hedgeMode: "auto" | "hedge" | "oneway";
  baseUrl: string;
};

function toQuery(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function parseJsonMaybe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeHedgeMode(raw: string | undefined): ProbeOptions["hedgeMode"] {
  const v = (raw ?? "auto").trim().toLowerCase();
  if (v === "hedge" || v === "oneway" || v === "auto") return v;
  return "auto";
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ res: Response; ms: number; bodyText: string }> {
  const t0 = Date.now();
  const res = await fetch(url, init);
  const bodyText = await res.text();
  return { res, ms: Date.now() - t0, bodyText };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", short: "s" },
      side: { type: "string" },
      qty: { type: "string", short: "q" },
      price: { type: "string", short: "p" },
      recvWindow: { type: "string" },
      real: { type: "boolean", default: false },
      hedgeMode: { type: "string" },
      baseUrl: { type: "string" },
    },
    strict: false,
  });

  const apiKey = process.env.BN_API_KEY?.trim();
  const apiSecret = process.env.BN_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new Error("BN_API_KEY / BN_API_SECRET is required");
  }

  const options: ProbeOptions = {
    symbol: String(values.symbol ?? "BTCUSDT").toUpperCase(),
    side: String(values.side ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
    quantity: String(values.qty ?? "0.001"),
    price: String(values.price ?? "100"),
    recvWindow: Math.max(1000, Number(values.recvWindow ?? "5000")),
    real: Boolean(values.real),
    hedgeMode: normalizeHedgeMode((values.hedgeMode as string | undefined) ?? process.env.BN_HEDGE_MODE),
    baseUrl: String(values.baseUrl ?? "https://fapi.binance.com"),
  };

  console.log("[probe] ===== Binance order probe =====");
  console.log(`[probe] baseUrl=${options.baseUrl}`);
  console.log(`[probe] symbol=${options.symbol} side=${options.side} qty=${options.quantity} price=${options.price}`);
  console.log(`[probe] mode=${options.real ? "REAL ORDER" : "TEST ORDER"} hedgeMode=${options.hedgeMode} recvWindow=${options.recvWindow}`);

  // 1) Server time and local clock skew
  {
    const nowBefore = Date.now();
    const { res, ms, bodyText } = await timedFetch(`${options.baseUrl}/fapi/v1/time`);
    const nowAfter = Date.now();
    const json = parseJsonMaybe(bodyText) as { serverTime?: number };
    const serverTime = Number(json?.serverTime ?? NaN);
    const localMid = Math.round((nowBefore + nowAfter) / 2);
    const skew = Number.isFinite(serverTime) ? localMid - serverTime : NaN;
    console.log(`[step1] GET /fapi/v1/time status=${res.status} latency=${ms}ms`);
    console.log(`[step1] body=${bodyText}`);
    if (Number.isFinite(skew)) {
      console.log(`[step1] local-server skew=${skew}ms (abs>1000ms may trigger -1021)`);
    }
    if (!res.ok) {
      throw new Error(`[step1] failed`);
    }
  }

  // 2) Signed endpoint: query hedge mode (unless forced)
  let hedgeModeResolved: boolean | null = null;
  if (options.hedgeMode === "hedge") hedgeModeResolved = true;
  if (options.hedgeMode === "oneway") hedgeModeResolved = false;
  if (hedgeModeResolved === null) {
    const ts = Date.now();
    const query = toQuery({ timestamp: ts, recvWindow: options.recvWindow });
    const signature = sign(apiSecret, query);
    const url = `${options.baseUrl}/fapi/v1/positionSide/dual?${query}&signature=${signature}`;
    const { res, ms, bodyText } = await timedFetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": apiKey },
    });
    console.log(`[step2] GET /fapi/v1/positionSide/dual status=${res.status} latency=${ms}ms`);
    console.log(`[step2] body=${bodyText}`);
    if (!res.ok) {
      const parsed = parseJsonMaybe(bodyText) as { code?: number; msg?: string };
      throw new Error(
        `[step2] hedge mode query failed; code=${String(parsed?.code ?? "unknown")} msg=${String(parsed?.msg ?? bodyText)}`
      );
    }
    const payload = parseJsonMaybe(bodyText) as { dualSidePosition?: boolean | string };
    hedgeModeResolved = payload.dualSidePosition === true || payload.dualSidePosition === "true";
  } else {
    console.log(`[step2] skipped query; forced hedgeMode=${hedgeModeResolved ? "hedge" : "oneway"}`);
  }

  // 3) Place order (test or real)
  {
    const ts = Date.now();
    const params: Record<string, string | number | boolean> = {
      symbol: options.symbol,
      side: options.side,
      type: "LIMIT",
      quantity: options.quantity,
      price: options.price,
      timeInForce: "GTC",
      timestamp: ts,
      recvWindow: options.recvWindow,
    };
    if (hedgeModeResolved) {
      params.positionSide = options.side === "BUY" ? "LONG" : "SHORT";
    } else {
      params.reduceOnly = false;
    }
    const query = toQuery(params);
    const signature = sign(apiSecret, query);
    const path = options.real ? "/fapi/v1/order" : "/fapi/v1/order/test";
    const url = `${options.baseUrl}${path}?${query}&signature=${signature}`;
    const { res, ms, bodyText } = await timedFetch(url, {
      method: "POST",
      headers: { "X-MBX-APIKEY": apiKey },
    });
    console.log(`[step3] POST ${path} status=${res.status} latency=${ms}ms`);
    console.log(`[step3] body=${bodyText || "<empty>"}`);
    if (!res.ok) {
      const parsed = parseJsonMaybe(bodyText) as { code?: number; msg?: string };
      throw new Error(`[step3] order failed; code=${String(parsed?.code ?? "unknown")} msg=${String(parsed?.msg ?? bodyText)}`);
    }
  }

  console.log("[probe] OK");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[probe] FAILED: ${msg}`);
  process.exit(1);
});
