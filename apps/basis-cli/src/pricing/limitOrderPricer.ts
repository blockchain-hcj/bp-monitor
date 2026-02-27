import { Direction, ExchangeClient, LegSide, LimitPrices, PriceSnapshot } from "../types.js";

export class LimitOrderPricer {
  constructor(
    private readonly binanceClient: ExchangeClient,
    private readonly okxClient: ExchangeClient
  ) {}

  /**
   * Calculate limit prices for a two-leg basis trade.
   *
   * For binance_to_okx (buy Binance, sell OKX):
   *   binance_limit = binance_ask + slippage_bps / 10000 * mid   (willing to pay more)
   *   okx_limit     = okx_bid     - slippage_bps / 10000 * mid   (willing to receive less)
   *
   * For okx_to_binance (buy OKX, sell Binance):
   *   okx_limit     = okx_ask     + slippage_bps / 10000 * mid
   *   binance_limit = binance_bid - slippage_bps / 10000 * mid
   */
  async compute(
    snapshot: PriceSnapshot,
    direction: Direction,
    slippageBps: number,
    symbol: string
  ): Promise<LimitPrices> {
    const mid = (snapshot.binanceBid + snapshot.binanceAsk + snapshot.okxBid + snapshot.okxAsk) / 4;
    const slip = (slippageBps / 10000) * mid;

    let rawBinancePrice: number;
    let rawOkxPrice: number;
    let binanceSide: LegSide;
    let okxSide: LegSide;

    if (direction === "binance_to_okx") {
      // Buy on Binance, sell on OKX
      rawBinancePrice = snapshot.binanceAsk + slip;
      rawOkxPrice = snapshot.okxBid - slip;
      binanceSide = "buy";
      okxSide = "sell";
    } else {
      // Buy on OKX, sell on Binance
      rawOkxPrice = snapshot.okxAsk + slip;
      rawBinancePrice = snapshot.binanceBid - slip;
      binanceSide = "sell";
      okxSide = "buy";
    }

    const [binancePrice, okxPrice] = await Promise.all([
      this.binanceClient.quantizePrice(rawBinancePrice, symbol, binanceSide),
      this.okxClient.quantizePrice(rawOkxPrice, symbol, okxSide),
    ]);

    return { binancePrice, okxPrice };
  }

  /**
   * Compute amend prices with additional bps offset.
   */
  async computeAmend(
    snapshot: PriceSnapshot,
    direction: Direction,
    slippageBps: number,
    extraBps: number,
    symbol: string
  ): Promise<LimitPrices> {
    return this.compute(snapshot, direction, slippageBps + extraBps, symbol);
  }
}
