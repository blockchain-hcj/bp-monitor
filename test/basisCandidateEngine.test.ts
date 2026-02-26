import { describe, expect, test } from "vitest";
import { BasisCandidateEngine } from "../src/strategy/basisCandidateEngine.js";

const cfg = {
  feeBps: 4,
  slippageBps: 2,
  stableWindowMs: 600_000,
  stableBinSizeBps: 2,
  stableMinBandWidthBps: 20,
  stableMinHitRatio: 0.65,
  stableMaxBandStdBps: 8,
  spikeAbsNetBps: 35,
  spikeDelta1mBps: 15
};

describe("BasisCandidateEngine", () => {
  test("extracts dominant band from dense contiguous bins and marks stable", () => {
    const engine = new BasisCandidateEngine(cfg);
    const now = 1_700_000_000_000;
    const points = Array.from({ length: 50 }).map((_, i) => ({
      tsMs: now - (49 - i) * 12_000,
      bpsAToB: 36 + (i % 20),
      bpsBToA: -20
    }));

    const result = engine.evaluateSymbol("BTCUSDT", points, now);

    expect(result.stableBand.bandWidth).toBeGreaterThanOrEqual(20);
    expect(result.stableBand.hitRatio).toBeGreaterThanOrEqual(0.65);
    expect(result.stableBand.bandStd).toBeLessThanOrEqual(8);
    expect(result.tags).toContain("stable");
    expect(result.arbRange.entryLowerBps).toBeGreaterThanOrEqual(result.stableBand.lowerBps);
    expect(result.arbRange.entryUpperBps).toBeLessThanOrEqual(result.stableBand.upperBps);
    expect(result.arbRange.takeProfitBps).toBeLessThan(result.arbRange.entryLowerBps);
    expect(result.profitableNow).toBe(true);
    expect(result.profitBps).toBeGreaterThan(0);
    expect(result.profitExplain).toContain("Snapshot edge");
    expect(result.profitExplain).toContain("not guaranteed");
    expect(typeof result.realizedPnl.inEntryZone).toBe("boolean");
    expect(result.realizedPnl.expectedTakeProfitBps).toBeGreaterThanOrEqual(0);
    expect(result.realizedPnl.riskToStopBps).toBeGreaterThanOrEqual(0);
    expect(result.realizedPnl.rrRatio).toBeGreaterThanOrEqual(0);
  });

  test("marks spike when abs(netBps)>=35 and delta1m>=15", () => {
    const engine = new BasisCandidateEngine(cfg);
    const now = 1_700_000_000_000;
    const points = [
      { tsMs: now - 80_000, bpsAToB: 20, bpsBToA: -10 },
      { tsMs: now - 50_000, bpsAToB: 26, bpsBToA: -10 },
      { tsMs: now - 20_000, bpsAToB: 45, bpsBToA: -10 },
      { tsMs: now - 1_000, bpsAToB: 48, bpsBToA: -10 }
    ];

    const result = engine.evaluateSymbol("ETHUSDT", points, now);

    expect(result.netBps).toBeGreaterThanOrEqual(35);
    expect(result.spike.isSpike).toBe(true);
    expect(result.spike.delta1mBps).toBeGreaterThanOrEqual(15);
    expect(result.tags).toContain("spike");
    expect(result.arbRange.stopLossBps).toBeGreaterThan(result.arbRange.entryUpperBps);
    expect(result.profitableNow).toBe(true);
    expect(result.profitBps).toBeGreaterThan(0);
  });

  test("marks non-profitable when latest net is negative", () => {
    const engine = new BasisCandidateEngine(cfg);
    const now = 1_700_000_000_000;
    const points = [
      { tsMs: now - 80_000, bpsAToB: -8, bpsBToA: -10 },
      { tsMs: now - 40_000, bpsAToB: -9, bpsBToA: -11 },
      { tsMs: now - 1_000, bpsAToB: -10, bpsBToA: -12 }
    ];
    const result = engine.evaluateSymbol("APRUSDT", points, now);

    expect(result.netBps).toBeLessThan(0);
    expect(result.bestDirection).toBe("none");
    expect(result.profitableNow).toBe(false);
    expect(result.profitBps).toBe(0);
    expect(result.profitExplain).toContain("No immediate edge");
    expect(result.realizedPnl.inEntryZone).toBe(false);
    expect(result.realizedPnl.expectedTakeProfitBps).toBe(0);
  });
});
