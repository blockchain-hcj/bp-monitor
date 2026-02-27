import { parseArgs } from "node:util";
import { connect, StringCodec } from "nats";

type SpreadEvent = {
  symbol?: string;
  ts_ingest?: number;
  ts_publish?: number;
  best_bid_a?: number;
  best_ask_a?: number;
  best_bid_b?: number;
  best_ask_b?: number;
};

function normalizeEpochMs(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e11) return Math.round(n * 1000);
  if (n < 1e14) return Math.round(n);
  if (n < 1e17) return Math.round(n / 1000);
  return Math.round(n / 1_000_000);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", short: "s" },
      prefix: { type: "string" },
      "nats-url": { type: "string" },
      raw: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      seconds: { type: "string" },
    },
    strict: false,
  });

  const symbol = String(values.symbol ?? "BTCUSDT").toUpperCase();
  const prefix = String(values.prefix ?? process.env.NATS_SUBJECT_PREFIX ?? "spread.binance_okx");
  const natsUrl = String(values["nats-url"] ?? process.env.NATS_URL ?? "nats://127.0.0.1:4222");
  const limitSec = values.seconds ? Math.max(1, Number(values.seconds)) : 0;
  const subject = `${prefix}.${symbol}`;
  const rawMode = Boolean(values.raw);
  const verbose = Boolean(values.verbose);
  const sc = StringCodec();

  const nc = await connect({ servers: natsUrl, timeout: 5000 });
  const sub = nc.subscribe(subject);
  const startedAt = Date.now();

  let total = 0;
  let parseFail = 0;
  let secCount = 0;
  let secParseFail = 0;
  const secPublishLag: number[] = [];
  const secIngestLag: number[] = [];

  console.log(`[probe] nats=${natsUrl}`);
  console.log(`[probe] subject=${subject}`);
  console.log(`[probe] symbol=${symbol} raw=${rawMode} verbose=${verbose} seconds=${limitSec || "unlimited"}`);

  const flushSecond = () => {
    const now = Date.now();
    const uptimeSec = ((now - startedAt) / 1000).toFixed(1);
    const pubP50 = median(secPublishLag);
    const pubMax = secPublishLag.length ? Math.max(...secPublishLag) : 0;
    const ingP50 = median(secIngestLag);
    const ingMax = secIngestLag.length ? Math.max(...secIngestLag) : 0;
    console.log(
      `[${uptimeSec}s] msgs=${secCount}/s parseFail=${secParseFail}/s` +
        ` pubLag(p50/max)=${fmtMs(pubP50)}/${fmtMs(pubMax)}` +
        ` ingestLag(p50/max)=${fmtMs(ingP50)}/${fmtMs(ingMax)} total=${total}`
    );
    secCount = 0;
    secParseFail = 0;
    secPublishLag.length = 0;
    secIngestLag.length = 0;
  };

  const timer = setInterval(flushSecond, 1000);

  const stop = async (reason: string) => {
    clearInterval(timer);
    console.log(`[probe] stop: ${reason}; total=${total}; parseFail=${parseFail}`);
    await nc.drain().catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void stop("SIGINT");
  });
  process.on("SIGTERM", () => {
    void stop("SIGTERM");
  });

  if (limitSec > 0) {
    setTimeout(() => {
      void stop(`timeout ${limitSec}s`);
    }, limitSec * 1000).unref();
  }

  for await (const msg of sub) {
    total++;
    secCount++;
    const now = Date.now();
    const payload = sc.decode(msg.data);
    if (rawMode) {
      console.log(`[raw] ts=${now} subject=${msg.subject} payload=${payload}`);
      continue;
    }
    try {
      const raw = JSON.parse(payload) as SpreadEvent;
      const pubTs = normalizeEpochMs(raw.ts_publish);
      const ingTs = normalizeEpochMs(raw.ts_ingest);
      if (pubTs) secPublishLag.push(Math.max(0, now - pubTs));
      if (ingTs) secIngestLag.push(Math.max(0, now - ingTs));

      if (verbose) {
        const bidA = Number(raw.best_bid_a ?? NaN);
        const askA = Number(raw.best_ask_a ?? NaN);
        const bidB = Number(raw.best_bid_b ?? NaN);
        const askB = Number(raw.best_ask_b ?? NaN);
        console.log(
          `[msg] subject=${msg.subject} symbol=${raw.symbol ?? "?"} pubLag=${pubTs ? fmtMs(Math.max(0, now - pubTs)) : "n/a"}` +
            ` ingestLag=${ingTs ? fmtMs(Math.max(0, now - ingTs)) : "n/a"} ` +
            `bn=${Number.isFinite(bidA) && Number.isFinite(askA) ? `${bidA}/${askA}` : "n/a"} ` +
            `okx=${Number.isFinite(bidB) && Number.isFinite(askB) ? `${bidB}/${askB}` : "n/a"}`
        );
      }
    } catch {
      parseFail++;
      secParseFail++;
    }
  }
}

main().catch((error) => {
  console.error("[probe] failed:", error);
  process.exit(1);
});
