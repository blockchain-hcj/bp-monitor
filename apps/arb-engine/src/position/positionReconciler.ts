import { ExecutionRouter } from "../execution/router.js";
import { Direction, ExchangePosition, RuntimeConfig } from "../types.js";
import { StateStore } from "../strategy/stateStore.js";
import { RiskGuard } from "../risk/guard.js";

function hasDirectionPosition(direction: Direction, binancePos: ExchangePosition, okxPos: ExchangePosition): boolean {
  if (direction === "binance_to_okx") {
    return binancePos.longNotionalUsdt > 1 && okxPos.shortNotionalUsdt > 1;
  }
  return okxPos.longNotionalUsdt > 1 && binancePos.shortNotionalUsdt > 1;
}

export class PositionReconciler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly router: ExecutionRouter,
    private readonly store: StateStore,
    private readonly risk: RiskGuard
  ) {}

  async start(): Promise<void> {
    if (this.config.tradeMode !== "live") {
      return;
    }
    await this.reconcileOnce();
    this.timer = setInterval(() => {
      void this.reconcileOnce();
    }, Math.max(1000, this.config.reconcileIntervalMs));
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcileOnce(): Promise<void> {
    for (const symbol of this.config.strategy.symbols) {
      try {
        const [bn, okx] = await Promise.all([
          this.router.client("binance").getPosition(symbol),
          this.router.client("okx").getPosition(symbol)
        ]);

        this.syncDirection(symbol, "binance_to_okx", bn, okx);
        this.syncDirection(symbol, "okx_to_binance", bn, okx);
      } catch (error) {
        this.risk.setMode("close_only", `reconcile_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private syncDirection(symbol: string, direction: Direction, bn: ExchangePosition, okx: ExchangePosition): void {
    const hasPos = hasDirectionPosition(direction, bn, okx);
    const current = this.store.getPosition(symbol, direction);

    if (hasPos && !current.isOpen) {
      this.store.setOpen(symbol, direction, 0, "reconcile_detected_open_position");
      return;
    }

    if (!hasPos && current.isOpen) {
      this.store.setFlat(symbol, direction, "reconcile_detected_flat_position");
    }
  }
}
