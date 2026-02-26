export interface MeanReversionPoint {
  tsMs: number;
  value: number;
}

export interface MeanReversionConfig {
  lookbackBars: number;
  entryZ: number;
  exitZ: number;
  regimeLookbackBars: number;
  minFlipRate: number;
  maxTrendStrength: number;
  maxHoldBars: number;
}

export interface MeanReversionSeriesPoint {
  tsMs: number;
  value: number;
  rollingMean: number | null;
  rollingStd: number | null;
  zScore: number | null;
  isRanging: boolean;
  trendStrength: number | null;
  flipRate: number | null;
  signal: "long" | "short" | "flat";
  position: -1 | 0 | 1;
}

export interface MeanReversionTrade {
  side: "long" | "short";
  entryTsMs: number;
  exitTsMs: number;
  holdBars: number;
  pnlBps: number;
}

export interface MeanReversionResult {
  points: MeanReversionSeriesPoint[];
  trades: MeanReversionTrade[];
  summary: {
    bars: number;
    samplesUsed: number;
    tradeCount: number;
    winRate: number | null;
    totalPnlBps: number;
    rangePnlBps: number;
    trendPnlBps: number;
    rangeContributionPct: number | null;
    latestSignal: "long" | "short" | "flat";
    latestZ: number | null;
    latestIsRanging: boolean;
  };
}

function boundedInt(input: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  const rounded = Math.floor(input);
  return Math.max(min, Math.min(max, rounded));
}

function boundedNumber(input: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, input));
}

function sanitizeConfig(config: MeanReversionConfig): MeanReversionConfig {
  return {
    lookbackBars: boundedInt(config.lookbackBars, 30, 10, 400),
    entryZ: boundedNumber(config.entryZ, 1.8, 0.2, 6),
    exitZ: boundedNumber(config.exitZ, 0.35, 0.01, 4),
    regimeLookbackBars: boundedInt(config.regimeLookbackBars, 24, 6, 240),
    minFlipRate: boundedNumber(config.minFlipRate, 0.12, 0, 1),
    maxTrendStrength: boundedNumber(config.maxTrendStrength, 0.45, 0, 1),
    maxHoldBars: boundedInt(config.maxHoldBars, 60, 2, 600)
  };
}

function rollingStats(points: MeanReversionPoint[], endIdx: number, lookback: number): { mean: number; std: number } | null {
  if (endIdx + 1 < lookback) {
    return null;
  }
  const start = endIdx - lookback + 1;
  let sum = 0;
  let sumSq = 0;
  for (let i = start; i <= endIdx; i += 1) {
    const value = points[i].value;
    sum += value;
    sumSq += value * value;
  }
  const mean = sum / lookback;
  const variance = Math.max(0, sumSq / lookback - mean * mean);
  const std = Math.sqrt(variance);
  return { mean, std };
}

function regimeStats(points: MeanReversionPoint[], endIdx: number, lookback: number): { trendStrength: number; flipRate: number; isRanging: boolean } | null {
  if (endIdx + 1 < lookback) {
    return null;
  }

  const start = endIdx - lookback + 1;
  let sumAbs = 0;
  let net = 0;
  let flips = 0;
  let prevSign = 0;
  let effectiveSteps = 0;

  for (let i = start + 1; i <= endIdx; i += 1) {
    const ret = points[i].value - points[i - 1].value;
    const absRet = Math.abs(ret);
    sumAbs += absRet;
    net += ret;

    const sign = ret > 0 ? 1 : ret < 0 ? -1 : 0;
    if (sign !== 0) {
      if (prevSign !== 0 && sign !== prevSign) {
        flips += 1;
      }
      prevSign = sign;
      effectiveSteps += 1;
    }
  }

  if (sumAbs <= 0 || effectiveSteps <= 1) {
    return { trendStrength: 0, flipRate: 0, isRanging: false };
  }

  const trendStrength = Math.abs(net) / sumAbs;
  const flipRate = flips / (effectiveSteps - 1);

  return {
    trendStrength,
    flipRate,
    isRanging: false
  };
}

