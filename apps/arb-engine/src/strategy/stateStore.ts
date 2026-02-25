import { Direction, PositionState, RiskMode } from "../types.js";

function key(symbol: string, direction: Direction): string {
  return `${symbol}:${direction}`;
}

export class StateStore {
  private readonly positions = new Map<string, PositionState>();
  private riskMode: RiskMode = "normal";
  private lastSignal: Record<string, unknown> | null = null;

  getPosition(symbol: string, direction: Direction): PositionState {
    return (
      this.positions.get(key(symbol, direction)) ?? {
        symbol,
        direction,
        isOpen: false
      }
    );
  }

  setOpen(symbol: string, direction: Direction, netBps: number, reason: string): void {
    this.positions.set(key(symbol, direction), {
      symbol,
      direction,
      isOpen: true,
      openedAtMs: Date.now(),
      lastNetBps: netBps,
      reason
    });
  }

  setFlat(symbol: string, direction: Direction, reason: string): void {
    this.positions.set(key(symbol, direction), {
      symbol,
      direction,
      isOpen: false,
      lastNetBps: undefined,
      reason
    });
  }

  setRiskMode(mode: RiskMode): void {
    this.riskMode = mode;
  }

  getRiskMode(): RiskMode {
    return this.riskMode;
  }

  setLastSignal(signal: Record<string, unknown> | null): void {
    this.lastSignal = signal;
  }

  snapshot(): { riskMode: RiskMode; positions: PositionState[]; lastSignal: Record<string, unknown> | null } {
    return {
      riskMode: this.riskMode,
      positions: [...this.positions.values()],
      lastSignal: this.lastSignal
    };
  }
}
