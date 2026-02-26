import { FundingPairInfo } from "./fundingRatesService.js";
import { BasisCandidateItem } from "./basisCandidatesService.js";

const MAX_FUNDING_RATE_PCT_ABS = 0.01;
const MIN_FUNDING_INTERVAL_HOURS = 4;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function exchangeFundingQualifies(info: { ratePct: number | null; intervalHours: number | null }): boolean {
  if (!isFiniteNumber(info.ratePct) || !isFiniteNumber(info.intervalHours)) {
    return false;
  }
  return Math.abs(info.ratePct) < MAX_FUNDING_RATE_PCT_ABS && info.intervalHours >= MIN_FUNDING_INTERVAL_HOURS;
}

export function isRecommendedFundingPair(pair: FundingPairInfo | undefined): boolean {
  if (!pair) {
    return false;
  }
  return exchangeFundingQualifies(pair.binance) && exchangeFundingQualifies(pair.okx);
}

export function filterRecommendedCandidates(
  items: BasisCandidateItem[],
  fundingBySymbol: Record<string, FundingPairInfo>
): BasisCandidateItem[] {
  return [...items]
    .filter((item) => isRecommendedFundingPair(fundingBySymbol[item.symbol]))
    .sort((a, b) => b.netBps - a.netBps);
}
