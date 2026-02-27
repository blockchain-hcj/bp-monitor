export function formatErrorDetails(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err !== "object" || err === null) return String(err);

  const parts: string[] = [];
  const seen = new Set<object>();
  let cur: unknown = err;
  let depth = 0;

  while (cur && typeof cur === "object" && depth < 5) {
    if (seen.has(cur)) break;
    seen.add(cur);

    const rec = cur as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      errno?: unknown;
      syscall?: unknown;
      address?: unknown;
      port?: unknown;
      cause?: unknown;
    };

    const segment: string[] = [];
    const name = typeof rec.name === "string" && rec.name ? rec.name : "Error";
    const message = typeof rec.message === "string" ? rec.message : "";

    segment.push(message ? `${name}: ${message}` : name);
    if (typeof rec.code === "string" || typeof rec.code === "number") segment.push(`code=${String(rec.code)}`);
    if (typeof rec.errno === "number") segment.push(`errno=${String(rec.errno)}`);
    if (typeof rec.syscall === "string") segment.push(`syscall=${rec.syscall}`);
    if (typeof rec.address === "string") segment.push(`address=${rec.address}`);
    if (typeof rec.port === "number") segment.push(`port=${String(rec.port)}`);

    parts.push(segment.join(" "));
    cur = rec.cause;
    depth += 1;
  }

  if (parts.length === 0) return String(err);
  return parts.join(" <- caused by ");
}

export async function fetchWithContext(
  url: string,
  init: RequestInit | undefined,
  context: string
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new Error(`${context} network error: ${formatErrorDetails(err)}`, {
      cause: err,
    });
  }
}
