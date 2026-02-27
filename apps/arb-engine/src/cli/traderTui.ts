import { SpreadSubscriber } from "../nats/spreadSubscriber.js";
import { StateStore } from "../strategy/stateStore.js";
import { RiskGuard } from "../risk/guard.js";
import { Direction, RuntimeConfig } from "../types.js";
import { PairedLimitExecutor, PairedLimitExecutionResult } from "../execution/pairedLimitExecutor.js";
import { PaperClient } from "../execution/paperClient.js";
import { BinanceClient } from "../execution/binanceClient.js";
import { OkxClient } from "../execution/okxClient.js";
import { buildTraderScreen, TraderRuntimeParams, TraderRuntimeState } from "./traderTuiState.js";

export interface TraderTuiOptions {
  config: RuntimeConfig;
  symbol: string;
  direction: Direction;
  qtyUsdt: number;
  slippageBps: number;
  orderTtlMs: number;
  readOnly: boolean;
  refreshMs: number;
  plain: boolean;
}

export async function runTraderTui(options: TraderTuiOptions): Promise<void> {
  const subscriber = new SpreadSubscriber(options.config.natsUrl, options.config.natsSubjectPrefix);
  const store = new StateStore();
  const risk = new RiskGuard(store);
  const clients =
    options.config.tradeMode === "paper"
      ? {
          binance: new PaperClient("binance"),
          okx: new PaperClient("okx")
        }
      : {
          binance: new BinanceClient(options.config.bnApiKey, options.config.bnApiSecret),
          okx: new OkxClient(
            options.config.okxApiKey,
            options.config.okxApiSecret,
            options.config.okxApiPassphrase,
            options.config.okxCtValOverrides
          )
        };
  const executor = new PairedLimitExecutor(
    clients,
    options.config.tradeMode
  );

  const params: TraderRuntimeParams = {
    symbol: options.symbol.toUpperCase(),
    direction: options.direction,
    qtyUsdt: options.qtyUsdt,
    slippageBps: options.slippageBps,
    orderTtlMs: options.orderTtlMs
  };
  let latestEvent: TraderRuntimeState["latestEvent"] = null;
  let lastExecution: PairedLimitExecutionResult | null = null;
  let lastError: string | null = null;
  let tradeEnabled = !options.readOnly;
  let uiTick = 0;
  let busy = false;
  let closed = false;
  const fullscreen = !options.plain && Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";

  function render(): void {
    uiTick += 1;
    const lines = buildTraderScreen(params, {
      riskMode: store.getRiskMode(),
      positionOpen: store.getPosition(params.symbol, params.direction).isOpen,
      tradeEnabled,
      uiTick,
      uiTime: new Date().toISOString(),
      latestEvent,
      lastExecution,
      lastError
    });
    if (fullscreen) {
      process.stdout.write("\x1b[2J\x1b[H");
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  async function executeAction(action: "open" | "close"): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    try {
      if (!latestEvent) {
        throw new Error("no_market_event");
      }
      const ageMs = Date.now() - latestEvent.ts_ingest;
      if (ageMs > options.config.strategy.event_stale_ms) {
        throw new Error(`stale_market_event:${ageMs}ms`);
      }
      if (action === "open") {
        if (!tradeEnabled) {
          throw new Error("trade_disabled_toggle_with_t");
        }
        if (store.getRiskMode() !== "normal") {
          throw new Error(`risk_mode_${store.getRiskMode()}`);
        }
        if (latestEvent.quality_flag.length > 0) {
          throw new Error(`quality_flag:${latestEvent.quality_flag.join(",")}`);
        }
      }

      const result = await executor.execute({
        symbol: params.symbol,
        direction: params.direction,
        action,
        event: latestEvent,
        notionalUsdt: params.qtyUsdt,
        slippageBps: params.slippageBps,
        orderTtlMs: params.orderTtlMs
      });
      lastExecution = result;
      lastError = null;

      if (action === "open") {
        if (result.ok && !result.partialFill) {
          store.setOpen(params.symbol, params.direction, 0, "manual_open");
        } else if (result.hedged) {
          store.setFlat(params.symbol, params.direction, "hedged_after_partial_fill");
        }
      } else if (result.ok || result.hedged) {
        store.setFlat(params.symbol, params.direction, "manual_close");
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      render();
    }
  }

  const keyHandler = (buf: Buffer) => {
    if (closed) {
      return;
    }
    const key = buf.toString("utf8");
    if (key === "q") {
      closed = true;
      void subscriber.close();
      return;
    }
    if (key === "o") {
      void executeAction("open");
      return;
    }
    if (key === "c") {
      if (!tradeEnabled) {
        lastError = "trade_disabled_toggle_with_t";
        render();
        return;
      }
      void executeAction("close");
      return;
    }
    if (key === "t") {
      tradeEnabled = !tradeEnabled;
      if (tradeEnabled) {
        lastError = null;
      }
      render();
      return;
    }
    if (key === "+") {
      params.qtyUsdt += 10;
      render();
      return;
    }
    if (key === "-") {
      params.qtyUsdt = Math.max(10, params.qtyUsdt - 10);
      render();
      return;
    }
    if (key === "[") {
      params.slippageBps = Math.max(0, params.slippageBps - 0.5);
      render();
      return;
    }
    if (key === "]") {
      params.slippageBps += 0.5;
      render();
    }
  };

  const interval = setInterval(render, Math.max(200, options.refreshMs));
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", keyHandler);

  render();

  const eventLoop = (async () => {
    for await (const event of subscriber.stream()) {
      if (closed) {
        break;
      }
      if (event.symbol !== params.symbol) {
        continue;
      }
      risk.onEvent(event);
      latestEvent = event;
      render();
    }
  })();

  while (!closed) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  clearInterval(interval);
  process.stdin.off("data", keyHandler);
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
  await subscriber.close();
  await Promise.race([eventLoop, new Promise((resolve) => setTimeout(resolve, 1000))]);
}
