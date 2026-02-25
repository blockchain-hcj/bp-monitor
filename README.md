# CEX Spread Monitor (Binance + OKX)

Low-latency monitoring service for cross-CEX long/short arbitrage references.

## Features
- Binance Futures + OKX Swap top-of-book monitoring
- Dual-direction bid-ask spread calculation in bps
- WS-first ingestion with REST snapshot recovery on sequence gap
- Per-update event output to NATS JetStream
- Synchronous PostgreSQL persistence for replay/audit
- Worker-thread symbol sharding
- Control plane APIs: `/healthz`, `/readyz`, `/metrics`, config hot updates

## Event Formula
- `bps_a_to_b = ((bid_B - ask_A) / mid_ref) * 10000`
- `bps_b_to_a = ((bid_A - ask_B) / mid_ref) * 10000`
- `mid_ref = (mid_A + mid_B) / 2`

Where `A=binance`, `B=okx` in current implementation.

## Quick Start
1. Start dependencies:
   - `docker compose up -d`
2. Install dependencies:
   - `npm install`
3. Configure env:
   - `cp .env.example .env`
4. Start:
   - `npm run dev`
   - (This runs `build + dist` startup to keep worker_threads stable.)

## Control Plane
- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /timeline`
  - Frontend dashboard for BPS spread timeline visualization (with latest prices and hover details).
- `GET /api/symbols`
  - Returns available symbols from config + recent DB data.
- `GET /api/spreads?symbol=BTCUSDT&windowMin=60&limit=360`
  - Returns spread timeline points and summary stats.
  - `limit` means target point count (time-bucketed), not raw tick count.
- `PUT /config/symbols`
  - body: `{ "symbols": ["BTCUSDT", "ETHUSDT"] }`
- `PUT /config/thresholds`
  - body: `{ "minBpsAbs": 2.5 }`

## Database
Table `spread_events` is auto-created on startup. SQL is also available in:
- `db/schema.sql`

### Retention & Sampling
- `DB_RETENTION_DAYS` (default `7`): keep only recent days in PostgreSQL.
- `DB_RETENTION_CLEANUP_INTERVAL_MS` (default `3600000`): retention cleanup interval.
- `DB_SAMPLE_INTERVAL_MS` (default `1000`): DB insert downsampling interval per symbol in milliseconds.
  - Example: `1000` means at most 1 row/second/symbol in DB.
  - This only down-samples DB persistence. Real-time publishing remains unchanged.

## Notes
- Runtime target: Node.js 22+
- Control plane server uses `uWebSockets.js`
- JetStream stream is auto-created if absent
