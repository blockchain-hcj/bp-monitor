import { ThresholdConfig } from "../types.js";
import { PostgresSpreadReadRepository } from "./spreadReadRepository.js";
import { renderMeanReversionPage } from "./meanReversionPage.js";
import { renderTimelinePage } from "./timelinePage.js";
import { evaluateMeanReversion } from "../strategy/meanReversion.js";

export interface ControlPlaneState {
  getHealth(): { ok: boolean; workers: unknown };
  getReady(): { ready: boolean; workersReady: number; workersTotal: number };
  getMetrics(): string;
  getSymbols(): string[];
  updateSymbols(symbols: string[]): void;
  updateThresholds(thresholds: ThresholdConfig): void;
}

function parseBody(res: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    res.onData((ab: ArrayBuffer, isLast: boolean) => {
      buffer = Buffer.concat([buffer, Buffer.from(ab)]);
      if (isLast) {
        resolve(buffer.toString("utf8"));
      }
    });
    res.onAborted(() => reject(new Error("request aborted")));
  });
}

function parseBoundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function parseBoundedNumber(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function parseEpochMs(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function parseQuery(req: any): URLSearchParams {
  const query = typeof req.getQuery === "function" ? req.getQuery() : "";
  return new URLSearchParams(query);
}

export async function startHttpServer(
  port: number,
  state: ControlPlaneState,
  spreadReadRepo: PostgresSpreadReadRepository
): Promise<void> {
  const uws: any = await import("uWebSockets.js");
  const app = uws.App();

  app.get("/", (res: any) => {
    res.writeStatus("302 Found").writeHeader("Location", "/timeline").end();
  });

  app.get("/timeline", (res: any) => {
    res.writeHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderTimelinePage());
  });

  app.get("/mean-reversion", (res: any) => {
    res.writeHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderMeanReversionPage());
  });

  app.get("/healthz", (res: any) => {
    res.writeHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state.getHealth()));
  });

  app.get("/readyz", (res: any) => {
    res.writeHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state.getReady()));
  });

  app.get("/metrics", (res: any) => {
    res.writeHeader("Content-Type", "text/plain; version=0.0.4");
    res.end(state.getMetrics());
  });

  app.get("/api/symbols", async (res: any) => {
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    try {
      const configured = state.getSymbols();
      const recent = await spreadReadRepo.listRecentSymbols(30);
      if (aborted) {
        return;
      }
      const symbols = [...new Set([...configured, ...recent])];
      res.writeHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ symbols }));
    } catch (error) {
      if (aborted) {
        return;
      }
      res.writeStatus("500 Internal Server Error").end(error instanceof Error ? error.message : "query failed");
    }
  });

  app.get("/api/spreads", async (res: any, req: any) => {
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    try {
      const query = parseQuery(req);
      const configured = state.getSymbols();
      const symbol = (query.get("symbol") ?? configured[0] ?? "").toUpperCase().trim();
      const exchangeA = (query.get("exchangeA") ?? "").trim().toLowerCase();
      const exchangeB = (query.get("exchangeB") ?? "").trim().toLowerCase();
      if (!symbol) {
        res.writeStatus("400 Bad Request").end("symbol is required");
        return;
      }

      const windowMin = parseBoundedInt(query.get("windowMin"), 60, 1, 1_440);
      const targetPoints = parseBoundedInt(query.get("limit"), 360, 10, 5_000);
      const toMs = parseEpochMs(query.get("toMs")) ?? Date.now();
      const fromMs = parseEpochMs(query.get("fromMs")) ?? toMs - windowMin * 60_000;
      if (fromMs >= toMs) {
        res.writeStatus("400 Bad Request").end("fromMs must be smaller than toMs");
        return;
      }
      const windowMs = toMs - fromMs;
      // Collapse high-frequency events into time buckets so the chart always spans the selected window.
      const bucketMs = Math.max(1_000, Math.ceil(windowMs / targetPoints));
      const queryLimit = Math.min(5_000, targetPoints + 2);

      const points = await spreadReadRepo.queryTimeline({
        symbol,
        fromMs,
        toMs,
        bucketMs,
        limit: queryLimit,
        exchangeA: exchangeA || undefined,
        exchangeB: exchangeB || undefined
      });
      if (aborted) {
        return;
      }

      const maxAbs = points.reduce((acc, point) => {
        const maxPoint = Math.max(Math.abs(point.bpsAToB), Math.abs(point.bpsBToA));
        return Math.max(acc, maxPoint);
      }, 0);
      const latest = points.length > 0 ? points[points.length - 1] : null;

      res.writeHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          symbol,
          exchangeA: exchangeA || null,
          exchangeB: exchangeB || null,
          fromMs,
          toMs,
          points,
          sampling: {
            bucketMs,
            targetPoints
          },
          stats: {
            count: points.length,
            maxAbs,
            latestAToB: latest?.bpsAToB ?? null,
            latestBToA: latest?.bpsBToA ?? null
          }
        })
      );
    } catch (error) {
      if (aborted) {
        return;
      }
      res.writeStatus("500 Internal Server Error").end(error instanceof Error ? error.message : "query failed");
    }
  });

  app.get("/api/mean-reversion", async (res: any, req: any) => {
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    try {
      const query = parseQuery(req);
      const configured = state.getSymbols();
      const symbol = (query.get("symbol") ?? configured[0] ?? "").toUpperCase().trim();
      const direction = (query.get("direction") ?? "a_to_b").toLowerCase();
      const exchangeA = (query.get("exchangeA") ?? "").trim().toLowerCase();
      const exchangeB = (query.get("exchangeB") ?? "").trim().toLowerCase();
      if (!symbol) {
        res.writeStatus("400 Bad Request").end("symbol is required");
        return;
      }
      if (direction !== "a_to_b" && direction !== "b_to_a") {
        res.writeStatus("400 Bad Request").end("direction must be a_to_b or b_to_a");
        return;
      }

      const windowMin = parseBoundedInt(query.get("windowMin"), 240, 30, 1_440);
      const targetPoints = parseBoundedInt(query.get("limit"), 480, 60, 2_000);
      const toMs = parseEpochMs(query.get("toMs")) ?? Date.now();
      const fromMs = parseEpochMs(query.get("fromMs")) ?? toMs - windowMin * 60_000;
      if (fromMs >= toMs) {
        res.writeStatus("400 Bad Request").end("fromMs must be smaller than toMs");
        return;
      }
      const windowMs = toMs - fromMs;
      const bucketMs = Math.max(1_000, Math.ceil(windowMs / targetPoints));
      const queryLimit = Math.min(3_000, targetPoints + 2);
      const timeline = await spreadReadRepo.queryTimeline({
        symbol,
        fromMs,
        toMs,
        bucketMs,
        limit: queryLimit,
        exchangeA: exchangeA || undefined,
        exchangeB: exchangeB || undefined
      });
      const points = timeline.map((point) => ({
        tsMs: point.tsIngest,
        value: direction === "a_to_b" ? point.bpsAToB : point.bpsBToA
      }));

      const result = evaluateMeanReversion(points, {
        lookbackBars: parseBoundedInt(query.get("lookbackBars"), 30, 10, 400),
        entryZ: parseBoundedNumber(query.get("entryZ"), 1.8, 0.2, 6),
        exitZ: parseBoundedNumber(query.get("exitZ"), 0.35, 0.05, 4),
        regimeLookbackBars: parseBoundedInt(query.get("regimeLookbackBars"), 24, 6, 200),
        minFlipRate: parseBoundedNumber(query.get("minFlipRate"), 0.12, 0, 1),
        maxTrendStrength: parseBoundedNumber(query.get("maxTrendStrength"), 0.45, 0, 1),
        maxHoldBars: parseBoundedInt(query.get("maxHoldBars"), 60, 2, 600)
      });

      if (aborted) {
        return;
      }

      res.writeHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          symbol,
          direction,
          exchangeA: exchangeA || null,
          exchangeB: exchangeB || null,
          fromMs,
          toMs,
          sampling: {
            bucketMs,
            targetPoints
          },
          params: {
            lookbackBars: parseBoundedInt(query.get("lookbackBars"), 30, 10, 400),
            entryZ: parseBoundedNumber(query.get("entryZ"), 1.8, 0.2, 6),
            exitZ: parseBoundedNumber(query.get("exitZ"), 0.35, 0.05, 4),
            regimeLookbackBars: parseBoundedInt(query.get("regimeLookbackBars"), 24, 6, 200),
            minFlipRate: parseBoundedNumber(query.get("minFlipRate"), 0.12, 0, 1),
            maxTrendStrength: parseBoundedNumber(query.get("maxTrendStrength"), 0.45, 0, 1),
            maxHoldBars: parseBoundedInt(query.get("maxHoldBars"), 60, 2, 600)
          },
          points: result.points,
          summary: result.summary,
          trades: result.trades
        })
      );
    } catch (error) {
      if (aborted) {
        return;
      }
      res.writeStatus("500 Internal Server Error").end(error instanceof Error ? error.message : "query failed");
    }
  });

  app.get("/api/exchange-pairs", async (res: any, req: any) => {
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });
    try {
      const query = parseQuery(req);
      const configured = state.getSymbols();
      const symbol = (query.get("symbol") ?? configured[0] ?? "").toUpperCase().trim();
      if (!symbol) {
        res.writeStatus("400 Bad Request").end("symbol is required");
        return;
      }
      const pairs = await spreadReadRepo.listRecentExchangePairs(symbol, 30, 20);
      if (aborted) {
        return;
      }
      res.writeHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ symbol, pairs }));
    } catch (error) {
      if (aborted) {
        return;
      }
      res.writeStatus("500 Internal Server Error").end(error instanceof Error ? error.message : "query failed");
    }
  });

  app.put("/config/symbols", async (res: any) => {
    try {
      const body = await parseBody(res);
      const parsed = JSON.parse(body) as { symbols: string[] };
      if (!Array.isArray(parsed.symbols) || parsed.symbols.length === 0) {
        res.writeStatus("400 Bad Request").end("invalid symbols");
        return;
      }
      const symbols = parsed.symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);
      state.updateSymbols(symbols);
      res.writeHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, symbols }));
    } catch (error) {
      res.writeStatus("400 Bad Request").end(error instanceof Error ? error.message : "invalid payload");
    }
  });

  app.put("/config/thresholds", async (res: any) => {
    try {
      const body = await parseBody(res);
      const parsed = JSON.parse(body) as { minBpsAbs: number };
      if (typeof parsed.minBpsAbs !== "number" || !Number.isFinite(parsed.minBpsAbs)) {
        res.writeStatus("400 Bad Request").end("invalid minBpsAbs");
        return;
      }
      state.updateThresholds({ minBpsAbs: parsed.minBpsAbs });
      res.writeHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, thresholds: parsed }));
    } catch (error) {
      res.writeStatus("400 Bad Request").end(error instanceof Error ? error.message : "invalid payload");
    }
  });

  await new Promise<void>((resolve, reject) => {
    app.listen("0.0.0.0", port, (token: unknown) => {
      if (!token) {
        reject(new Error(`failed to bind ${port}`));
        return;
      }
      resolve();
    });
  });
}
