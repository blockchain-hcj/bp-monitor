import { Pool } from "pg";
import { RuntimeConfig, SpreadEvent, SpreadRepository } from "../types.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export class PostgresSpreadRepository implements SpreadRepository {
  private readonly pool: Pool;
  private readonly timeoutMs: number;
  private readonly cleanupTimeoutMs: number;

  constructor(config: RuntimeConfig) {
    this.pool = new Pool({ connectionString: config.postgresUrl, max: 20 });
    this.timeoutMs = config.dbInsertTimeoutMs;
    this.cleanupTimeoutMs = Math.max(30_000, this.timeoutMs * 100);
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize schema bootstrap across workers to avoid concurrent DDL races.
      await client.query("SELECT pg_advisory_xact_lock($1)", [7_411_002]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS spread_events (
          event_time TIMESTAMPTZ NOT NULL,
          symbol TEXT NOT NULL,
          event_id TEXT NOT NULL,
          payload JSONB NOT NULL,
          PRIMARY KEY (event_time, symbol, event_id)
        );
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS spread_events_symbol_time_idx ON spread_events (symbol, event_time DESC);"
      );
      await client.query("CREATE INDEX IF NOT EXISTS spread_events_time_idx ON spread_events (event_time DESC);");
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_spread_payload_exchange_a ON spread_events ((payload->>'exchange_a'));"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_spread_payload_exchange_b ON spread_events ((payload->>'exchange_b'));"
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async insert(event: SpreadEvent): Promise<void> {
    const sql = `
      INSERT INTO spread_events (event_time, symbol, event_id, payload)
      VALUES (to_timestamp($1 / 1000.0), $2, $3, $4::jsonb)
      ON CONFLICT DO NOTHING
    `;
    const values = [event.ts_ingest, event.symbol, event.event_id, JSON.stringify(event)];
    await withTimeout(this.pool.query(sql, values), this.timeoutMs, "db insert");
  }

  async purgeOlderThan(cutoffMs: number, batchSize = 20_000, maxBatches = 80): Promise<number> {
    const safeBatchSize = Math.max(500, Math.min(batchSize, 100_000));
    const safeMaxBatches = Math.max(1, Math.min(maxBatches, 1_000));
    let totalDeleted = 0;

    for (let i = 0; i < safeMaxBatches; i += 1) {
      const result = await withTimeout(
        this.purgeOneBatch(cutoffMs, safeBatchSize),
        this.cleanupTimeoutMs,
        "db retention cleanup"
      );
      if (!result.locked) {
        break;
      }
      totalDeleted += result.deleted;
      if (result.deleted < safeBatchSize) {
        break;
      }
    }

    return totalDeleted;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async purgeOneBatch(cutoffMs: number, batchSize: number): Promise<{ locked: boolean; deleted: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Ensure only one worker executes retention cleanup at a time.
      const lockResult = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS locked", [
        7_411_003
      ]);
      if (!lockResult.rows[0]?.locked) {
        await client.query("ROLLBACK");
        return { locked: false, deleted: 0 };
      }

      const deletedResult = await client.query(
        `
          WITH victims AS (
            SELECT ctid
            FROM spread_events
            WHERE event_time < to_timestamp($1 / 1000.0)
            ORDER BY event_time ASC
            LIMIT $2
          )
          DELETE FROM spread_events AS se
          USING victims
          WHERE se.ctid = victims.ctid
        `,
        [cutoffMs, batchSize]
      );

      await client.query("COMMIT");
      return { locked: true, deleted: deletedResult.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
