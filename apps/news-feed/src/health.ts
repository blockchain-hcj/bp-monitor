import http from "node:http";
import { DataSourceHealth } from "./types.js";

interface HealthServerDeps {
  host: string;
  port: number;
  startedAtMs: number;
  getSourcesHealth: () => DataSourceHealth[];
}

function writeJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function startHealthServer(deps: HealthServerDeps): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (method === "GET" && url.pathname === "/healthz") {
      const sources = deps.getSourcesHealth();
      const allConnected = sources.every((item) => item.connected);
      writeJson(res, allConnected ? 200 : 503, {
        ok: allConnected,
        ts_ms: Date.now(),
        uptime_ms: Date.now() - deps.startedAtMs,
        source_count: sources.length,
        sources
      });
      return;
    }

    writeJson(res, 404, { ok: false, error: "not found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.port, deps.host, () => resolve(server));
  });
}
