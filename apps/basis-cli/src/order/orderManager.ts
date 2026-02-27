import {
  CliConfig,
  Direction,
  ExchangeClient,
  LegOrderState,
  LegSide,
  LogEntry,
  SessionState,
} from "../types.js";
import { LimitOrderPricer } from "../pricing/limitOrderPricer.js";
import { PriceFeed } from "../pricing/priceFeed.js";
import { formatErrorDetails } from "../execution/errorFormat.js";

const POLL_INTERVAL_MS = 500;
const SINGLE_LEG_FILL_GRACE_MS = 10_000;
const MAX_AMEND_COUNT = 3;
const AMEND_EXTRA_BPS = 1;

export interface OrderParams {
  symbol: string;
  direction: Direction;
  quantity: number;
  slippageBps: number;
}

export class OrderManager {
  private state: SessionState = {
    phase: "IDLE",
    binanceLeg: null,
    okxLeg: null,
    logs: [],
    natsConnected: false,
    priceStale: false,
  };

  private activeParams: OrderParams | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private onUpdate: (() => void) | null = null;

  constructor(
    private readonly binanceClient: ExchangeClient,
    private readonly okxClient: ExchangeClient,
    private readonly pricer: LimitOrderPricer,
    private readonly priceFeed: PriceFeed,
    private readonly config: CliConfig,
    private readonly getParams?: () => OrderParams
  ) {}

  getState(): SessionState {
    return this.state;
  }

  setOnUpdate(cb: () => void) {
    this.onUpdate = cb;
  }

  setNatsConnected(v: boolean) {
    this.state.natsConnected = v;
    this.emit();
  }

  private log(text: string) {
    const entry: LogEntry = { tsMs: Date.now(), text };
    this.state.logs.push(entry);
    if (this.state.logs.length > 50) {
      this.state.logs = this.state.logs.slice(-50);
    }
    this.emit();
  }

  private emit() {
    const snap = this.priceFeed.snapshot;
    this.state.priceStale = !snap || this.priceFeed.isStale;
    this.onUpdate?.();
  }

  async execute(): Promise<void> {
    if (this.state.phase !== "IDLE") {
      this.log("Cannot execute: not in IDLE state");
      return;
    }

    const snap = this.priceFeed.snapshot;
    if (!snap) {
      this.log("Cannot execute: no price data");
      return;
    }
    if (this.priceFeed.isStale) {
      this.log("Cannot execute: price data stale");
      return;
    }
    if (!this.state.natsConnected) {
      this.log("Cannot execute: NATS disconnected");
      return;
    }

    // Snapshot params at execution time
    const params: OrderParams = this.getParams
      ? this.getParams()
      : { symbol: this.config.symbol, direction: this.config.direction, quantity: this.config.quantity, slippageBps: this.config.slippageBps };
    this.activeParams = params;

    this.state.phase = "PLACING";
    this.emit();

    try {
      const prices = await this.pricer.compute(
        snap,
        params.direction,
        params.slippageBps,
        params.symbol
      );

      const { binanceSide, okxSide } = directionToSides(params.direction);

      const [bnNormQty, okxNormQty] = await Promise.all([
        this.binanceClient.normalizeBaseQty(params.symbol, params.quantity),
        this.okxClient.normalizeBaseQty(params.symbol, params.quantity),
      ]);

      this.log(
        `Placing ${binanceSide.toUpperCase()} BN @ ${prices.binancePrice} / ${okxSide.toUpperCase()} OKX @ ${prices.okxPrice}`
      );

      const [bnResult, okxResult] = await Promise.all([
        this.binanceClient.placeLimitOrder(
          params.symbol,
          binanceSide,
          bnNormQty,
          prices.binancePrice,
          false
        ),
        this.okxClient.placeLimitOrder(
          params.symbol,
          okxSide,
          okxNormQty,
          prices.okxPrice,
          false
        ),
      ]);

      const now = Date.now();
      this.state.binanceLeg = {
        exchange: "binance",
        side: binanceSide,
        orderId: bnResult.orderId,
        limitPrice: prices.binancePrice,
        status: "new",
        filledQty: 0,
        avgPrice: 0,
        placedAtMs: now,
        amendCount: 0,
      };
      this.state.okxLeg = {
        exchange: "okx",
        side: okxSide,
        orderId: okxResult.orderId,
        limitPrice: prices.okxPrice,
        status: "new",
        filledQty: 0,
        avgPrice: 0,
        placedAtMs: now,
        amendCount: 0,
      };

      this.state.phase = "MONITORING";
      this.log(`Orders placed: BN#${bnResult.orderId} OKX#${okxResult.orderId}`);
      this.emit();

      this.startPolling();
      this.startTimeout();
    } catch (err: unknown) {
      this.log(`Execute error: ${formatErrorDetails(err)}`);
      this.state.phase = "IDLE";
      this.emit();
    }
  }

