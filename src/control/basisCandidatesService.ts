import { PostgresSpreadReadRepository } from "./spreadReadRepository.js";
import { BasisCandidateEngine, BasisCandidateResult } from "../strategy/basisCandidateEngine.js";

export type CandidatePool = "core" | "watch";
export type CandidateMode = "stable" | "spike" | "all";
export type CandidateSort = "score" | "netBps" | "updatedAt" | "entryToTp";
export type CandidateProfitable = "all" | "true" | "false";

export interface BasisCandidatesQuery {
  mode: CandidateMode;
  minScore: number;
  onlyCore: boolean;
  profitable: CandidateProfitable;
  limit: number;
  sort: CandidateSort;
}

export interface BasisCandidateItem extends BasisCandidateResult {
  pool: CandidatePool;
}

export class BasisCandidatesService {
  constructor(
    private readonly readRepo: PostgresSpreadReadRepository,
    private readonly engine: BasisCandidateEngine,
    private readonly stableWindowMs: number
  ) {}

  async listCandidates(query: BasisCandidatesQuery, pools: { core: string[]; watch: string[] }): Promise<BasisCandidateItem[]> {
    const nowMs = Date.now();
    const sourceSymbols = query.onlyCore ? pools.core : [...new Set([...pools.core, ...pools.watch])];

    const evaluated = await Promise.all(
      sourceSymbols.map(async (symbol) => {
        const timeline = await this.readRepo.queryRecentForSymbol(symbol, nowMs - this.stableWindowMs, nowMs, 1200);
        const result = this.engine.evaluateSymbol(symbol, timeline, nowMs);
        const pool: CandidatePool = pools.core.includes(symbol) ? "core" : "watch";
        return { ...result, pool };
      })
    );

    return filterAndSortCandidates(evaluated, query);
  }
}

export function filterAndSortCandidates(items: BasisCandidateItem[], query: BasisCandidatesQuery): BasisCandidateItem[] {
  let filtered = items.filter((item) => item.score >= query.minScore);
  if (query.onlyCore) {
    filtered = filtered.filter((item) => item.pool === "core");
  }
  if (query.mode === "stable") {
    filtered = filtered.filter((item) => item.tags.includes("stable"));
  } else if (query.mode === "spike") {
    filtered = filtered.filter((item) => item.spike.isSpike);
  }
  if (query.profitable === "true") {
    filtered = filtered.filter((item) => item.profitableNow);
  } else if (query.profitable === "false") {
    filtered = filtered.filter((item) => !item.profitableNow);
  }

  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "netBps") {
      return Math.abs(b.netBps) - Math.abs(a.netBps);
    }
    if (query.sort === "updatedAt") {
      return b.updatedAtMs - a.updatedAtMs;
    }
    if (query.sort === "entryToTp") {
      return b.entryToTakeProfitBps - a.entryToTakeProfitBps;
    }
    return b.score - a.score;
  });

  return sorted.slice(0, Math.max(1, Math.min(500, query.limit)));
}
