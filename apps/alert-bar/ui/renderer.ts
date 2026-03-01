declare const require: NodeRequire | undefined;

type AlertSeverity = "info" | "warn" | "error" | "critical";

interface AlertItem {
  id: string;
  ts: string;
  ts_ms: number;
  severity: AlertSeverity;
  source: string;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
  group?: string;
  acked?: boolean;
}

interface UiPayload {
  wsStatus: "connecting" | "open" | "closed";
  unread: number;
  items: AlertItem[];
}

type IpcLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
};

function getIpcRenderer(): IpcLike | null {
  try {
    if (typeof require !== "function") {
      return null;
    }
    const electron = require("electron") as { ipcRenderer?: IpcLike };
    return electron.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

const ipcRenderer = getIpcRenderer();
const hubUrl = new URLSearchParams(window.location.search).get("hubUrl") ?? "http://127.0.0.1:18280";

const wsStatusEl = document.getElementById("ws-status") as HTMLParagraphElement;
const unreadEl = document.getElementById("unread-count") as HTMLSpanElement;
const listEl = document.getElementById("alert-list") as HTMLUListElement;
const refreshBtn = document.getElementById("btn-refresh") as HTMLButtonElement;
const ackAllBtn = document.getElementById("btn-ack-all") as HTMLButtonElement;
const keyListEl = document.getElementById("key-alert-list") as HTMLUListElement;
const detailPanelEl = document.getElementById("detail-panel") as HTMLDivElement;
const sumTotalEl = document.getElementById("sum-total") as HTMLParagraphElement;
const sumWarnEl = document.getElementById("sum-warn") as HTMLParagraphElement;
const sumErrorEl = document.getElementById("sum-error") as HTMLParagraphElement;
const sumCriticalEl = document.getElementById("sum-critical") as HTMLParagraphElement;
let selectedAlertId: string | null = null;
let lastTopAlertId: string | null = null;

function toTimeLabel(tsMs: number): string {
  return new Date(tsMs).toLocaleString();
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function computeSummary(items: AlertItem[]): { total: number; warn: number; error: number; critical: number } {
  const since = Date.now() - 60 * 60_000;
  let total = 0;
  let warn = 0;
  let error = 0;
  let critical = 0;
  for (const item of items) {
    if (item.ts_ms < since) {
      continue;
    }
    total += 1;
    if (item.severity === "warn") {
      warn += 1;
    } else if (item.severity === "error") {
      error += 1;
    } else if (item.severity === "critical") {
      critical += 1;
    }
  }
  return { total, warn, error, critical };
}

function keyItems(items: AlertItem[]): AlertItem[] {
  const recent = items.filter((item) => item.ts_ms >= Date.now() - 6 * 60 * 60_000);
  const high = recent.filter((item) => item.severity === "critical" || item.severity === "error");
  if (high.length > 0) {
    return high.slice(0, 6);
  }
  return recent.filter((item) => item.severity === "warn").slice(0, 6);
}

function itemToHtml(item: AlertItem): string {
  const title = escapeHtml(item.title);
  const source = escapeHtml(item.source);
  const body = item.body ? `<div class="alert-body">${escapeHtml(item.body)}</div>` : "";
  const metaJson =
    item.meta && Object.keys(item.meta).length > 0
      ? `<div class="alert-meta">${escapeHtml(JSON.stringify(item.meta, null, 2))}</div>`
      : "";
  const detailRows = `
    <div class="alert-detail-row">id: ${escapeHtml(item.id)}</div>
    <div class="alert-detail-row">time: ${escapeHtml(toTimeLabel(item.ts_ms))}</div>
    <div class="alert-detail-row">group: ${escapeHtml(item.group ?? "-")}</div>
  `;
  const ackButton = item.acked
    ? "<button class=\"ack-btn\" disabled>ACKED</button>"
    : `<button class=\"ack-btn\" data-id=\"${item.id}\">ACK</button>`;
  const selectedClass = selectedAlertId === item.id ? " selected" : "";

  return `
<li class="alert-item${selectedClass}" data-severity="${item.severity}" data-item-id="${item.id}">
  <div class="alert-top">
    <div>
      <div class="alert-title">${title}</div>
      <div class="alert-source">${source} · ${item.severity}</div>
    </div>
  </div>
  ${body}
  <div class="alert-detail-block">
    ${detailRows}
    ${metaJson}
  </div>
  <div class="alert-footer">
    <span class="alert-time">${toTimeLabel(item.ts_ms)}</span>
    ${ackButton}
  </div>
</li>
`;
}

function keyItemToHtml(item: AlertItem): string {
  return `
<li class="key-item" data-severity="${item.severity}">
  <div>${escapeHtml(item.title)}</div>
  <div class="muted">${escapeHtml(item.source)} · ${toTimeLabel(item.ts_ms)}</div>
</li>
`;
}

function render(payload: UiPayload): void {
  wsStatusEl.textContent = `ws: ${payload.wsStatus}`;
  unreadEl.textContent = String(payload.unread);
  const summary = computeSummary(payload.items);
  sumTotalEl.textContent = String(summary.total);
  sumWarnEl.textContent = String(summary.warn);
  sumErrorEl.textContent = String(summary.error);
  sumCriticalEl.textContent = String(summary.critical);
  keyListEl.innerHTML = keyItems(payload.items).map(keyItemToHtml).join("") || `<li class="key-item">No key alerts</li>`;

  const topId = payload.items[0]?.id ?? null;
  if (topId && topId !== lastTopAlertId) {
    selectedAlertId = topId;
    lastTopAlertId = topId;
  }
  if (!selectedAlertId || !payload.items.find((v) => v.id === selectedAlertId)) {
    selectedAlertId = payload.items[0]?.id ?? null;
  }

  listEl.innerHTML = payload.items.map(itemToHtml).join("");

  const selected = payload.items.find((v) => v.id === selectedAlertId);
  if (!selected) {
    detailPanelEl.innerHTML = `<p class="muted">Select an alert to view details</p>`;
  } else {
    const metaJson =
      selected.meta && Object.keys(selected.meta).length > 0
        ? `<div class="detail-json">${escapeHtml(JSON.stringify(selected.meta, null, 2))}</div>`
        : "";
    detailPanelEl.innerHTML = `
      <p class="detail-title">${escapeHtml(selected.title)}</p>
      <div class="detail-row">Source: ${escapeHtml(selected.source)}</div>
      <div class="detail-row">Severity: ${selected.severity}</div>
      <div class="detail-row">Time: ${escapeHtml(toTimeLabel(selected.ts_ms))}</div>
      <div class="detail-row">Body: ${escapeHtml(selected.body ?? "-")}</div>
      <div class="detail-row">Group: ${escapeHtml(selected.group ?? "-")}</div>
      ${metaJson}
    `;
  }

  listEl.querySelectorAll<HTMLButtonElement>("button.ack-btn[data-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      if (!id) {
        return;
      }
      button.disabled = true;
      button.textContent = "...";

      let ok = false;
      if (ipcRenderer) {
        const result = (await ipcRenderer.invoke("alerts:ack", id)) as { ok: boolean; error?: string };
        ok = !!result.ok;
      } else {
        const res = await fetch(`${hubUrl}/alerts/${encodeURIComponent(id)}/ack`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ by: "alert-bar-ui" })
        });
        ok = res.ok;
      }

      if (!ok) {
        button.disabled = false;
        button.textContent = "ACK";
      }
    });
  });

  listEl.querySelectorAll<HTMLLIElement>("li.alert-item[data-item-id]").forEach((itemEl) => {
    itemEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("button.ack-btn")) {
        return;
      }
      const id = itemEl.dataset.itemId;
      if (!id) {
        return;
      }
      selectedAlertId = id;
      render(payload);
    });
  });
}