  async cancelAll(): Promise<void> {
    if (this.state.phase !== "MONITORING") {
      this.log("Nothing to cancel");
      return;
    }

    this.stopPolling();
    this.stopTimeout();

    const symbol = this.activeParams?.symbol ?? this.config.symbol;
    const cancels: Promise<void>[] = [];
    if (this.state.binanceLeg && !isFinal(this.state.binanceLeg.status)) {
      cancels.push(this.cancelLeg(this.binanceClient, this.state.binanceLeg, symbol));
    }
    if (this.state.okxLeg && !isFinal(this.state.okxLeg.status)) {
      cancels.push(this.cancelLeg(this.okxClient, this.state.okxLeg, symbol));
    }

    await Promise.allSettled(cancels);
    this.state.phase = "CANCELLED";
    this.log("All orders cancelled");
    this.emit();

    // Return to IDLE after a short delay
    setTimeout(() => {
      this.state.phase = "IDLE";
      this.emit();
    }, 1500);
  }

  async amendAll(): Promise<void> {
    if (this.state.phase !== "MONITORING") {
      this.log("Nothing to amend");
      return;
    }

    const snap = this.priceFeed.snapshot;
    if (!snap) {
      this.log("Cannot amend: no price data");
      return;
    }

    // Cancel existing unfilled orders and re-place at new prices
    await this.cancelAll();

    // Wait for IDLE then re-execute
    setTimeout(() => {
      this.execute();
    }, 500);
  }

  /** Graceful shutdown: cancel all open orders */
  async shutdown(): Promise<void> {
    this.stopPolling();
    this.stopTimeout();

    const symbol = this.activeParams?.symbol ?? this.config.symbol;
    const cancels: Promise<void>[] = [];
    if (this.state.binanceLeg && !isFinal(this.state.binanceLeg.status)) {
      cancels.push(this.cancelLeg(this.binanceClient, this.state.binanceLeg, symbol));
    }
    if (this.state.okxLeg && !isFinal(this.state.okxLeg.status)) {
      cancels.push(this.cancelLeg(this.okxClient, this.state.okxLeg, symbol));
    }
    if (cancels.length > 0) {
      this.log("Shutting down: cancelling open orders...");
      await Promise.allSettled(cancels);
      this.log("All orders cancelled, exiting");
    }
  }

  reset(): void {
    this.stopPolling();
    this.stopTimeout();
    this.state.phase = "IDLE";
    this.state.binanceLeg = null;
    this.state.okxLeg = null;
    this.activeParams = null;
    this.emit();
  }

  private async cancelLeg(client: ExchangeClient, leg: LegOrderState, symbol: string): Promise<void> {
    try {
      await client.cancelOrder(symbol, leg.orderId);
      leg.status = "canceled";
      this.log(`Cancelled ${leg.exchange.toUpperCase()} #${leg.orderId}`);
    } catch (err: unknown) {
      this.log(`Cancel ${leg.exchange.toUpperCase()} failed: ${formatErrorDetails(err)}`);
    }
  }

