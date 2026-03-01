import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { Alert, AlertSeverity } from "alert-sdk";

const SEVERITIES = new Set<AlertSeverity>(["info", "warn", "error", "critical"]);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("payload must be an object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim();
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function parseSeverity(raw: string): AlertSeverity {
  if (!SEVERITIES.has(raw as AlertSeverity)) {
    throw new Error("severity must be info|warn|error|critical");
  }
  return raw as AlertSeverity;
}

export async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

export function normalizeAlertPayload(raw: unknown): Alert {
  const payload = asRecord(raw);
  const title = asString(payload.title);
  if (!title) {
    throw new Error("title is required");
  }

  const source = asString(payload.source, "unknown") || "unknown";
  const severity = parseSeverity(asString(payload.severity, "info"));
  const tsMs = asNumber(payload.ts_ms) ?? Date.now();
  const body = asString(payload.body);
  const group = asString(payload.group);
  const ts = asString(payload.ts) || new Date(tsMs).toISOString();

  const metaRaw = payload.meta;
  const meta = metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw) ? (metaRaw as Record<string, unknown>) : undefined;

  return {
    id: asString(payload.id) || randomUUID(),
    ts,
    ts_ms: tsMs,
    severity,
    source,
    title,
    body: body || undefined,
    group: group || undefined,
    meta
  };
}

export function parseAckBody(raw: unknown): { by?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const by = asString(record.by);
  return by ? { by } : {};
}
