import http from "node:http";
import { setSymbols, setThresholds } from "../config.js";
import { RuntimeConfig, StrategyThresholds } from "../types.js";
import { StateStore } from "../strategy/stateStore.js";
import { RiskGuard } from "../risk/guard.js";

interface HttpState {
  config: RuntimeConfig;
  store: StateStore;
  risk: RiskGuard;
  getHealth: () => { ready: boolean; lastEventAtMs: number; lastError?: string };
}

function writeJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startHttpServer(port: number, state: HttpState): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (method === "GET" && url.pathname === "/healthz") {
      writeJson(res, 200, state.getHealth());
      return;
    }

    if (method === "GET" && url.pathname === "/readyz") {
      writeJson(res, state.getHealth().ready ? 200 : 503, { ready: state.getHealth().ready });
      return;
    }

    if (method === "GET" && url.pathname === "/state") {
      writeJson(res, 200, {
        tradeMode: state.config.tradeMode,
        symbols: state.config.strategy.symbols,
        thresholds: state.config.strategy.thresholds,
        risk: state.risk.status(),
        store: state.store.snapshot(),
        health: state.getHealth()
      });
      return;
    }

    if (method === "PUT" && url.pathname === "/config/symbols") {
      try {
        const body = JSON.parse(await readBody(req)) as { symbols?: string[] };
        if (!Array.isArray(body.symbols)) {
          writeJson(res, 400, { error: "symbols must be an array" });
          return;
        }
        setSymbols(state.config, body.symbols);
        writeJson(res, 200, { symbols: state.config.strategy.symbols });
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (method === "PUT" && url.pathname === "/config/thresholds") {
      try {
        const body = JSON.parse(await readBody(req)) as { thresholds?: StrategyThresholds };
        if (!body.thresholds || typeof body.thresholds !== "object") {
          writeJson(res, 400, { error: "thresholds must be an object" });
          return;
        }
        setThresholds(state.config, body.thresholds);
        writeJson(res, 200, { thresholds: state.config.strategy.thresholds });
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (method === "PUT" && url.pathname === "/risk/mode") {
      try {
        const body = JSON.parse(await readBody(req)) as { mode?: "normal" | "close_only"; reason?: string };
        if (body.mode !== "normal" && body.mode !== "close_only") {
          writeJson(res, 400, { error: "mode must be normal|close_only" });
          return;
        }
        state.risk.setMode(body.mode, body.reason ?? "manual_update");
        writeJson(res, 200, state.risk.status());
      } catch (error) {
        writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    writeJson(res, 404, { error: "not found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}