  private startPolling() {
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startTimeout() {
    this.timeoutTimer = setTimeout(() => this.onTimeout(), this.config.timeoutSec * 1000);
  }

  private stopTimeout() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private async onTimeout() {
    this.log("Timeout reached, cancelling...");
    await this.cancelAll();
    this.state.phase = "TIMEOUT";
    this.emit();
    setTimeout(() => {
      this.state.phase = "IDLE";
      this.emit();
    }, 1500);
  }

  private async poll() {
    if (this.state.phase !== "MONITORING") return;
    if (!this.state.binanceLeg || !this.state.okxLeg) return;
    const params = this.activeParams!;

    try {
      const [bnStatus, okxStatus] = await Promise.all([
        this.binanceClient.getOrderStatus(params.symbol, this.state.binanceLeg.orderId),
        this.okxClient.getOrderStatus(params.symbol, this.state.okxLeg.orderId),
      ]);

      this.updateLeg(this.state.binanceLeg, bnStatus.status, bnStatus.filledQty, bnStatus.avgPrice);
      this.updateLeg(this.state.okxLeg, okxStatus.status, okxStatus.filledQty, okxStatus.avgPrice);
      this.emit();

      // Check if both filled
      if (this.state.binanceLeg.status === "filled" && this.state.okxLeg.status === "filled") {
        this.stopPolling();
        this.stopTimeout();
        this.state.phase = "FILLED";
        this.log(
          `Both legs FILLED! BN avg=${this.state.binanceLeg.avgPrice} OKX avg=${this.state.okxLeg.avgPrice}`
        );
        this.emit();

        setTimeout(() => {
          this.state.phase = "IDLE";
          this.emit();
        }, 2000);
        return;
      }

      // Single-leg fill protection
      await this.checkSingleLegFill();
    } catch (err: any) {
      this.log(`Poll error: ${err.message}`);
    }
  }

  private updateLeg(
    leg: LegOrderState,
    newStatus: string,
    filledQty: number,
    avgPrice: number
  ) {
    const prevStatus = leg.status;
    leg.status = newStatus as any;
    leg.filledQty = filledQty;
    leg.avgPrice = avgPrice;
    if (prevStatus !== newStatus) {
      this.log(
        `${leg.exchange.toUpperCase()} #${leg.orderId} → ${newStatus.toUpperCase()}` +
          (newStatus === "filled" ? ` avg=${avgPrice}` : "")
      );
    }
  }

  private async checkSingleLegFill() {
    const bnLeg = this.state.binanceLeg!;
    const okxLeg = this.state.okxLeg!;
    const params = this.activeParams!;

    // One filled, other not
    const bnFilled = bnLeg.status === "filled";
    const okxFilled = okxLeg.status === "filled";
    if (!bnFilled && !okxFilled) return;
    if (bnFilled && okxFilled) return;

    const filledLeg = bnFilled ? bnLeg : okxLeg;
    const pendingLeg = bnFilled ? okxLeg : bnLeg;
    const pendingClient = bnFilled ? this.okxClient : this.binanceClient;
    const elapsed = Date.now() - filledLeg.placedAtMs;

    // Only act after grace period
    if (elapsed < SINGLE_LEG_FILL_GRACE_MS) return;

    if (pendingLeg.amendCount < MAX_AMEND_COUNT) {
      // Amend: cancel and re-place with more aggressive price
      this.log(
        `Single-leg fill protection: amending ${pendingLeg.exchange.toUpperCase()} (attempt ${pendingLeg.amendCount + 1}/${MAX_AMEND_COUNT})`
      );
      try {
        await pendingClient.cancelOrder(params.symbol, pendingLeg.orderId);
        const snap = this.priceFeed.snapshot;
        if (!snap) return;

        const extraBps = AMEND_EXTRA_BPS * (pendingLeg.amendCount + 1);
        const prices = await this.pricer.computeAmend(
          snap,
          params.direction,
          params.slippageBps,
          extraBps,
          params.symbol
        );
        const newPrice = pendingLeg.exchange === "binance" ? prices.binancePrice : prices.okxPrice;
        const normQty = await pendingClient.normalizeBaseQty(params.symbol, params.quantity);

        const result = await pendingClient.placeLimitOrder(
          params.symbol,
          pendingLeg.side,
          normQty,
          newPrice,
          false
        );

        pendingLeg.orderId = result.orderId;
        pendingLeg.limitPrice = newPrice;
        pendingLeg.status = "new";
        pendingLeg.amendCount++;
        pendingLeg.placedAtMs = Date.now();
        this.log(`Re-placed ${pendingLeg.exchange.toUpperCase()} @ ${newPrice}`);
      } catch (err: any) {
        this.log(`Amend error: ${err.message}`);
      }
    } else {
      // Market fallback
      this.log(`Max amends reached, market-filling ${pendingLeg.exchange.toUpperCase()}`);
      try {
        await pendingClient.cancelOrder(params.symbol, pendingLeg.orderId);
        const normQty = await pendingClient.normalizeBaseQty(params.symbol, params.quantity);
        const result = await pendingClient.placeMarketOrder(
          params.symbol,
          pendingLeg.side,
          normQty,
          false
        );
        pendingLeg.orderId = result.orderId;
        pendingLeg.status = "filled";
        this.log(`Market order placed: ${pendingLeg.exchange.toUpperCase()} #${result.orderId}`);
      } catch (err: any) {
        this.log(`Market fallback error: ${err.message}`);
      }
    }
  }
}

function directionToSides(direction: Direction): { binanceSide: LegSide; okxSide: LegSide } {
  if (direction === "binance_to_okx") {
    return { binanceSide: "buy", okxSide: "sell" };
  }
  return { binanceSide: "sell", okxSide: "buy" };
}

function isFinal(status: string): boolean {
  return status === "filled" || status === "canceled" || status === "rejected";
}
