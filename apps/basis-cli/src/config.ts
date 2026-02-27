import { parseArgs } from "node:util";
import { CliConfig, Direction, TradeMode } from "./types.js";

export function loadConfig(): CliConfig {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", short: "s" },
      direction: { type: "string", short: "d" },
      quantity: { type: "string", short: "q" },
      slippage: { type: "string" },
      timeout: { type: "string", short: "t" },
      mode: { type: "string", short: "m" },
      "fee-bps": { type: "string" },
    },
    strict: false,
  });

  const symbol = (values.symbol as string | undefined)?.toUpperCase() ?? "ETHUSDT";
  const directionRaw = (values.direction as string | undefined) ?? "binance_to_okx";
  if (directionRaw !== "binance_to_okx" && directionRaw !== "okx_to_binance") {
    throw new Error(`Invalid direction: ${directionRaw}. Must be binance_to_okx or okx_to_binance`);
  }
  const direction: Direction = directionRaw;

  const quantity = Number(values.quantity ?? "0.05");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Invalid quantity: ${values.quantity}`);
  }

  const slippageBps = Number(values.slippage ?? "2");
  if (!Number.isFinite(slippageBps) || slippageBps < 0) {
    throw new Error(`Invalid slippage: ${values.slippage}`);
  }

  const timeoutSec = Number(values.timeout ?? "30");
  const modeRaw = (values.mode as string | undefined) ?? "paper";
  if (modeRaw !== "paper" && modeRaw !== "live") {
    throw new Error(`Invalid mode: ${modeRaw}. Must be paper or live`);
  }
  const mode: TradeMode = modeRaw;

  const feeBps = Number(values["fee-bps"] ?? "4");
  const bnHedgeModeRaw = (process.env.BN_HEDGE_MODE ?? "auto").trim().toLowerCase();
  const bnHedgeMode: CliConfig["bnHedgeMode"] =
    bnHedgeModeRaw === "hedge" || bnHedgeModeRaw === "oneway" || bnHedgeModeRaw === "auto"
      ? bnHedgeModeRaw
      : "auto";

  return {
    symbol,
    direction,
    quantity,
    slippageBps,
    timeoutSec,
    mode,
    feeBps,
    natsUrl: process.env.NATS_URL ?? "nats://127.0.0.1:4222",
    natsSubjectPrefix: process.env.NATS_SUBJECT_PREFIX ?? "spread.binance_okx",
    okxApiKey: process.env.OKX_API_KEY,
    okxApiSecret: process.env.OKX_API_SECRET,
    okxApiPassphrase: process.env.OKX_API_PASSPHRASE,
    bnApiKey: process.env.BN_API_KEY,
    bnApiSecret: process.env.BN_API_SECRET,
    bnHedgeMode,
  };
}
