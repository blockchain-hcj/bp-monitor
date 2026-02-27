import { ArbInputEvent, Direction, DirectionSnapshot, ExecutionIntent, StrategyConfig } from "../types.js";
import { StateStore } from "./stateStore.js";

function legsFor(direction: Direction, symbol: string, notionalUsdt: number, reduceOnly: boolean) {
  if (direction === "binance_to_okx") {
    return [
      { exchange: "binance" as const, side: reduceOnly ? ("sell" as const) : ("buy" as const), symbol, notional_usdt: notionalUsdt, reduce_only: reduceOnly },
      { exchange: "okx" as const, side: reduceOnly ? ("buy" as const) : ("sell" as const), symbol, notional_usdt: notionalUsdt, reduce_only: reduceOnly }
    ];
  }

  return [
    { exchange: "okx" as const, side: reduceOnly ? ("sell" as const) : ("buy" as const), symbol, notional_usdt: notionalUsdt, reduce_only: reduceOnly },
    { exchange: "binance" as const, side: reduceOnly ? ("buy" as const) : ("sell" as const), symbol, notional_usdt: notionalUsdt, reduce_only: reduceOnly }
  ];
}

export class SignalEngine {
  constructor(
    private readonly config: StrategyConfig,
    private readonly state: StateStore
  ) {}

  evaluate(event: ArbInputEvent): ExecutionIntent[] {
    const now = Date.now();
    if (!this.config.symbols.includes(event.symbol)) {
      return [];
    }

    if (now - event.ts_ingest > this.config.event_stale_ms) {
      return [];
    }

    const symbolThreshold = this.config.thresholds[event.symbol];
    if (!symbolThreshold) {
      return [];
    }

    const intents: ExecutionIntent[] = [];
    intents.push(
      ...this.evaluateDirection(event, "binance_to_okx", event.bps_binance_to_okx, symbolThreshold.binance_to_okx.open_bps, symbolThreshold.binance_to_okx.close_bps),
      ...this.evaluateDirection(event, "okx_to_binance", event.bps_okx_to_binance, symbolThreshold.okx_to_binance.open_bps, symbolThreshold.okx_to_binance.close_bps)
    );

    if (intents.length > 0) {
      this.state.setLastSignal({ symbol: event.symbol, intents, ts: now });
    }

    return intents;
  }

  inspect(event: ArbInputEvent): DirectionSnapshot[] {
    if (!this.config.symbols.includes(event.symbol)) {
      return [];
    }

    const symbolThreshold = this.config.thresholds[event.symbol];
    if (!symbolThreshold) {
      return [];
    }

    return [
      this.inspectDirection(
        event,
        "binance_to_okx",
        event.bps_binance_to_okx,
        symbolThreshold.binance_to_okx.open_bps,
        symbolThreshold.binance_to_okx.close_bps
      ),
      this.inspectDirection(
        event,
        "okx_to_binance",
        event.bps_okx_to_binance,
        symbolThreshold.okx_to_binance.open_bps,
        symbolThreshold.okx_to_binance.close_bps
      )
    ];
  }

  private evaluateDirection(
    event: ArbInputEvent,
    direction: Direction,
    rawBps: number,
    openBps: number,
    closeBps: number
  ): ExecutionIntent[] {
    const netBps = rawBps - this.config.fee_bps - this.config.slippage_bps;
    const position = this.state.getPosition(event.symbol, direction);
    const riskMode = this.state.getRiskMode();

    if (!position.isOpen) {
      if (event.quality_flag.length > 0) {
        return [];
      }
      if (riskMode !== "normal") {
        return [];
      }
      if (netBps >= openBps) {
        return [
          {
            action: "open",
            symbol: event.symbol,
            direction,
            reason: `open threshold hit: net=${netBps.toFixed(2)} >= ${openBps.toFixed(2)}`,
            raw_bps: rawBps,
            net_bps: netBps,
            legs: legsFor(direction, event.symbol, this.config.notional_usdt, false),
            ts: Date.now()
          }
        ];
      }
      return [];
    }

    if (netBps <= closeBps) {
      return [
        {
          action: "close",
          symbol: event.symbol,
          direction,
          reason: `close threshold hit: net=${netBps.toFixed(2)} <= ${closeBps.toFixed(2)}`,
          raw_bps: rawBps,
          net_bps: netBps,
          legs: legsFor(direction, event.symbol, this.config.notional_usdt, true),
          ts: Date.now()
        }
      ];
    }

    return [];
  }

  private inspectDirection(
    event: ArbInputEvent,
    direction: Direction,
    rawBps: number,
    openBps: number,
    closeBps: number
  ): DirectionSnapshot {
    const netBps = rawBps - this.config.fee_bps - this.config.slippage_bps;
    const position = this.state.getPosition(event.symbol, direction);
    const riskMode = this.state.getRiskMode();
    const canOpenNow = riskMode === "normal" && !position.isOpen && netBps >= openBps;
    const shouldCloseNow = position.isOpen && netBps <= closeBps;

    return {
      direction,
      isOpen: position.isOpen,
      raw_bps: rawBps,
      net_bps: netBps,
      open_bps: openBps,
      close_bps: closeBps,
      gap_to_open_bps: openBps - netBps,
      gap_to_close_bps: netBps - closeBps,
      can_open_now: canOpenNow,
      should_close_now: shouldCloseNow
    };
  }
}
