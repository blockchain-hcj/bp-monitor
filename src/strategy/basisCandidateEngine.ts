import { BasisCandidateConfig } from "../types.js";

export interface BasisSpreadSample {
  tsMs: number;
  bpsAToB: number;
  bpsBToA: number;
}

export type BasisDirection = "binance_to_okx" | "okx_to_binance" | "none";

export interface BasisCandidateResult {
  symbol: string;
  bestDirection: BasisDirection;
  netBps: number;
  stableBand: {
    lowerBps: number;
    upperBps: number;
    bandWidth: number;
    hitRatio: number;
    bandStd: number;
  };
  spike: {
    isSpike: boolean;
    delta1mBps: number;
    peakBps: number;
  };
  arbRange: {
    entryLowerBps: number;
    entryUpperBps: number;
    takeProfitBps: number;
    stopLossBps: number;
  };
  entryToTakeProfitBps: number;
  realizedPnl: {
    inEntryZone: boolean;
    expectedTakeProfitBps: number;
    riskToStopBps: number;
    rrRatio: number;
    explain: string;
  };
  profitableNow: boolean;
  profitBps: number;
  profitExplain: string;
  score: number;
  tags: string[];
  updatedAtMs: number;
}

export class BasisCandidateEngine {
  constructor(private readonly config: BasisCandidateConfig) {}

  evaluateSymbol(symbol: string, points: BasisSpreadSample[], nowMs: number): BasisCandidateResult {
    if (points.length === 0) {
      return {
        symbol,
        bestDirection: "none",
        netBps: 0,
        stableBand: {
          lowerBps: 0,
          upperBps: 0,
          bandWidth: 0,
          hitRatio: 0,
          bandStd: 0
        },
        spike: {
          isSpike: false,
          delta1mBps: 0,
          peakBps: 0
        },
        arbRange: {
          entryLowerBps: 0,
          entryUpperBps: 0,
          takeProfitBps: 0,
          stopLossBps: 0
        },
        entryToTakeProfitBps: 0,
        realizedPnl: {
          inEntryZone: false,
          expectedTakeProfitBps: 0,
          riskToStopBps: 0,
          rrRatio: 0,
          explain: "No immediate edge: insufficient data"
        },
        profitableNow: false,
        profitBps: 0,
        profitExplain: "No immediate edge: insufficient data",
        score: 0,
        tags: ["insufficient_data"],
        updatedAtMs: nowMs
      };
    }

    const netSeries = points.map((point) => ({
      tsMs: point.tsMs,
      netAToB: point.bpsAToB - this.config.feeBps - this.config.slippageBps,
      netBToA: point.bpsBToA - this.config.feeBps - this.config.slippageBps
    }));

    const latest = netSeries[netSeries.length - 1];
    const bestDirection = this.pickDirection(latest.netAToB, latest.netBToA);
    const latestNet =
      bestDirection === "binance_to_okx"
        ? latest.netAToB
        : bestDirection === "okx_to_binance"
          ? latest.netBToA
          : Math.max(latest.netAToB, latest.netBToA);

    const selectedNetSeries = netSeries.map((item) => {
      if (bestDirection === "okx_to_binance") {
        return item.netBToA;
      }
      if (bestDirection === "binance_to_okx") {
        return item.netAToB;
      }
      return Math.max(item.netAToB, item.netBToA);
    });

    const dominant = this.extractDominantBand(selectedNetSeries);
    const inBandValues = selectedNetSeries.filter((value) => value >= dominant.lowerBps && value < dominant.upperBps);
    const bandStd = this.computeStd(inBandValues);
    const hitRatio = selectedNetSeries.length > 0 ? inBandValues.length / selectedNetSeries.length : 0;

    const isStable =
      dominant.bandWidth >= this.config.stableMinBandWidthBps &&
      hitRatio >= this.config.stableMinHitRatio &&
      bandStd <= this.config.stableMaxBandStdBps;

    const oneMinuteAnchor = this.findOneMinuteAnchor(netSeries, nowMs);
    const delta1mBps = oneMinuteAnchor === null ? 0 : Math.abs(latestNet - oneMinuteAnchor);
    const peakBps = selectedNetSeries.reduce((acc, value) => Math.max(acc, Math.abs(value)), 0);
    const isSpike = Math.abs(latestNet) >= this.config.spikeAbsNetBps && delta1mBps >= this.config.spikeDelta1mBps;

    const score = this.score({
      isStable,
      isSpike,
      latestNet,
      hitRatio,
      bandWidth: dominant.bandWidth,
      delta1mBps
    });

    const tags: string[] = [];
    if (isStable) tags.push("stable");
    if (isSpike) tags.push("spike");
    if (!isStable && !isSpike) tags.push("watch");
    const arbRange = this.computeArbRange(dominant.lowerBps, dominant.upperBps);
    const profitableNow = bestDirection !== "none" && latestNet > 0;
    const profitBps = profitableNow ? Number(latestNet.toFixed(3)) : 0;
    const profitExplain = profitableNow
      ? `Snapshot edge +${latestNet.toFixed(2)} bps after fee/slippage; not guaranteed realized PnL (needs executable exit)`
      : `No immediate edge: net ${latestNet.toFixed(2)} bps after fee/slippage`;
    const realizedPnl = this.computeRealizedPnl(latestNet, arbRange, profitableNow);
    const entryToTakeProfitBps = Number((arbRange.entryUpperBps - arbRange.takeProfitBps).toFixed(3));

    return {
      symbol,
      bestDirection,
      netBps: Number(latestNet.toFixed(3)),
      stableBand: {
        lowerBps: dominant.lowerBps,
        upperBps: dominant.upperBps,
        bandWidth: dominant.bandWidth,
        hitRatio: Number(hitRatio.toFixed(4)),
        bandStd: Number(bandStd.toFixed(4))
      },
      spike: {
        isSpike,
        delta1mBps: Number(delta1mBps.toFixed(3)),
        peakBps: Number(peakBps.toFixed(3))
      },
      arbRange,
      entryToTakeProfitBps,
      realizedPnl,
      profitableNow,
      profitBps,
      profitExplain,
      score,
      tags,
      updatedAtMs: points[points.length - 1]?.tsMs ?? nowMs
    };
  }

