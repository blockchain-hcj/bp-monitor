import { parseArgs } from "node:util";
import { BinanceClient } from "../execution/binanceClient.js";

type ExchangeInfoSymbol = {
  symbol?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  filters?: Array<{
    filterType?: string;
    tickSize?: string;
    stepSize?: string;
    minQty?: string;
  }>;
};

type ExchangeInfoResponse = {
  symbols?: ExchangeInfoSymbol[];
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", short: "s" },
      price: { type: "string", short: "p" },
      side: { type: "string" },
      "base-url": { type: "string" },
    },
    strict: false,
  });

  const symbol = String(values.symbol ?? "OPNUSDT").toUpperCase();
  const price = Number(values.price ?? "0.4768");
  const side = String(values.side ?? "buy").toLowerCase() === "sell" ? "sell" : "buy";
  const baseUrl = String(values["base-url"] ?? "https://fapi.binance.com");

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`invalid price: ${values.price}`);
  }

  const res = await fetch(`${baseUrl}/fapi/v1/exchangeInfo?symbol=${symbol}`);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`exchangeInfo failed: ${res.status} ${body}`);
  }
  const payload = JSON.parse(body) as ExchangeInfoResponse;
  const item = payload.symbols?.[0];
  const priceFilter = item?.filters?.find((f) => f.filterType === "PRICE_FILTER");
  const lot = item?.filters?.find((f) => f.filterType === "LOT_SIZE");

  console.log("[probe] ===== Binance quantization probe =====");
  console.log(`[probe] symbol=${symbol} inputPrice=${price}`);
  console.log(
    `[probe] exchangeInfo pricePrecision=${item?.pricePrecision ?? "n/a"} quantityPrecision=${item?.quantityPrecision ?? "n/a"}`
  );
  console.log(
    `[probe] filters tickSize=${priceFilter?.tickSize ?? "n/a"} stepSize=${lot?.stepSize ?? "n/a"} minQty=${lot?.minQty ?? "n/a"}`
  );

  const client = new BinanceClient();
  const qBuy = await client.quantizePrice(price, symbol, "buy");
  const qSell = await client.quantizePrice(price, symbol, "sell");
  console.log(`[probe] quantized BUY = ${qBuy}`);
  console.log(`[probe] quantized SELL = ${qSell}`);

  if (side === "buy") {
    console.log(`[probe] selected(${side})=${qBuy}`);
  } else {
    console.log(`[probe] selected(${side})=${qSell}`);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[probe] FAILED: ${msg}`);
  process.exit(1);
});
