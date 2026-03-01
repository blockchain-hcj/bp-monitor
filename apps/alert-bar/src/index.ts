import { app, ipcMain, Menu } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { menubar } from "menubar";
import type { AckedAlert, AlertSeverity } from "alert-sdk";
import { notifyHighSeverity } from "./notifications.js";
import { TrayController } from "./tray.js";
import { AlertWsClient, WsEvent } from "./wsClient.js";

function toWsUrl(hubHttpUrl: string): string {
  const url = new URL(hubHttpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

const HUB_HTTP_URL = process.env.ALERT_HUB_URL?.trim() || "http://127.0.0.1:18280";
const HUB_WS_URL = process.env.ALERT_HUB_WS_URL?.trim() || toWsUrl(HUB_HTTP_URL);
const MAX_ITEMS = 500;
const SYNC_INTERVAL_MS = 10_000;
const POPUP_ON_HIGH = (process.env.ALERT_BAR_POPUP_ON_HIGH ?? "true").trim().toLowerCase() !== "false";

interface UiPayload {
  wsStatus: "connecting" | "open" | "closed";
  unread: number;
  items: AckedAlert[];
}

async function main(): Promise<void> {
  await app.whenReady();

  const assetsDir = path.join(process.cwd(), "assets");
  const trayController = new TrayController(assetsDir);
  const itemsById = new Map<string, AckedAlert>();
  const notifiedIds = new Set<string>();
  let wsStatus: UiPayload["wsStatus"] = "closed";
  const startupMs = Date.now();
  let syncTimer: NodeJS.Timeout | null = null;

  const highestSeverity = (): AlertSeverity | undefined => {
    const priority: Record<AlertSeverity, number> = {
      info: 0,
      warn: 1,
      error: 2,
      critical: 3
    };
    let result: AlertSeverity | undefined;
    let score = -1;
    for (const item of itemsById.values()) {
      if (item.acked) {
        continue;
      }
      if (priority[item.severity] > score) {
        score = priority[item.severity];
        result = item.severity;
      }
    }
    return result;
  };

  const sortedItems = (): AckedAlert[] => {
    return [...itemsById.values()].sort((a, b) => b.ts_ms - a.ts_ms).slice(0, MAX_ITEMS);
  };

  const unreadCount = (): number => {
    let count = 0;
    for (const item of itemsById.values()) {
      if (!item.acked) {
        count += 1;
      }
    }
    return count;
  };

  const currentPayload = (): UiPayload => ({
    wsStatus,
    unread: unreadCount(),
    items: sortedItems()
  });

  const render = (): void => {
    const payload = currentPayload();

    trayController.update(mb.tray, payload.unread, highestSeverity());
    if (mb.window && !mb.window.isDestroyed()) {
      mb.window.webContents.send("alerts:update", payload);
    }
  };

  const maybeNotify = (alert: AckedAlert, source: "ws" | "sync"): void => {
    if (alert.acked) {
      return;
    }
    if (alert.severity !== "error" && alert.severity !== "critical") {
      return;
    }
    if (notifiedIds.has(alert.id)) {
      return;
    }
    // Avoid flooding historical alerts when app starts and performs initial sync.
    if (source === "sync" && alert.ts_ms < startupMs - 5_000) {
      return;
    }
    notifiedIds.add(alert.id);
    notifyHighSeverity(alert);
    if (POPUP_ON_HIGH && (alert.severity === "critical" || alert.severity === "error")) {
      mb.showWindow();
      app.focus({ steal: true });
    }
  };

  const upsert = (alert: AckedAlert, notifySource?: "ws" | "sync"): void => {
    const prev = itemsById.get(alert.id);
    const merged: AckedAlert = {
      ...prev,
      ...alert
    };
    itemsById.set(alert.id, merged);
    if (notifySource) {
      maybeNotify(merged, notifySource);
    }
    if (itemsById.size > MAX_ITEMS) {
      const oldest = [...itemsById.values()].sort((a, b) => a.ts_ms - b.ts_ms)[0];
      if (oldest) {
        itemsById.delete(oldest.id);
      }
    }
    render();
  };

  const onWsEvent = (event: WsEvent): void => {
    if (event.type === "snapshot") {
      itemsById.clear();
      for (const item of event.alerts ?? []) {
        itemsById.set(item.id, item);
      }
      render();
      return;
    }
    if (event.alert) {
      upsert(event.alert, event.type === "alert" ? "ws" : undefined);
    }
  };

  const onWsStatus = (status: UiPayload["wsStatus"]): void => {
    wsStatus = status;
    render();
  };

  const mb = menubar({
    index: (() => {
      const uiUrl = pathToFileURL(path.join(process.cwd(), "ui/index.html"));
      uiUrl.searchParams.set("hubUrl", HUB_HTTP_URL);
      return uiUrl.toString();
    })(),
    icon: trayController.initialIconPath(),
    browserWindow: {
      width: 380,
      height: 700,
      resizable: false,
      fullscreenable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    }
  });

  const wsClient = new AlertWsClient(HUB_WS_URL, onWsEvent, onWsStatus, 3000);

  const syncFromHub = async (notifyFresh: boolean): Promise<void> => {
    try {
      const res = await fetch(`${HUB_HTTP_URL}/alerts?limit=${MAX_ITEMS}`);
      if (!res.ok) {
        return;
      }
      const payload = (await res.json()) as { items?: AckedAlert[] };
      for (const item of payload.items ?? []) {
        upsert(item, notifyFresh ? "sync" : undefined);
      }
    } catch {
      // Ignore sync failures and rely on next retry.
    }
  };

  const ackAlert = async (id: string, by = "alert-bar"): Promise<{ ok: boolean; item?: AckedAlert; error?: string }> => {
    try {
      const res = await fetch(`${HUB_HTTP_URL}/alerts/${encodeURIComponent(id)}/ack`, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ by })
      });
      const payload = (await res.json()) as { item?: AckedAlert; error?: string };
      if (!res.ok) {
        return { ok: false, error: payload.error ?? `http_${res.status}` };
      }
      if (payload.item) {
        upsert(payload.item);
      }
      return { ok: true, item: payload.item };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const ackAllUnacked = async (): Promise<{ ok: boolean; acked: number; total: number }> => {
    const ids = sortedItems()
      .filter((item) => !item.acked)
      .map((item) => item.id);

    let acked = 0;
    for (const id of ids) {
      const result = await ackAlert(id, "alert-bar-bulk");
      if (result.ok) {
        acked += 1;
      }
    }
    return { ok: true, acked, total: ids.length };
  };

  ipcMain.handle("alerts:ack", async (_event, id: string) => {
    if (!id) {
      return { ok: false, error: "missing id" };
    }
    return ackAlert(id, "alert-bar");
  });

  ipcMain.handle("alerts:ack-all", async () => {
    return ackAllUnacked();
  });

  ipcMain.handle("alerts:sync-now", async () => {
    await syncFromHub(true);
    return { ok: true };
  });

  ipcMain.handle("alerts:get-state", async () => {
    return currentPayload();
  });

  mb.on("ready", () => {
    mb.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Open Panel",
          click: () => mb.showWindow()
        },
        {
          label: "Sync Now",
          click: () => {
            void syncFromHub(true);
          }
        },
        {
          label: "Acknowledge All",
          click: () => {
            void ackAllUnacked();
          }
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => app.quit()
        }
      ])
    );

    wsClient.connect();
    void syncFromHub(false);
    syncTimer = setInterval(() => {
      void syncFromHub(true);
    }, SYNC_INTERVAL_MS);
    syncTimer.unref();
    render();
  });

  mb.on("after-create-window", () => {
    render();
  });

  app.on("before-quit", () => {
    wsClient.close();
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
