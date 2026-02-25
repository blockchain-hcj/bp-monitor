export function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[-_]/g, "");
}

export function toOkxInstId(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  if (!normalized.endsWith("USDT")) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }
  const base = normalized.slice(0, -4);
  return `${base}-USDT-SWAP`;
}

export function fromOkxInstId(instId: string): string {
  return normalizeSymbol(instId.replace("-SWAP", "").replace("-", ""));
}
