# Arb Engine (OKX + Binance)

Pure backend arbitrage service that subscribes to `spread.*` events from monitor NATS output,
calculates net spread with fees/slippage, and drives open/close intents with a per-symbol,
per-direction hysteresis threshold model.

## Features

- NATS subscriber for `spread.>`
- Event normalization (`bn` alias mapped to `binance`)
- Directional strategy:
  - `binance_to_okx`
  - `okx_to_binance`
- Net spread gating:
  - `net_bps = raw_bps - fee_bps - slippage_bps`
- Position state machine with open/close thresholds
- `paper` and `live` trading mode via `TRADE_MODE`
- Periodic exchange position reconciliation in `live` mode
- Risk mode:
  - `normal`
  - `close_only`
- Control APIs:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /state`
  - `PUT /config/symbols`
  - `PUT /config/thresholds`
  - `PUT /risk/mode`

## Quick Start

1. Ensure monitor service is publishing to NATS (`spread.*`).
2. Configure env:

```bash
cp .env.example .env
```

3. Run:

```bash
npm run dev
```

## Example Threshold Update

```bash
curl -X PUT http://127.0.0.1:18180/config/thresholds \
  -H 'content-type: application/json' \
  -d '{
    "thresholds": {
      "BTCUSDT": {
        "binance_to_okx": {"open_bps": 12, "close_bps": 5},
        "okx_to_binance": {"open_bps": 13, "close_bps": 6}
      },
      "ETHUSDT": {
        "binance_to_okx": {"open_bps": 14, "close_bps": 6},
        "okx_to_binance": {"open_bps": 14, "close_bps": 6}
      }
    }
  }'
```

## Notes

- Live execution uses market orders and should be tested with small notional first.
- Live mode converts `ARB_NOTIONAL_USDT` to a shared base quantity first, then sends both legs using that same base quantity.
- If OKX contract size is different from expected, use `OKX_CTVAL_OVERRIDES` (e.g. `OPNUSDT:1`).