  private extractDominantBand(values: number[]): { lowerBps: number; upperBps: number; bandWidth: number } {
    if (values.length === 0) {
      return { lowerBps: 0, upperBps: 0, bandWidth: 0 };
    }
    const bin = this.config.stableBinSizeBps;
    const buckets = new Map<number, number>();
    for (const value of values) {
      const key = Math.floor(value / bin);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const [peakKey] = [...buckets.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return Math.abs(a[0]) - Math.abs(b[0]);
    })[0];

    let left = peakKey;
    let right = peakKey;
    while (buckets.has(left - 1)) {
      left -= 1;
    }
    while (buckets.has(right + 1)) {
      right += 1;
    }

    const lowerBps = left * bin;
    const upperBps = (right + 1) * bin;
    return {
      lowerBps,
      upperBps,
      bandWidth: Number((upperBps - lowerBps).toFixed(4))
    };
  }

  private findOneMinuteAnchor(series: Array<{ tsMs: number; netAToB: number; netBToA: number }>, nowMs: number): number | null {
    const targetTs = nowMs - 60_000;
    let candidate: number | null = null;
    for (const item of series) {
      if (item.tsMs <= targetTs) {
        candidate = Math.abs(item.netAToB) >= Math.abs(item.netBToA) ? item.netAToB : item.netBToA;
      }
    }
    return candidate;
  }

  private computeStd(values: number[]): number {
    if (values.length <= 1) {
      return 0;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private score(input: {
    isStable: boolean;
    isSpike: boolean;
    latestNet: number;
    hitRatio: number;
    bandWidth: number;
    delta1mBps: number;
  }): number {
    let total = 0;
    if (input.isStable) {
      total += 35;
      total += Math.min(25, input.hitRatio * 25);
      total += Math.min(10, input.bandWidth / 3);
    }
    if (input.isSpike) {
      total += 35;
      total += Math.min(15, input.delta1mBps);
    }
    total += Math.min(15, Math.abs(input.latestNet) / 3);
    return Math.max(0, Math.min(100, Math.round(total)));
  }

  private pickDirection(netAToB: number, netBToA: number): BasisDirection {
    const hasPositiveAToB = netAToB > 0;
    const hasPositiveBToA = netBToA > 0;
    if (hasPositiveAToB && hasPositiveBToA) {
      return netAToB >= netBToA ? "binance_to_okx" : "okx_to_binance";
    }
    if (hasPositiveAToB) {
      return "binance_to_okx";
    }
    if (hasPositiveBToA) {
      return "okx_to_binance";
    }
    return "none";
  }

  private computeArbRange(lowerBps: number, upperBps: number): BasisCandidateResult["arbRange"] {
    const width = Math.max(0, upperBps - lowerBps);
    if (width === 0) {
      return {
        entryLowerBps: lowerBps,
        entryUpperBps: upperBps,
        takeProfitBps: lowerBps,
        stopLossBps: upperBps
      };
    }

    const entryLower = lowerBps + width * 0.7;
    const entryUpper = upperBps;
    const takeProfit = lowerBps + width * 0.35;
    const stopLoss = upperBps + Math.max(8, width * 0.25);
    return {
      entryLowerBps: Number(entryLower.toFixed(3)),
      entryUpperBps: Number(entryUpper.toFixed(3)),
      takeProfitBps: Number(takeProfit.toFixed(3)),
      stopLossBps: Number(stopLoss.toFixed(3))
    };
  }

  private computeRealizedPnl(
    latestNet: number,
    arbRange: BasisCandidateResult["arbRange"],
    profitableNow: boolean
  ): BasisCandidateResult["realizedPnl"] {
    const inEntryZone = latestNet >= arbRange.entryLowerBps && latestNet <= arbRange.entryUpperBps;
    if (!profitableNow || !inEntryZone) {
      return {
        inEntryZone,
        expectedTakeProfitBps: 0,
        riskToStopBps: 0,
        rrRatio: 0,
        explain: !profitableNow ? "No immediate edge, skip entry." : "Edge exists but outside entry zone."
      };
    }

    const expectedTakeProfitBps = Math.max(0, latestNet - arbRange.takeProfitBps);
    const riskToStopBps = Math.max(0, arbRange.stopLossBps - latestNet);
    const rrRatio = riskToStopBps > 0 ? expectedTakeProfitBps / riskToStopBps : 0;
    return {
      inEntryZone: true,
      expectedTakeProfitBps: Number(expectedTakeProfitBps.toFixed(3)),
      riskToStopBps: Number(riskToStopBps.toFixed(3)),
      rrRatio: Number(rrRatio.toFixed(3)),
      explain: `If mean reverts to TP, est +${expectedTakeProfitBps.toFixed(2)} bps; stop risk ${riskToStopBps.toFixed(2)} bps.`
    };
  }
}
