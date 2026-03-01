import WebSocket from "ws";
import type { AckedAlert } from "alert-sdk";

export interface WsEvent {
  type: "snapshot" | "alert" | "ack";
  alerts?: AckedAlert[];
  alert?: AckedAlert;
}

export class AlertWsClient {
  private socket: WebSocket | null = null;
  private disposed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly onEvent: (event: WsEvent) => void,
    private readonly onStatus: (status: "connecting" | "open" | "closed") => void,
    private readonly reconnectMs = 3000
  ) {}

  connect(): void {
    if (this.disposed) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.socket = ws;

    ws.on("open", () => {
      this.onStatus("open");
    });

    ws.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString("utf8")) as WsEvent;
        if (parsed.type === "snapshot" || parsed.type === "alert" || parsed.type === "ack") {
          this.onEvent(parsed);
        }
      } catch {
        // ignore malformed payloads
      }
    });

    ws.on("close", () => {
      this.onStatus("closed");
      this.socket = null;
      this.scheduleReconnect();
    });

    ws.on("error", () => {
      this.onStatus("closed");
      this.scheduleReconnect();
      if (this.socket) {
        this.socket.terminate();
        this.socket = null;
      }
    });
  }

  close(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
    this.reconnectTimer.unref();
  }
}
