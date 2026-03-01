import http from "node:http";
import { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { AckedAlert } from "alert-sdk";

interface WsMessage {
  type: "snapshot" | "alert" | "ack";
  ts_ms: number;
  alerts?: AckedAlert[];
  alert?: AckedAlert;
}

export class HubWsServer {
  private readonly wss: WebSocketServer;

  constructor(
    private readonly wsPath: string,
    private readonly snapshotProvider: () => AckedAlert[]
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (socket) => {
      this.send(socket, {
        type: "snapshot",
        ts_ms: Date.now(),
        alerts: this.snapshotProvider()
      });
    });
  }

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`).pathname;
    if (pathname !== this.wsPath) {
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit("connection", ws, req);
    });
  }

  broadcastAlert(alert: AckedAlert): void {
    this.broadcast({
      type: "alert",
      ts_ms: Date.now(),
      alert
    });
  }

  broadcastAck(alert: AckedAlert): void {
    this.broadcast({
      type: "ack",
      ts_ms: Date.now(),
      alert
    });
  }

  async close(timeoutMs = 1_500): Promise<void> {
    // Terminate active clients first so HTTP shutdown does not wait forever.
    for (const client of this.wss.clients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), timeoutMs);
      timer.unref();
      this.wss.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private broadcast(payload: WsMessage): void {
    const raw = JSON.stringify(payload);
    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }
      client.send(raw);
    }
  }

  private send(client: WebSocket, payload: WsMessage): void {
    client.send(JSON.stringify(payload));
  }
}
