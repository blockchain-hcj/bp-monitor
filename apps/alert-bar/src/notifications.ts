import { Notification } from "electron";
import type { AckedAlert } from "alert-sdk";

function shouldNotify(alert: AckedAlert): boolean {
  return alert.severity === "error" || alert.severity === "critical";
}

export function notifyHighSeverity(alert: AckedAlert): void {
  if (!shouldNotify(alert) || !Notification.isSupported()) {
    return;
  }

  const bodyParts: string[] = [];
  if (alert.body?.trim()) {
    bodyParts.push(alert.body.trim());
  }
  if (alert.group?.trim()) {
    bodyParts.push(`group=${alert.group.trim()}`);
  }
  if (alert.meta && Object.keys(alert.meta).length > 0) {
    bodyParts.push(`meta=${JSON.stringify(alert.meta)}`);
  }
  const body = bodyParts.join(" | ") || `source=${alert.source}`;
  const title = `[${alert.source}] ${alert.title}`;
  const subtitle = `${alert.severity.toUpperCase()} · ${new Date(alert.ts_ms).toLocaleTimeString()}`;
  const notification = new Notification({
    title,
    subtitle,
    body,
    silent: false
  });
  notification.show();
}
