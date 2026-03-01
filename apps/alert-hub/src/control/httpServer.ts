import http from "node:http";
import type { AlertSeverity } from "alert-sdk";
import { AlertHubConfig } from "../config.js";
import { HubWsServer } from "../broadcast/wsServer.js";
import { parseAckBody, readJsonBody } from "../ingest/httpIngest.js";
import { AlertStore } from "../store/alertStore.js";

interface HttpServerDeps {
  config: AlertHubConfig;
  store: AlertStore;
  wsServer: HubWsServer;
  ingestPayload: (payload: unknown) => { alertId: string; deduped: boolean };
}

function writeJson(res: http.ServerResponse, code: number, body: unknown, corsOrigin: string): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", corsOrigin);
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.end(JSON.stringify(body));
}

function parseIntQuery(raw: string | null, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export function startHttpServer(deps: HttpServerDeps): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", deps.config.corsOrigin);
      res.setHeader("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      res.end();
      return;
    }

    if (method === "GET" && url.pathname === "/healthz") {
      writeJson(res, 200, { ok: true, ...deps.store.stats() }, deps.config.corsOrigin);
      return;
    }

    if (method === "POST" && url.pathname === "/alerts") {
      try {
        const payload = await readJsonBody(req);
        const result = deps.ingestPayload(payload);
        writeJson(
          res,
          result.deduped ? 200 : 202,
          {
            ok: true,
            id: result.alertId,
            deduped: result.deduped
          },
          deps.config.corsOrigin
        );
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }, deps.config.corsOrigin);
      }
      return;
    }

    if (method === "GET" && url.pathname === "/alerts") {
      const limit = parseIntQuery(url.searchParams.get("limit"), 100);
      const sinceMsRaw = url.searchParams.get("since_ms");
      const sinceMs = sinceMsRaw ? parseIntQuery(sinceMsRaw, 0) : undefined;
      const severityRaw = url.searchParams.get("severity");
      const severity = severityRaw && ["info", "warn", "error", "critical"].includes(severityRaw)
        ? (severityRaw as AlertSeverity)
        : undefined;
      const unacked = url.searchParams.get("unacked") === "true";
      const items = deps.store.list({ limit, sinceMs, severity, unacked });
      writeJson(
        res,
        200,
        {
          ok: true,
          count: items.length,
          stats: deps.store.stats(),
          items
        },
        deps.config.corsOrigin
      );
      return;
    }

    const ackMatch = url.pathname.match(/^\/alerts\/([^/]+)\/ack$/);
    if (method === "PUT" && ackMatch) {
      try {
        const body = parseAckBody(await readJsonBody(req));
        const id = decodeURIComponent(ackMatch[1] ?? "");
        const alert = deps.store.ack(id, body.by ?? "manual");
        if (!alert) {
          writeJson(res, 404, { ok: false, error: "alert not found" }, deps.config.corsOrigin);
          return;
        }
        deps.wsServer.broadcastAck(alert);
        writeJson(res, 200, { ok: true, item: alert }, deps.config.corsOrigin);
      } catch (error) {
        writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }, deps.config.corsOrigin);
      }
      return;
    }

    writeJson(res, 404, { ok: false, error: "not found" }, deps.config.corsOrigin);
  });

  server.on("upgrade", (req, socket, head) => {
    deps.wsServer.handleUpgrade(req, socket, head);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.config.port, deps.config.host, () => resolve(server));
  });
}
