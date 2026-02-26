import { fromOkxInstId } from "../ingestor/symbolMapper.js";
import { SymbolDiscoveryConfig } from "../types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface BinanceExchangeInfo {
  symbols?: Array<{
    symbol?: string;
    contractType?: string;
    quoteAsset?: string;
    status?: string;
  }>;
}

interface OkxInstrumentsResponse {
  data?: Array<{
    instId?: string;
    instType?: string;
    state?: string;
  }>;
}

export class SymbolDiscoveryService {
  private readonly config: SymbolDiscoveryConfig;
  private readonly fetchFn: FetchLike;
  private lastGoodSymbols: string[];

  constructor(config: SymbolDiscoveryConfig, fallbackSymbols: string[], fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
    this.lastGoodSymbols = [...new Set(fallbackSymbols.map((s) => s.toUpperCase()))].sort();
  }

  getCurrentSymbols(): string[] {
    return [...this.lastGoodSymbols];
  }

  async refresh(): Promise<string[]> {
    if (!this.config.enabled) {
      return this.getCurrentSymbols();
    }

    try {
      const [binance, okx] = await Promise.all([this.fetchBinanceSymbols(), this.fetchOkxSymbols()]);
      const intersection = [...binance].filter((symbol) => okx.has(symbol)).sort();
      if (intersection.length > 0) {
        this.lastGoodSymbols = intersection;
      }
    } catch {
      // Keep previous symbol set on discovery failures to avoid wiping running subscriptions.
    }

    return this.getCurrentSymbols();
  }

  private async fetchBinanceSymbols(): Promise<Set<string>> {
    const response = await this.fetchFn(this.config.binanceExchangeInfoUrl);
    if (!response.ok) {
      throw new Error(`binance discovery failed: ${response.status}`);
    }

    const payload = (await response.json()) as BinanceExchangeInfo;
    const symbols = new Set<string>();
    for (const item of payload.symbols ?? []) {
      if (item.contractType !== "PERPETUAL") {
        continue;
      }
      if (item.quoteAsset !== "USDT") {
        continue;
      }
      if (item.status !== "TRADING") {
        continue;
      }
      const symbol = item.symbol?.toUpperCase();
      if (symbol) {
        symbols.add(symbol);
      }
    }
    return symbols;
  }

  private async fetchOkxSymbols(): Promise<Set<string>> {
    const response = await this.fetchFn(this.config.okxInstrumentsUrl);
    if (!response.ok) {
      throw new Error(`okx discovery failed: ${response.status}`);
    }

    const payload = (await response.json()) as OkxInstrumentsResponse;
    const symbols = new Set<string>();
    for (const item of payload.data ?? []) {
      if (item.instType !== "SWAP") {
        continue;
      }
      if (item.state !== "live") {
        continue;
      }
      const instId = item.instId ?? "";
      if (!instId.endsWith("-USDT-SWAP")) {
        continue;
      }
      symbols.add(fromOkxInstId(instId));
    }
    return symbols;
  }
}
