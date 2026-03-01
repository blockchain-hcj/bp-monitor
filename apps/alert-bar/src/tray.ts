import { Tray, nativeImage } from "electron";
import path from "node:path";
import type { AlertSeverity } from "alert-sdk";

function iconNameForSeverity(severity: AlertSeverity | undefined): string {
  if (severity === "warn") {
    return "tray-warn.png";
  }
  if (severity === "error" || severity === "critical") {
    return "tray-crit.png";
  }
  return "tray-idle.png";
}

export class TrayController {
  constructor(private readonly assetsDir: string) {}

  update(tray: Tray, unread: number, maxSeverity: AlertSeverity | undefined): void {
    const iconName = iconNameForSeverity(maxSeverity);
    const iconPath = path.join(this.assetsDir, iconName);
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      tray.setImage(image);
    }
    tray.setToolTip(`Alert Bar (${unread} unread)`);
    const marker = maxSeverity === "warn" ? "🟡" : maxSeverity === "error" || maxSeverity === "critical" ? "🔴" : "";
    tray.setTitle(unread > 0 ? `${marker} ${unread}`.trim() : "");
  }

  initialIconPath(): string {
    return path.join(this.assetsDir, "tray-idle.png");
  }
}
