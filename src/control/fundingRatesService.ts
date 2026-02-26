import { toOkxInstId } from "../ingestor/symbolMapper.js";

export interface ExchangeFundingInfo {
  ratePct: number | null;
  intervalHours: number | null;
}

export interface FundingPairInfo {
  binance: ExchangeFundingInfo;
  okx: ExchangeFundingInfo;
  updatedAtMs: number;
}

interface BinanceFundingRateRow {
  symbol?: string;
  fundingRate?: string;
  fundingTime?: string;
}

interface BinanceFundingInfoRow {
  symbol?: string;
  fundingIntervalHours?: string;
}

interface BinancePremiumIndexRow {
  symbol?: string;
  lastFundingRate?: string;
}

interface OkxFundingResponse {
  data?: Array<{
    fundingRate?: string;
    fundingTime?: string;
    nextFundingTime?: string;
  }>;
}

interface CacheEntry {
  expiresAtMs: number;
  value: FundingPairInfo;
}

export class FundingRatesService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<FundingPairInfo>>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ttlMs: number = 30_000
  ) {}

  async getBySymbols(symbols: string[]): Promise<Record<string, FundingPairInfo>> {
    const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const out: Record<string, FundingPairInfo> = {};
    await Promise.all(
      normalized.map(async (symbol) => {
        out[symbol] = await this.getBySymbol(symbol);
      })
    );
    return out;
  }

  private async getBySymbol(symbol: string): Promise<FundingPairInfo> {
    const now = Date.now();
    const cached = this.cache.get(symbol);
    if (cached && cached.expiresAtMs > now) {
      return cached.value;
    }

    const inflight = this.pending.get(symbol);
    if (inflight) {
      return inflight;
    }

    const task = this.fetchPair(symbol)
      .then((value) => {
        this.cache.set(symbol, { value, expiresAtMs: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => {
        this.pending.delete(symbol);
      });

    this.pending.set(symbol, task);
    return task;
  }

  private async fetchPair(symbol: string): Promise<FundingPairInfo> {
    const [binance, okx] = await Promise.all([this.fetchBinance(symbol), this.fetchOkx(symbol)]);
    return {
      binance,
      okx,
      updatedAtMs: Date.now()
    };
  }

  private async fetchBinance(symbol: string): Promise<ExchangeFundingInfo> {
    try {
      const [premium, rateRows, infoRows] = await Promise.all([
        this.fetchJson<BinancePremiumIndexRow>(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`),
        this.fetchJson<BinanceFundingRateRow[]>(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=2`),
        this.fetchJson<BinanceFundingInfoRow[]>(`https://fapi.binance.com/fapi/v1/fundingInfo?symbol=${encodeURIComponent(symbol)}`)
      ]);
      const target = symbol.toUpperCase();
      const rateRowsMatched = Array.isArray(rateRows)
        ? rateRows.filter((row) => {
            const rowSymbol = String(row.symbol ?? symbol).trim().toUpperCase();
            return rowSymbol === target;
          })
        : [];

      const sorted = [...rateRowsMatched].sort((a, b) => Number(a.fundingTime ?? 0) - Number(b.fundingTime ?? 0));
      const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
      const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
      const latestTime = Number(latest?.fundingTime ?? NaN);
      const prevTime = Number(prev?.fundingTime ?? NaN);
      const intervalFromHistory =
        Number.isFinite(latestTime) && Number.isFinite(prevTime) && latestTime > prevTime
          ? (latestTime - prevTime) / 3_600_000
          : null;
      const infoMatched = Array.isArray(infoRows)
        ? infoRows.find((row) => String(row.symbol ?? "").trim().toUpperCase() === target)
        : null;
      const infoInterval = Number(infoMatched?.fundingIntervalHours ?? NaN);
      const intervalHours = Number.isFinite(infoInterval) && infoInterval > 0 ? infoInterval : intervalFromHistory;
      const premiumRate = Number(premium?.lastFundingRate ?? NaN);
      const historyRate = Number(latest?.fundingRate ?? NaN);
      const rate = Number.isFinite(premiumRate) ? premiumRate : historyRate;
      return {
        ratePct: Number.isFinite(rate) ? rate * 100 : null,
        intervalHours: Number.isFinite(intervalHours) ? intervalHours : null
      };
    } catch {
      return { ratePct: null, intervalHours: null };
    }
  }

  private async fetchOkx(symbol: string): Promise<ExchangeFundingInfo> {
    try {
      const instId = toOkxInstId(symbol);
      const payload = await this.fetchJson<OkxFundingResponse>(
        `https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`
      );
      const latest = Array.isArray(payload.data) && payload.data.length > 0 ? payload.data[0] : null;
      const rate = Number(latest?.fundingRate ?? NaN);
      const fundingTime = Number(latest?.fundingTime ?? NaN);
      const nextFundingTime = Number(latest?.nextFundingTime ?? NaN);
      const interval =
        Number.isFinite(fundingTime) && Number.isFinite(nextFundingTime) && nextFundingTime > fundingTime
          ? (nextFundingTime - fundingTime) / 3_600_000
          : null;
      return {
        ratePct: Number.isFinite(rate) ? rate * 100 : null,
        intervalHours: Number.isFinite(interval) ? interval : null
      };
    } catch {
      return { ratePct: null, intervalHours: null };
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
