import { loadConfig } from "../config.js";
import { Direction } from "../types.js";
import { runTraderTui } from "./traderTui.js";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseDirection(raw: string | undefined): Direction {
  if (raw === "okx_to_binance") {
    return raw;
  }
  return "binance_to_okx";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const symbol = (arg("--symbol") ?? "BTCUSDT").toUpperCase();
  const direction = parseDirection(arg("--direction"));
  const qtyUsdt = Number(arg("--qty-usdt") ?? "100");
  const slippageBps = Number(arg("--slippage-bps") ?? "2");
  const orderTtlMs = Number(arg("--order-ttl-ms") ?? "200");
  const readOnly = !hasFlag("--enable-trade");
  const refreshMs = Number(arg("--refresh-ms") ?? "1000");
  const plain = hasFlag("--plain");

  await runTraderTui({
    config,
    symbol,
    direction,
    qtyUsdt: Number.isFinite(qtyUsdt) && qtyUsdt > 0 ? qtyUsdt : 100,
    slippageBps: Number.isFinite(slippageBps) && slippageBps >= 0 ? slippageBps : 2,
    orderTtlMs: Number.isFinite(orderTtlMs) && orderTtlMs > 0 ? orderTtlMs : 200,
    readOnly,
    refreshMs: Number.isFinite(refreshMs) && refreshMs > 0 ? refreshMs : 1000,
    plain
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
