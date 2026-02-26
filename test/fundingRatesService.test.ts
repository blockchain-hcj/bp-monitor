import { describe, expect, test } from "vitest";
import { FundingRatesService } from "../src/control/fundingRatesService.js";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  } as Response;
}

describe("FundingRatesService", () => {
  test("matches binance funding interval by symbol and prefers premium index rate", async () => {
    const fetchMock: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/fapi/v1/fundingRate")) {
        return jsonResponse([
          { symbol: "BARDUSDT", fundingRate: "0.00010000", fundingTime: "1700000000000" },
          { symbol: "BARDUSDT", fundingRate: "0.00020000", fundingTime: "1700014400000" }
        ]);
      }
      if (url.includes("/fapi/v1/fundingInfo")) {
        return jsonResponse([
          { symbol: "BTCUSDT", fundingIntervalHours: "8" },
          { symbol: "BARDUSDT", fundingIntervalHours: "4" }
        ]);
      }
      if (url.includes("/fapi/v1/premiumIndex")) {
        return jsonResponse({ symbol: "BARDUSDT", lastFundingRate: "0.00030000" });
      }
      if (url.includes("/api/v5/public/funding-rate")) {
        return jsonResponse({
          data: [
            {
              fundingRate: "0.00015000",
              fundingTime: "1700000000000",
              nextFundingTime: "1700014400000"
            }
          ]
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const svc = new FundingRatesService(fetchMock, 0);
    const out = await svc.getBySymbols(["bardusdt"]);

    expect(out.BARDUSDT.binance.intervalHours).toBe(4);
    expect(out.BARDUSDT.binance.ratePct).toBeCloseTo(0.03, 8);
    expect(out.BARDUSDT.okx.intervalHours).toBe(4);
    expect(out.BARDUSDT.okx.ratePct).toBeCloseTo(0.015, 8);
  });
});
