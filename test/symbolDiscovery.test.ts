import { describe, expect, test } from "vitest";
import { SymbolDiscoveryService } from "../src/discovery/symbolDiscovery.js";

function makeJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("SymbolDiscoveryService", () => {
  test("discovers Binance/OKX USDT perpetual intersection", async () => {
    const fetchMock = async (input: string | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes("binance")) {
        return makeJsonResponse({
          symbols: [
            { symbol: "BTCUSDT", contractType: "PERPETUAL", quoteAsset: "USDT", status: "TRADING" },
            { symbol: "ETHUSDT", contractType: "PERPETUAL", quoteAsset: "USDT", status: "TRADING" },
            { symbol: "BTCUSD_PERP", contractType: "PERPETUAL", quoteAsset: "USD", status: "TRADING" },
            { symbol: "SOLUSDT", contractType: "CURRENT_QUARTER", quoteAsset: "USDT", status: "TRADING" }
          ]
        });
      }
      return makeJsonResponse({
        data: [
          { instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live" },
          { instId: "ETH-USDT-SWAP", instType: "SWAP", state: "live" },
          { instId: "SOL-USDT-SWAP", instType: "SWAP", state: "suspend" },
          { instId: "DOGE-USDC-SWAP", instType: "SWAP", state: "live" }
        ]
      });
    };

    const svc = new SymbolDiscoveryService(
      {
        enabled: true,
        refreshIntervalMs: 30_000,
        binanceExchangeInfoUrl: "https://fapi.binance.com/fapi/v1/exchangeInfo",
        okxInstrumentsUrl: "https://www.okx.com/api/v5/public/instruments?instType=SWAP"
      },
      ["BNBUSDT"],
      fetchMock
    );

    const symbols = await svc.refresh();
    expect(symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  test("falls back to last good symbols when refresh fails", async () => {
    let ok = true;
    const fetchMock = async (): Promise<Response> => {
      if (!ok) {
        throw new Error("network down");
      }
      return makeJsonResponse({ symbols: [{ symbol: "BTCUSDT", contractType: "PERPETUAL", quoteAsset: "USDT", status: "TRADING" }] });
    };

    const okxFetch = async (): Promise<Response> =>
      makeJsonResponse({ data: [{ instId: "BTC-USDT-SWAP", instType: "SWAP", state: "live" }] });

    const svc = new SymbolDiscoveryService(
      {
        enabled: true,
        refreshIntervalMs: 30_000,
        binanceExchangeInfoUrl: "https://fapi.binance.com/fapi/v1/exchangeInfo",
        okxInstrumentsUrl: "https://www.okx.com/api/v5/public/instruments?instType=SWAP"
      },
      ["ETHUSDT"],
      async (input: string | URL) => {
        const url = String(input);
        return url.includes("binance") ? fetchMock() : okxFetch();
      }
    );

    expect(await svc.refresh()).toEqual(["BTCUSDT"]);
    ok = false;
    expect(await svc.refresh()).toEqual(["BTCUSDT"]);
  });
});