export function evaluateMeanReversion(rawPoints: MeanReversionPoint[], rawConfig: MeanReversionConfig): MeanReversionResult {
  const config = sanitizeConfig(rawConfig);
  const points = rawPoints
    .filter((p) => Number.isFinite(p.tsMs) && Number.isFinite(p.value))
    .map((p) => ({ tsMs: Math.floor(p.tsMs), value: p.value }))
    .sort((a, b) => a.tsMs - b.tsMs);

  const series: MeanReversionSeriesPoint[] = [];
  const trades: MeanReversionTrade[] = [];

  let position: -1 | 0 | 1 = 0;
  let entryValue = 0;
  let entryTsMs = 0;
  let holdBars = 0;
  let totalPnlBps = 0;
  let rangePnlBps = 0;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];

    if (i > 0) {
      const delta = point.value - points[i - 1].value;
      const pnl = position * delta;
      totalPnlBps += pnl;
      if (series[i - 1]?.isRanging) {
        rangePnlBps += pnl;
      }
      if (position !== 0) {
        holdBars += 1;
      }
    }

    const stats = rollingStats(points, i, config.lookbackBars);
    const regime = regimeStats(points, i, config.regimeLookbackBars);
    const trendStrength = regime?.trendStrength ?? null;
    const flipRate = regime?.flipRate ?? null;
    const isRanging =
      !!regime && trendStrength !== null && flipRate !== null && flipRate >= config.minFlipRate && trendStrength <= config.maxTrendStrength;

    const mean = stats?.mean ?? null;
    const std = stats?.std ?? null;
    const zScore = mean !== null && std !== null && std > 1e-9 ? (point.value - mean) / std : null;

    let signal: "long" | "short" | "flat" = "flat";

    if (zScore !== null && isRanging) {
      if (zScore >= config.entryZ) {
        signal = "short";
      } else if (zScore <= -config.entryZ) {
        signal = "long";
      }
    }

    if (position === 0) {
      if (signal === "long") {
        position = 1;
        entryValue = point.value;
        entryTsMs = point.tsMs;
        holdBars = 0;
      } else if (signal === "short") {
        position = -1;
        entryValue = point.value;
        entryTsMs = point.tsMs;
        holdBars = 0;
      }
    } else {
      const shouldExit = !isRanging || zScore === null || Math.abs(zScore) <= config.exitZ || holdBars >= config.maxHoldBars;
      if (shouldExit) {
        const pnlBps = position * (point.value - entryValue);
        trades.push({
          side: position > 0 ? "long" : "short",
          entryTsMs,
          exitTsMs: point.tsMs,
          holdBars,
          pnlBps
        });
        position = 0;
        holdBars = 0;
      }
    }

    series.push({
      tsMs: point.tsMs,
      value: point.value,
      rollingMean: mean,
      rollingStd: std,
      zScore,
      isRanging,
      trendStrength,
      flipRate,
      signal,
      position
    });
  }

  if (position !== 0 && points.length > 0) {
    const last = points[points.length - 1];
    const pnlBps = position * (last.value - entryValue);
    trades.push({
      side: position > 0 ? "long" : "short",
      entryTsMs,
      exitTsMs: last.tsMs,
      holdBars,
      pnlBps
    });
  }

  const latest = series.length > 0 ? series[series.length - 1] : null;
  const wins = trades.filter((trade) => trade.pnlBps > 0).length;
  const trendPnlBps = totalPnlBps - rangePnlBps;

  return {
    points: series,
    trades,
    summary: {
      bars: series.length,
      samplesUsed: points.length,
      tradeCount: trades.length,
      winRate: trades.length > 0 ? wins / trades.length : null,
      totalPnlBps,
      rangePnlBps,
      trendPnlBps,
      rangeContributionPct: Math.abs(totalPnlBps) > 1e-9 ? rangePnlBps / totalPnlBps : null,
      latestSignal: latest?.signal ?? "flat",
      latestZ: latest?.zScore ?? null,
      latestIsRanging: latest?.isRanging ?? false
    }
  };
}
