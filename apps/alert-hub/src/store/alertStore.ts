import type { AckedAlert, Alert, AlertSeverity } from "alert-sdk";

export interface ListAlertOptions {
  limit?: number;
  sinceMs?: number;
  severity?: AlertSeverity;
  unacked?: boolean;
}

export interface AlertStoreStats {
  total: number;
  unacked: number;
}

export class AlertStore {
  private readonly byId = new Map<string, AckedAlert>();
  private readonly order: string[] = [];

  constructor(private readonly capacity: number) {}

  upsert(alert: Alert): { alert: AckedAlert; isNew: boolean } {
    const existing = this.byId.get(alert.id);
    if (existing) {
      return { alert: existing, isNew: false };
    }

    if (this.order.length >= this.capacity) {
      const dropId = this.order.shift();
      if (dropId) {
        this.byId.delete(dropId);
      }
    }

    const stored: AckedAlert = {
      ...alert,
      acked: false
    };

    this.byId.set(stored.id, stored);
    this.order.push(stored.id);
    return { alert: stored, isNew: true };
  }

  ack(id: string, by = "manual"): AckedAlert | undefined {
    const existing = this.byId.get(id);
    if (!existing) {
      return undefined;
    }
    if (existing.acked) {
      return existing;
    }

    const ackTsMs = Date.now();
    const next: AckedAlert = {
      ...existing,
      acked: true,
      ack_ts: new Date(ackTsMs).toISOString(),
      ack_ts_ms: ackTsMs,
      acked_by: by
    };
    this.byId.set(id, next);
    return next;
  }

  list(options: ListAlertOptions = {}): AckedAlert[] {
    const limit = Math.max(1, options.limit ?? 100);
    const out: AckedAlert[] = [];

    for (let i = this.order.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const id = this.order[i];
      const alert = this.byId.get(id);
      if (!alert) {
        continue;
      }
      if (options.sinceMs && alert.ts_ms < options.sinceMs) {
        continue;
      }
      if (options.severity && alert.severity !== options.severity) {
        continue;
      }
      if (options.unacked && alert.acked) {
        continue;
      }
      out.push(alert);
    }

    return out;
  }

  stats(): AlertStoreStats {
    let unacked = 0;
    for (const alert of this.byId.values()) {
      if (!alert.acked) {
        unacked += 1;
      }
    }
    return {
      total: this.byId.size,
      unacked
    };
  }
}
