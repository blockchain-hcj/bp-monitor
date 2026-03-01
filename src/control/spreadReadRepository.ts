import { Pool } from "pg";
import { SpreadEvent } from "../types.js";

export interface SpreadTimelinePoint {
  symbol: string;
  tsIngest: number;
  tsExchange: number;
  exchangeA: string;
  exchangeB: string;
  bpsAToB: number;
  bpsBToA: number;
  bestBidA: number | null;
  bestAskA: number | null;
  bestBidB: number | null;
  bestAskB: number | null;
}

export interface SpreadTimelineQuery {
  symbol: string;
  fromMs: number;
  toMs: number;
  bucketMs: number;
  limit: number;
  exchangeA?: string;
  exchangeB?: string;
}

export interface BasisSpreadPoint {
  tsMs: number;
  bpsAToB: number;
  bpsBToA: number;
}

interface SpreadRow {
  event_time: Date;
  symbol: string;
  payload: Partial<SpreadEvent> | null;
}

export interface ExchangePair {
  exchangeA: string;
  exchangeB: string;
}

export class PostgresSpreadReadRepository {
  private readonly pool: Pool;

  constructor(postgresUrl: string) {
    this.pool = new Pool({
      connectionString: postgresUrl,
      max: 32
    });
  }

  async listRecentSymbols(limit: number): Promise<string[]> {
    const sql = `
      SELECT symbol
      FROM spread_events
      WHERE event_time >= now() - interval '1 day'
      GROUP BY symbol
      ORDER BY max(event_time) DESC
      LIMIT $1
    `;
    const { rows } = await this.pool.query<{ symbol: string }>(sql, [limit]);
    return rows.map((row) => row.symbol).filter(Boolean);
  }

  async queryTimeline(query: SpreadTimelineQuery): Promise<SpreadTimelinePoint[]> {
    const params: Array<string | number> = [
      query.symbol,
      query.fromMs,
      query.toMs,
      query.bucketMs,
      query.limit,
      query.exchangeA ?? "",
      query.exchangeB ?? ""
    ];
    const sql = `
      WITH filtered AS (
        SELECT
          event_time,
          symbol,
          payload,
          floor(extract(epoch FROM event_time) * 1000.0 / $4)::bigint AS bucket_id
        FROM spread_events
        WHERE symbol = $1
          AND event_time >= to_timestamp($2 / 1000.0)
          AND event_time <= to_timestamp($3 / 1000.0)
          AND ($6 = '' OR payload->>'exchange_a' = $6)
          AND ($7 = '' OR payload->>'exchange_b' = $7)
      ),
      ranked AS (
        SELECT
          event_time,
          symbol,
          payload,
          row_number() OVER (PARTITION BY bucket_id ORDER BY event_time DESC) AS rn
        FROM filtered
      )
      SELECT event_time, symbol, payload
      FROM ranked
      WHERE rn = 1
      ORDER BY event_time ASC
      LIMIT $5
    `;

    const { rows } = await this.pool.query<SpreadRow>(sql, params);
    return rows
      .map((row) => this.mapRow(row))
      .filter((row): row is SpreadTimelinePoint => row !== null);
  }

  async listRecentExchangePairs(symbol: string, days: number, limit: number): Promise<ExchangePair[]> {
    const safeDays = Math.max(1, Math.min(days, 365));
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const sql = `
      SELECT
        payload->>'exchange_a' AS exchange_a,
        payload->>'exchange_b' AS exchange_b,
        max(event_time) AS last_time
      FROM spread_events
      WHERE symbol = $1
        AND event_time >= now() - ($2::text || ' days')::interval
      GROUP BY payload->>'exchange_a', payload->>'exchange_b'
      ORDER BY last_time DESC
      LIMIT $3
    `;
    const { rows } = await this.pool.query<{ exchange_a: string | null; exchange_b: string | null }>(sql, [
      symbol,
      safeDays,
      safeLimit
    ]);
    return rows
      .map((row) => ({
        exchangeA: (row.exchange_a ?? "").trim(),
        exchangeB: (row.exchange_b ?? "").trim()
      }))
      .filter((pair) => Boolean(pair.exchangeA) && Boolean(pair.exchangeB));
  }

  async queryRecentForSymbol(symbol: string, fromMs: number, toMs: number, limit: number): Promise<BasisSpreadPoint[]> {
    const sql = `
      SELECT event_time, payload
      FROM spread_events
      WHERE symbol = $1
        AND event_time >= to_timestamp($2 / 1000.0)
        AND event_time <= to_timestamp($3 / 1000.0)
      ORDER BY event_time ASC
      LIMIT $4
    `;
    const safeLimit = Math.max(1, Math.min(limit, 5_000));
    const { rows } = await this.pool.query<{ event_time: Date; payload: Partial<SpreadEvent> | null }>(sql, [
      symbol,
      fromMs,
      toMs,
      safeLimit
    ]);
    return rows
      .map((row) => {
        const payload = row.payload ?? {};
        const tsMs = Number(payload.ts_ingest ?? row.event_time.getTime());
        const bpsAToB = Number(payload.bps_a_to_b);
        const bpsBToA = Number(payload.bps_b_to_a);
        if (!Number.isFinite(tsMs) || !Number.isFinite(bpsAToB) || !Number.isFinite(bpsBToA)) {
          return null;
        }
        return { tsMs, bpsAToB, bpsBToA };
      })
      .filter((point): point is BasisSpreadPoint => point !== null);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapRow(row: SpreadRow): SpreadTimelinePoint | null {
    const payload = row.payload ?? {};
    const tsIngestRaw = payload.ts_ingest ?? row.event_time.getTime();
    const tsExchangeRaw = payload.ts_exchange ?? tsIngestRaw;
    const bpsAToBRaw = payload.bps_a_to_b;
    const bpsBToARaw = payload.bps_b_to_a;
    const exchangeARaw = payload.exchange_a;
    const exchangeBRaw = payload.exchange_b;
    const bestBidARaw = payload.best_bid_a;
    const bestAskARaw = payload.best_ask_a;
    const bestBidBRaw = payload.best_bid_b;
    const bestAskBRaw = payload.best_ask_b;
    const tsIngest = Number(tsIngestRaw);
    const tsExchange = Number(tsExchangeRaw);
    const bpsAToB = Number(bpsAToBRaw);
    const bpsBToA = Number(bpsBToARaw);
    if (!Number.isFinite(tsIngest) || !Number.isFinite(tsExchange)) {
      return null;
    }
    if (!Number.isFinite(bpsAToB) || !Number.isFinite(bpsBToA)) {
      return null;
    }
    return {
      symbol: row.symbol,
      tsIngest,
      tsExchange,
      exchangeA: typeof exchangeARaw === "string" && exchangeARaw ? exchangeARaw : "binance",
      exchangeB: typeof exchangeBRaw === "string" && exchangeBRaw ? exchangeBRaw : "okx",
      bpsAToB,
      bpsBToA,
      bestBidA: this.toFiniteOrNull(bestBidARaw),
      bestAskA: this.toFiniteOrNull(bestAskARaw),
      bestBidB: this.toFiniteOrNull(bestBidBRaw),
      bestAskB: this.toFiniteOrNull(bestAskBRaw)
    };
  }

  private toFiniteOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
