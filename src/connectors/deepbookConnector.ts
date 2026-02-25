import { AsyncQueue } from "../utils/asyncQueue.js";
import { DeepbookRuntimeConfig, ConnectorHealth, ExchangeConnector, OrderbookDelta, OrderbookSnapshot } from "../types.js";

type DeepbookClientLike = {
  getLevel2TicksFromMid: (
    poolKey: string,
    ticks: number
  ) => Promise<{ bid_prices: number[]; ask_prices: number[]; bid_quantities: number[]; ask_quantities: number[] }>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importByName(moduleName: string): Promise<any> {
  const importer = new Function("m", "return import(m)") as (m: string) => Promise<any>;
  return importer(moduleName);
}

export class DeepbookConnector implements ExchangeConnector {
  private closed = false;
  private reconnects = 0;
  private connected = false;
  private lastMessageAtMs = 0;
  private lastError: string | undefined;
  private queue: AsyncQueue<OrderbookDelta> | null = null;
  private client: DeepbookClientLike | null = null;
  private readonly seqBySymbol = new Map<string, number>();
  private lastSuccessLogAtMs = 0;
  private readonly successLogIntervalMs = 5_000;

  constructor(private readonly config: DeepbookRuntimeConfig) {}

  connect(symbols: string[]): AsyncIterable<OrderbookDelta> {
    this.closed = false;
    this.queue = new AsyncQueue<OrderbookDelta>();

    if (!this.config.enabled) {
      this.connected = true;
      this.queue.end();
      return this.queue.iterate();
    }

    const supported = symbols.filter((symbol) => Boolean(this.config.symbolPoolMap[symbol]));
    if (supported.length === 0) {
      this.connected = true;
      this.queue.end();
      return this.queue.iterate();
    }

    void this.pollLoop(supported);
    return this.queue.iterate();
  }

  async snapshot(symbol: string): Promise<OrderbookSnapshot> {
    const poolKey = this.config.symbolPoolMap[symbol];
    if (!poolKey) {
      throw new Error(`DeepBook pool not configured for symbol ${symbol}`);
    }
    const top = await this.fetchTop(symbol, poolKey);
    return {
      exchange: "deepbook",
      symbol,
      tsExchangeMs: top.tsExchangeMs,
      bid: top.bid,
      ask: top.ask,
      seq: top.seq
    };
  }

  health(): ConnectorHealth {
    return {
      exchange: "deepbook",
      connected: this.connected,
      reconnects: this.reconnects,
      lastMessageAtMs: this.lastMessageAtMs,
      lastError: this.lastError
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.client = null;
    this.queue?.end();
  }

  private async pollLoop(symbols: string[]): Promise<void> {
    while (!this.closed) {
      try {
        const tasks = symbols
          .map((symbol) => {
            const poolKey = this.config.symbolPoolMap[symbol];
            if (!poolKey) {
              return null;
            }
            return this.fetchTop(symbol, poolKey);
          })
          .filter((task): task is Promise<Awaited<ReturnType<DeepbookConnector["fetchTop"]>>> => Boolean(task));

        const results = await Promise.allSettled(tasks);
        for (const result of results) {
          if (result.status !== "fulfilled") {
            this.connected = false;
            this.reconnects += 1;
            this.lastError = result.reason instanceof Error ? result.reason.message : String(result.reason);
            console.error(`[deepbook] poll error: ${this.lastError}`);
            continue;
          }
          const top = result.value;
          this.connected = true;
          this.lastError = undefined;
          this.lastMessageAtMs = Date.now();
          this.queue?.push({
            exchange: "deepbook",
            symbol: top.symbol,
            tsExchangeMs: top.tsExchangeMs,
            tsIngestMs: top.tsIngestMs,
            bid: top.bid,
            ask: top.ask,
            seq: top.seq
          });
        }
      } catch (error) {
        this.connected = false;
        this.reconnects += 1;
        this.lastError = error instanceof Error ? error.message : String(error);
        console.error(`[deepbook] poll error: ${this.lastError}`);
      }
      await delay(Math.max(250, this.config.pollIntervalMs));
    }
  }

  private async fetchTop(symbol: string, poolKey: string): Promise<{
    symbol: string;
    bid: number;
    ask: number;
    tsExchangeMs: number;
    tsIngestMs: number;
    seq: number;
    fetchLatencyMs: number;
  }> {
    const start = Date.now();
    const client = await this.getClient();
    const book = await client.getLevel2TicksFromMid(poolKey, 1);
    const fetchLatencyMs = Date.now() - start;
    const bid = Number(book.bid_prices?.[0] ?? 0);
    const ask = Number(book.ask_prices?.[0] ?? 0);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || bid > ask) {
      throw new Error(`DeepBook invalid top for ${symbol} (${poolKey}): bid=${bid}, ask=${ask}`);
    }
    const now = Date.now();
    const nextSeq = (this.seqBySymbol.get(symbol) ?? 0) + 1;
    this.seqBySymbol.set(symbol, nextSeq);
    if (now - this.lastSuccessLogAtMs >= this.successLogIntervalMs) {
      this.lastSuccessLogAtMs = now;
      console.info(
        `[deepbook] top ok symbol=${symbol} pool=${poolKey} bid=${bid.toFixed(6)} ask=${ask.toFixed(6)} seq=${nextSeq} latency_ms=${fetchLatencyMs}`
      );
    }
    return {
      symbol,
      bid,
      ask,
      tsExchangeMs: now,
      tsIngestMs: now,
      seq: nextSeq,
      fetchLatencyMs
    };
  }

  private async getClient(): Promise<DeepbookClientLike> {
    if (this.client) {
      return this.client;
    }

    const [deepbookModule, suiClientModule, suiJsonRpcModule, suiTxModule, suiBcsModule] = await Promise.all([
      importByName("@mysten/deepbook-v3"),
      importByName("@mysten/sui/client").catch(() => ({})),
      importByName("@mysten/sui/jsonRpc").catch(() => ({})),
      importByName("@mysten/sui/transactions"),
      importByName("@mysten/sui/bcs")
    ]);

    const getDefaultRpcUrl = (): string => {
      if (typeof suiClientModule.getFullnodeUrl === "function") {
        return String(suiClientModule.getFullnodeUrl(this.config.network) ?? "");
      }
      if (typeof suiJsonRpcModule.getJsonRpcFullnodeUrl === "function") {
        return String(suiJsonRpcModule.getJsonRpcFullnodeUrl(this.config.network) ?? "");
      }
      return "";
    };

    const rpcUrl = this.config.rpcUrl || getDefaultRpcUrl();
    if (!rpcUrl) {
      throw new Error("DeepBook RPC URL not set. Configure DEEPBOOK_RPC_URL.");
    }

    const createSuiClient = () => {
      if (typeof suiClientModule.SuiClient === "function") {
        return new suiClientModule.SuiClient({ url: rpcUrl });
      }
      if (typeof suiJsonRpcModule.SuiJsonRpcClient === "function") {
        return new suiJsonRpcModule.SuiJsonRpcClient({ url: rpcUrl, network: this.config.network });
      }
      throw new Error("No compatible Sui client constructor found.");
    };

    const suiClient = createSuiClient();
    const Transaction = suiTxModule.Transaction;
    const bcs = suiBcsModule.bcs;
    const FLOAT_SCALAR = Number(deepbookModule.FLOAT_SCALAR ?? 1_000_000_000);
    const pools = this.config.network === "testnet" ? deepbookModule.testnetPools : deepbookModule.mainnetPools;
    const coins = this.config.network === "testnet" ? deepbookModule.testnetCoins : deepbookModule.mainnetCoins;
    const packageIds =
      this.config.network === "testnet" ? deepbookModule.testnetPackageIds : deepbookModule.mainnetPackageIds;
    const packageId = packageIds?.DEEPBOOK_PACKAGE_ID;
    if (!packageId) {
      throw new Error(`DeepBook package id not found for network ${this.config.network}`);
    }

    const sender = this.config.address && !/^0x0+$/i.test(this.config.address) ? this.config.address : "0x1";
    this.client = {
      getLevel2TicksFromMid: async (poolKey: string, ticks: number) => {
        const pool = pools?.[poolKey];
        if (!pool) {
          throw new Error(`DeepBook pool key not found: ${poolKey}`);
        }
        const baseCoin = coins?.[pool.baseCoin];
        const quoteCoin = coins?.[pool.quoteCoin];
        if (!baseCoin || !quoteCoin) {
          throw new Error(`DeepBook coin config missing for pool ${poolKey}`);
        }

        const tx = new Transaction();
        tx.setSenderIfNotSet(sender);
        tx.moveCall({
          target: `${packageId}::pool::get_level2_ticks_from_mid`,
          arguments: [tx.object(pool.address), tx.pure.u64(Math.max(1, ticks)), tx.object.clock()],
          typeArguments: [baseCoin.type, quoteCoin.type]
        });

        let bidPricesRaw: number[] | Uint8Array | null = null;
        let bidQtyRaw: number[] | Uint8Array | null = null;
        let askPricesRaw: number[] | Uint8Array | null = null;
        let askQtyRaw: number[] | Uint8Array | null = null;

        if (typeof suiClient.devInspectTransactionBlock === "function") {
          const dev = await suiClient.devInspectTransactionBlock({
            sender,
            transactionBlock: tx
          });
          const returnValues = dev?.results?.[0]?.returnValues ?? [];
          if (returnValues.length >= 4) {
            bidPricesRaw = returnValues[0][0];
            bidQtyRaw = returnValues[1][0];
            askPricesRaw = returnValues[2][0];
            askQtyRaw = returnValues[3][0];
          }
        }

        if (!bidPricesRaw || !bidQtyRaw || !askPricesRaw || !askQtyRaw) {
          const res = await suiClient.core.simulateTransaction({
            transaction: tx,
            include: { commandResults: true, effects: true }
          });
          if (!res?.commandResults?.[0]?.returnValues || res.commandResults[0].returnValues.length < 4) {
            throw new Error("DeepBook read returned no command results");
          }
          bidPricesRaw = res.commandResults[0].returnValues[0].bcs;
          bidQtyRaw = res.commandResults[0].returnValues[1].bcs;
          askPricesRaw = res.commandResults[0].returnValues[2].bcs;
          askQtyRaw = res.commandResults[0].returnValues[3].bcs;
        }

        const bidPricesBytes = new Uint8Array(bidPricesRaw!);
        const bidQtyBytes = new Uint8Array(bidQtyRaw!);
        const askPricesBytes = new Uint8Array(askPricesRaw!);
        const askQtyBytes = new Uint8Array(askQtyRaw!);

        const bidPrices = bcs.vector(bcs.u64()).parse(bidPricesBytes).map((price: bigint | number) =>
          Number(((Number(price) / FLOAT_SCALAR / quoteCoin.scalar) * baseCoin.scalar).toFixed(9))
        );
        const askPrices = bcs.vector(bcs.u64()).parse(askPricesBytes).map((price: bigint | number) =>
          Number(((Number(price) / FLOAT_SCALAR / quoteCoin.scalar) * baseCoin.scalar).toFixed(9))
        );
        const bidQty = bcs.vector(bcs.u64()).parse(bidQtyBytes).map((qty: bigint | number) =>
          Number((Number(qty) / baseCoin.scalar).toFixed(9))
        );
        const askQty = bcs.vector(bcs.u64()).parse(askQtyBytes).map((qty: bigint | number) =>
          Number((Number(qty) / baseCoin.scalar).toFixed(9))
        );
        return {
          bid_prices: bidPrices,
          ask_prices: askPrices,
          bid_quantities: bidQty,
          ask_quantities: askQty
        };
      }
    };
    return this.client;
  }
}
