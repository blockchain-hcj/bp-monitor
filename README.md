# Spread Monitor (Binance + OKX + Optional DeepBook)

Low-latency monitoring service for cross-CEX long/short arbitrage references.

## Features
- Binance Futures + OKX Swap top-of-book monitoring
- Optional DeepBook top-of-book polling (via `@mysten/deepbook-v3`)
- Automatic Binance/OKX USDT perpetual intersection discovery
- CORE/WATCH symbol pool split with hot subscription updates
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
1. Configure env files:
   - `cp .env.example .env`
   - `cp apps/arb-engine/.env.example apps/arb-engine/.env`
2. Build and start all services (NATS + Postgres + alert-hub + monitor + arb-engine):
   - `docker compose up -d --build`
3. Check status:
   - `docker compose ps`
4. Check health:
   - `curl http://127.0.0.1:18280/healthz`
   - `curl http://127.0.0.1:18081/healthz`
   - `curl http://127.0.0.1:18180/healthz`

## Docker Notes
- In Docker Compose, service DNS names are used automatically:
  - `NATS_URL` is forced to `nats://nats:4222`
  - `POSTGRES_URL` is forced to `postgres://postgres:postgres@postgres:5432/monitors`
- Host ports:
  - `18280` => alert-hub HTTP + WS
  - `18081` => monitor control plane
  - `18180` => arb-engine control plane
  - `4222/8222` => NATS
  - `5432` => PostgreSQL

## Alert System
- Shared SDK:
  - `sdks/alert-sdk` (TypeScript `AlertClient`)
- Hub:
  - `apps/alert-hub` (`POST /alerts`, `GET /alerts`, `PUT /alerts/:id/ack`, `WS /ws`)
- Menu bar app:
  - `apps/alert-bar` (Electron + menubar)

### Manual Smoke Test
1. Start hub:
   - `cd apps/alert-hub && cp .env.example .env && npm install && npm run dev`
2. POST a test alert:
   - `curl -X POST http://127.0.0.1:18280/alerts -H 'content-type: application/json' -d '{\"severity\":\"critical\",\"title\":\"test alert\",\"source\":\"manual\"}'`
3. Query alerts:
   - `curl 'http://127.0.0.1:18280/alerts?limit=10'`
4. Start menu bar app (macOS):
   - `cd apps/alert-bar && cp .env.example .env && npm install && npm run dev`

### Env Files
- `apps/alert-hub/.env.example`
  - `ALERT_HUB_HOST`, `ALERT_HUB_PORT`, `ALERT_HUB_RING_SIZE`, `ALERT_HUB_WS_PATH`, `ALERT_HUB_CORS_ORIGIN`
  - `ALERT_HUB_NATS_ENABLED`, `ALERT_HUB_NATS_SUBJECT`, `NATS_URL`
- `apps/alert-bar/.env.example`
  - `ALERT_HUB_URL`, `ALERT_HUB_WS_URL`, `ALERT_BAR_POPUP_ON_HIGH`

## Control Plane
- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /timeline`
  - Frontend dashboard for BPS spread timeline visualization.
- `GET /mean-reversion`
  - Frontend dashboard for intraday mean-reversion decision support (range-regime filtered).
- `GET /api/symbols`
  - Returns available symbols from config + recent DB data.
- `GET /api/spreads?symbol=BTCUSDT&windowMin=60&limit=360`
  - Returns spread timeline points and summary stats.
- `GET /api/mean-reversion?symbol=BTCUSDT&direction=a_to_b&windowMin=240&lookbackBars=30&entryZ=1.8&exitZ=0.35`
  - Returns strategy points/trades/summary from current spread history data.
- `PUT /config/symbols`
  - body: `{ "symbols": ["BTCUSDT", "ETHUSDT"] }`
  - updates discovery universe and rebalances CORE subscriptions.
- `PUT /config/thresholds`
  - body: `{ "minBpsAbs": 2.5 }`

## Database
Table `spread_events` is auto-created on startup. SQL is also available in:
- `db/schema.sql`

## Notes
- Runtime target: Node.js 22+
- Control plane server uses `uWebSockets.js`
- JetStream stream is auto-created if absent

## Discovery and Universe
- `SYMBOL_DISCOVERY_ENABLED=true` enables periodic Binance+OKX intersection refresh.
- `SYMBOL_DISCOVERY_REFRESH_MS` controls refresh cadence.
- `CORE_MAX_SYMBOLS` caps high-frequency subscription symbols (others remain in WATCH pool).
