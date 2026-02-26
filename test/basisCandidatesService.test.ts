import { describe, expect, test } from "vitest";
import { filterAndSortCandidates } from "../src/control/basisCandidatesService.js";

describe("filterAndSortCandidates", () => {
  test("applies mode/minScore/onlyCore/sort/limit", () => {
    const items = [
      {
        symbol: "A",
        pool: "core",
        score: 80,
        netBps: 30,
        entryToTakeProfitBps: 8,
        profitableNow: true,
        updatedAtMs: 1000,
        tags: ["stable"],
        spike: { isSpike: false }
      },
      {
        symbol: "B",
        pool: "watch",
        score: 95,
        netBps: 50,
        entryToTakeProfitBps: 20,
        profitableNow: true,
        updatedAtMs: 2000,
        tags: ["spike"],
        spike: { isSpike: true }
      },
      {
        symbol: "C",
        pool: "core",
        score: 65,
        netBps: 40,
        entryToTakeProfitBps: 12,
        profitableNow: false,
        updatedAtMs: 1500,
        tags: ["stable", "spike"],
        spike: { isSpike: true }
      }
    ];

    const out = filterAndSortCandidates(items as any, {
      mode: "spike",
      minScore: 60,
      onlyCore: true,
      profitable: "false",
      sort: "netBps",
      limit: 1
    });

    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe("C");
  });

  test("sorts by entryToTp descending", () => {
    const items = [
      { symbol: "A", pool: "core", score: 80, netBps: 30, entryToTakeProfitBps: 8, profitableNow: true, updatedAtMs: 1000, tags: ["stable"], spike: { isSpike: false } },
      { symbol: "B", pool: "watch", score: 90, netBps: 20, entryToTakeProfitBps: 25, profitableNow: true, updatedAtMs: 1000, tags: ["stable"], spike: { isSpike: false } },
      { symbol: "C", pool: "core", score: 70, netBps: 10, entryToTakeProfitBps: 12, profitableNow: true, updatedAtMs: 1000, tags: ["stable"], spike: { isSpike: false } }
    ];

    const out = filterAndSortCandidates(items as any, {
      mode: "all",
      minScore: 0,
      onlyCore: false,
      profitable: "all",
      sort: "entryToTp",
      limit: 3
    });

    expect(out.map((it) => it.symbol)).toEqual(["B", "C", "A"]);
  });
});
