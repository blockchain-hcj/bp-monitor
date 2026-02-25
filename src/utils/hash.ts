export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return hash >>> 0;
}

export function assignSymbols(symbols: string[], shards: number, shardId: number): string[] {
  return symbols.filter((symbol) => fnv1a(symbol) % shards === shardId);
}