async function fetchHubSnapshot(): Promise<void> {
  try {
    const res = await fetch(`${hubUrl}/alerts?limit=500`);
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as { items?: AlertItem[] };
    render({
      wsStatus: ipcRenderer ? "open" : "closed",
      unread: (data.items ?? []).filter((v) => !v.acked).length,
      items: data.items ?? []
    });
  } catch {
    // ignore
  }
}

if (ipcRenderer) {
  ipcRenderer.on("alerts:update", (...args: unknown[]) => {
    const payload = args[1] as UiPayload | undefined;
    if (!payload || typeof payload !== "object") {
      return;
    }
    render(payload);
  });

  void (async () => {
    try {
      const payload = (await ipcRenderer.invoke("alerts:get-state")) as UiPayload;
      render(payload);
    } catch {
      await fetchHubSnapshot();
    }
  })();
} else {
  wsStatusEl.textContent = "ws: renderer-http-fallback";
  void fetchHubSnapshot();
}

setInterval(() => {
  void fetchHubSnapshot();
}, 3000);

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  const prevText = refreshBtn.textContent;
  refreshBtn.textContent = "Refreshing...";
  if (ipcRenderer) {
    await ipcRenderer.invoke("alerts:sync-now");
  }
  await fetchHubSnapshot();
  refreshBtn.textContent = prevText;
  refreshBtn.disabled = false;
});

ackAllBtn.addEventListener("click", async () => {
  ackAllBtn.disabled = true;
  const prevText = ackAllBtn.textContent;
  ackAllBtn.textContent = "ACK...";

  if (ipcRenderer) {
    await ipcRenderer.invoke("alerts:ack-all");
  } else {
    const res = await fetch(`${hubUrl}/alerts?limit=500`);
    if (res.ok) {
      const data = (await res.json()) as { items?: AlertItem[] };
      for (const item of data.items ?? []) {
        if (item.acked) {
          continue;
        }
        await fetch(`${hubUrl}/alerts/${encodeURIComponent(item.id)}/ack`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ by: "alert-bar-ui-bulk" })
        });
      }
    }
  }

  await fetchHubSnapshot();
  ackAllBtn.textContent = prevText;
  ackAllBtn.disabled = false;
});
