import { ArbInputEvent, ExecutionIntent } from "../types.js";
import { StateStore } from "../strategy/stateStore.js";

export class RiskGuard {
  private lastReason: string | undefined;

  constructor(private readonly state: StateStore) {}

  onEvent(event: ArbInputEvent): void {
    if (event.quality_flag.length > 0) {
      this.state.setRiskMode("close_only");
      this.lastReason = `quality_flag=${event.quality_flag.join(",")}`;
    }
  }

  onExecutionFailure(intent: ExecutionIntent, reason: string): void {
    if (intent.action === "open") {
      this.state.setRiskMode("close_only");
      this.lastReason = `open_failed:${reason}`;
    }
  }

  setMode(mode: "normal" | "close_only", reason: string): void {
    this.state.setRiskMode(mode);
    this.lastReason = reason;
  }

  status(): { mode: "normal" | "close_only"; reason?: string } {
    return {
      mode: this.state.getRiskMode(),
      reason: this.lastReason
    };
  }
}
