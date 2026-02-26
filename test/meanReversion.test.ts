import { describe, expect, it } from "vitest";
import { evaluateMeanReversion } from "../src/strategy/meanReversion.js";

function makeOscillation(length: number): Array<{ tsMs: number; value: number }> {
  const points: Array<{ tsMs: number; value: number }> = [];
  const start = 1_700_000_000_000;
  for (let i = 0; i < length; i += 1) {
    const noise = (i % 5) * 0.06;
    const value = Math.sin(i / 2.2) * 2.4 + noise;
    points.push({ tsMs: start + i * 60_000, value });
  }
  return points;
}

describe("evaluateMeanReversion", () => {
  it("produces contrarian signals and trades in oscillating regime", () => {
    const result = evaluateMeanReversion(makeOscillation(140), {
      lookbackBars: 20,
      entryZ: 0.8,
      exitZ: 0.25,
      regimeLookbackBars: 18,
      minFlipRate: 0.1,
      maxTrendStrength: 0.75,
      maxHoldBars: 12
    });

    expect(result.points.length).toBe(140);
    expect(result.summary.tradeCount).toBeGreaterThan(0);
    expect(result.summary.latestSignal).toMatch(/long|short|flat/);

    const anyRanging = result.points.some((p) => p.isRanging);
    const anyActionSignal = result.points.some((p) => p.signal === "long" || p.signal === "short");
    expect(anyRanging).toBe(true);
    expect(anyActionSignal).toBe(true);
  });
});
