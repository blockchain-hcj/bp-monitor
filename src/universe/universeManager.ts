import { UniverseConfig } from "../types.js";

export class UniverseManager {
  private readonly coreMaxSymbols: number;
  private readonly discovered = new Set<string>();
  private readonly scoreBySymbol = new Map<string, number>();
  private core: string[] = [];
  private watch: string[] = [];

  constructor(config: Pick<UniverseConfig, "coreMaxSymbols">) {
    this.coreMaxSymbols = Math.max(1, config.coreMaxSymbols);
  }

  updateDiscoveredSymbols(symbols: string[]): void {
    this.discovered.clear();
    for (const symbol of symbols) {
      const normalized = symbol.trim().toUpperCase();
      if (normalized) {
        this.discovered.add(normalized);
      }
    }

    for (const key of this.scoreBySymbol.keys()) {
      if (!this.discovered.has(key)) {
        this.scoreBySymbol.delete(key);
      }
    }

    this.rebalance();
  }

  updateScores(nextScores: Record<string, number>): void {
    for (const [symbol, score] of Object.entries(nextScores)) {
      const normalized = symbol.trim().toUpperCase();
      if (!this.discovered.has(normalized)) {
        continue;
      }
      this.scoreBySymbol.set(normalized, Number.isFinite(score) ? score : 0);
    }
    this.rebalance();
  }

  getCoreSymbols(): string[] {
    return [...this.core];
  }

  getWatchSymbols(): string[] {
    return [...this.watch];
  }

  getAllSymbols(): string[] {
    return [...this.core, ...this.watch];
  }

  private rebalance(): void {
    const ranked = [...this.discovered]
      .map((symbol) => ({ symbol, score: this.scoreBySymbol.get(symbol) ?? 0 }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.symbol.localeCompare(b.symbol);
      });

    this.core = ranked.slice(0, this.coreMaxSymbols).map((item) => item.symbol);
    this.watch = ranked.slice(this.coreMaxSymbols).map((item) => item.symbol);
  }
}
