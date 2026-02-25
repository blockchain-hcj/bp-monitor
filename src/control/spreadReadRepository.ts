import { Pool } from "pg";
import { SpreadEvent } from "../types.js";

export interface SpreadTimelinePoint {
  symbol: string;
  tsIngest: number;
  tsExchange: number;
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
}

interface SpreadRow {
  event_time: Date;
  symbol: string;
  payload: Partial<SpreadEvent> | null;
}

export class PostgresSpreadReadRepository {
  private readonly pool: Pool;

  constructor(postgresUrl: string) {
    this.pool = new Pool({
      connectionString: postgresUrl,
      max: 8
    });
  }

  async listRecentSymbols(limit: number): Promise<string[]> {
    const sql = `
      SELECT symbol
      FROM spread_events
      GROUP BY symbol
      ORDER BY max(event_time) DESC
      LIMIT $1
    `;
    const { rows } = await this.pool.query<{ symbol: string }>(sql, [limit]);
    return rows.map((row) => row.symbol).filter(Boolean);
  }

  async queryTimeline(query: SpreadTimelineQuery): Promise<SpreadTimelinePoint[]> {
    const params: Array<string | number> = [query.symbol, query.fromMs, query.toMs, query.bucketMs, query.limit];
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

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapRow(row: SpreadRow): SpreadTimelinePoint | null {
    const payload = row.payload ?? {};
    const tsIngestRaw = payload.ts_ingest ?? row.event_time.getTime();
    const tsExchangeRaw = payload.ts_exchange ?? tsIngestRaw;
    const bpsAToBRaw = payload.bps_a_to_b;
    const bpsBToARaw = payload.bps_b_to_a;
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
