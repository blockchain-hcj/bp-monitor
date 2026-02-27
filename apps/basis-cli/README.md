# basis-cli

Interactive terminal UI for executing basis trades (Binance Futures ↔ OKX Perp Swap).

## Prerequisites

- Node.js >= 22
- NATS server running locally (default `nats://127.0.0.1:4222`)
- The spread publisher service feeding `spread.binance_okx.<SYMBOL>` subjects

## Quick Start

```bash
# Install dependencies
npm install

# Paper mode (default, no API keys needed)
npx tsx src/index.ts

# With custom defaults
npx tsx src/index.ts --mode paper --quantity 0.1 --slippage 3

# Live mode (requires API keys in .env)
cp .env.example .env  # fill in your keys
npx tsx src/index.ts --mode live
```

## Build & Run

```bash
npm run build
npm start
```

## Usage

The CLI has two screens:

### Screen 1: Symbol Select

Use arrow keys (or j/k) to pick a symbol, Enter to confirm.

```
  BASIS CLI  │  Select Symbol  │  PAPER  │  12:34:56
────────────────────────────────────────────────────
    BTCUSDT
  > ETHUSDT
    SOLUSDT
    BNBUSDT
    ...
────────────────────────────────────────────────────
  [↑/↓] Navigate  [Enter] Select  [Q] Quit
```

### Screen 2: Dashboard

Real-time prices, positions, and trade execution.

```
  BASIS CLI  │  ETHUSDT  │  bn→okx  │  qty: 0.05  │  slip: 2 bps  │  PAPER
────────────────────────────────────────────────────────────────────────────
  BINANCE  Bid: 1843.20  Ask: 1843.40   │  POS  Long: $0.00  Short: $92.16
  OKX      Bid: 1843.15  Ask: 1843.35   │  POS  Long: $92.10  Short: $0.00
────────────────────────────────────────────────────────────────────────────
  BASIS: 1.36 bps (bn→okx)  │  NET: -2.64 bps (after 4 bps fees)
────────────────────────────────────────────────────────────────────────────
  ORDERS / LOG ...
────────────────────────────────────────────────────────────────────────────
  [Enter] Execute  [D] Direction  [+/-] Qty  [S] Slippage  [R] Amend  [C] Cancel  [B] Back  [Q] Quit
```

### Key Bindings (Dashboard)

| Key | Action |
|---|---|
| `Enter` | Execute trade at current params |
| `D` | Toggle direction (bn→okx / okx→bn) |
| `+` / `-` | Increase / decrease quantity |
| `S` | Edit slippage (type number, Enter to confirm, Esc to cancel) |
| `R` | Amend open orders (cancel + re-place at new prices) |
| `C` | Cancel all open orders |
| `B` / `Esc` | Back to symbol select (only when IDLE) |
| `Q` | Quit |

## CLI Arguments

| Flag | Short | Default | Description |
|---|---|---|---|
| `--symbol` | `-s` | `ETHUSDT` | Initial symbol (overridden by interactive selection) |
| `--direction` | `-d` | `binance_to_okx` | Initial direction |
| `--quantity` | `-q` | `0.05` | Initial trade quantity |
| `--slippage` | | `2` | Initial slippage in bps |
| `--timeout` | `-t` | `30` | Order timeout in seconds |
| `--mode` | `-m` | `paper` | `paper` or `live` |
| `--fee-bps` | | `4` | Round-trip fee estimate in bps |

## Environment Variables

```
NATS_URL=nats://127.0.0.1:4222
NATS_SUBJECT_PREFIX=spread.binance_okx

# Required for live mode only
BN_API_KEY=
BN_API_SECRET=
OKX_API_KEY=
OKX_API_SECRET=
OKX_API_PASSPHRASE=
```
