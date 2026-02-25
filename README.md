# Spread Monitor (Binance + OKX + Optional DeepBook)

Low-latency monitoring service for cross-CEX long/short arbitrage references.

## Features
- Binance Futures + OKX Swap top-of-book monitoring
- Optional DeepBook top-of-book polling (via `@mysten/deepbook-v3`)
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

Where `A/B` are any enabled exchange pair for the same symbol.

## DeepBook (Optional)
- Install dependencies when network is available:
  - `npm install @mysten/deepbook-v3 @mysten/sui`
- Enable in `.env`:
  - `DEEPBOOK_ENABLED=true`
  - `DEEPBOOK_NETWORK=mainnet` (or `testnet`)
  - `DEEPBOOK_POOL_MAP=SUIUSDT:SUI_USDC` (format: `SYMBOL:POOL_KEY`, comma separated)

## Quick Start
1. Start dependencies:
   - `docker compose up -d`
2. Install dependencies:
   - `npm install`
3. Configure env:
   - `cp .env.example .env`
4. Start:
   - `   `
   - (This runs `build + dist` startup to keep worker_threads stable.)

## Control Plane
- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /timeline`
  - Frontend dashboard for BPS spread timeline visualization.
- `GET /api/symbols`
  - Returns available symbols from config + recent DB data.
- `GET /api/spreads?symbol=BTCUSDT&windowMin=60&limit=360`
  - Returns spread timeline points and summary stats.
- `PUT /config/symbols`
  - body: `{ "symbols": ["BTCUSDT", "ETHUSDT"] }`
- `PUT /config/thresholds`
  - body: `{ "minBpsAbs": 2.5 }`

## Database
Table `spread_events` is auto-created on startup. SQL is also available in:
- `db/schema.sql`

## Notes
- Runtime target: Node.js 22+
- Control plane server uses `uWebSockets.js`
- JetStream stream is auto-created if absent
