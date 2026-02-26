import { describe, expect, test } from "vitest";
import { filterRecommendedCandidates } from "../src/control/recommendedCandidates.js";

describe("filterRecommendedCandidates", () => {
  test("keeps only symbols where both exchanges satisfy funding constraints and sorts by netBps desc", () => {
    const items = [
      { symbol: "A", netBps: -12 },
      { symbol: "B", netBps: 7 },
      { symbol: "C", netBps: -20 },
      { symbol: "D", netBps: 15 },
      { symbol: "E", netBps: 2 }
    ];

    const fundingBySymbol = {
      A: {
        binance: { ratePct: 0.009, intervalHours: 8 },
        okx: { ratePct: -0.005, intervalHours: 4 },
        updatedAtMs: 1
      },
      B: {
        binance: { ratePct: 0.011, intervalHours: 8 },
        okx: { ratePct: 0.003, intervalHours: 8 },
        updatedAtMs: 1
      },
      C: {
        binance: { ratePct: 0.001, intervalHours: 2 },
        okx: { ratePct: 0.001, intervalHours: 8 },
        updatedAtMs: 1
      },
      D: {
        binance: { ratePct: -0.0099, intervalHours: 4 },
        okx: { ratePct: 0.0001, intervalHours: 12 },
        updatedAtMs: 1
      },
      E: {
        binance: { ratePct: 0.001, intervalHours: 8 },
        okx: { ratePct: 0.001, intervalHours: 8 },
        updatedAtMs: 1
      }
    };

    const out = filterRecommendedCandidates(items as any, fundingBySymbol as any);
    expect(out.map((it) => it.symbol)).toEqual(["D", "E", "A"]);
  });

  test("returns empty when funding is missing or invalid", () => {
    const out = filterRecommendedCandidates(
      [{ symbol: "A", netBps: 5 }] as any,
      {
        A: {
          binance: { ratePct: null, intervalHours: 8 },
          okx: { ratePct: 0.001, intervalHours: 8 },
          updatedAtMs: 1
        }
      } as any
    );

    expect(out).toEqual([]);
  });
});
