import { ArbInputEvent, Direction, RiskMode } from "../types.js";
import { PairedLimitExecutionResult } from "../execution/pairedLimitExecutor.js";

export interface TraderRuntimeParams {
  symbol: string;
  direction: Direction;
  qtyUsdt: number;
  slippageBps: number;
  orderTtlMs: number;
}

export interface TraderRuntimeState {
  riskMode: RiskMode;
  positionOpen: boolean;
  tradeEnabled: boolean;
  uiTick: number;
  uiTime: string;
  latestEvent: ArbInputEvent | null;
  lastExecution: PairedLimitExecutionResult | null;
  lastError: string | null;
}

export function buildTraderScreen(params: TraderRuntimeParams, state: TraderRuntimeState): string[] {
  const event = state.latestEvent;
  const ageMs = event ? Date.now() - event.ts_ingest : -1;
  const quality = event?.quality_flag?.length ? event.quality_flag.join(",") : "none";
  const exec = state.lastExecution;
  const legs =
    exec?.legs.map((leg) => `${leg.exchange}:${leg.status ?? "unknown"} qty=${(leg.filledQty ?? 0).toFixed(6)}`).join(" | ") ??
    "none";

  return [
    "=== Basis Trader CLI ===",
    `ui_tick=${state.uiTick} ui_time=${state.uiTime}`,
    `symbol=${params.symbol} direction=${params.direction} qty_usdt=${params.qtyUsdt.toFixed(2)} slippage_bps=${params.slippageBps.toFixed(2)} ttl_ms=${params.orderTtlMs}`,
    `risk=${state.riskMode} position=${state.positionOpen ? "OPEN" : "FLAT"} trade_enabled=${state.tradeEnabled ? "Y" : "N"} event_age_ms=${ageMs >= 0 ? ageMs : "N/A"} quality=${quality}`,
    event
      ? `binance bid/ask=${event.best_bid_binance.toFixed(4)}/${event.best_ask_binance.toFixed(4)} | okx bid/ask=${event.best_bid_okx.toFixed(
          4
        )}/${event.best_ask_okx.toFixed(4)} | bps b2o=${event.bps_binance_to_okx.toFixed(2)} o2b=${event.bps_okx_to_binance.toFixed(2)}`
      : "market: waiting for spread.* event...",
    exec
      ? `last_exec ok=${exec.ok ? "Y" : "N"} partial=${exec.partialFill ? "Y" : "N"} status=${exec.status} hedged=${
          exec.hedged ? "Y" : "N"
        } reason=${exec.reason ?? "none"}`
      : "last_exec: none",
    `last_legs: ${legs}`,
    `last_error: ${state.lastError ?? "none"}`,
    "keys: t=toggle-trade o=open c=close +/- qty [/]=slippage q=quit"
  ];
}
