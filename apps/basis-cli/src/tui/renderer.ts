import { AppState, CliConfig, ExchangePosition, LegOrderState, PriceSnapshot, SessionState } from "../types.js";
import { SpreadSubscriber } from "../nats/spreadSubscriber.js";

const ESC = "\x1b";
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const WHITE = `${ESC}[37m`;
const BG_RED = `${ESC}[41m`;
const BG_CYAN = `${ESC}[46m`;
const BLACK = `${ESC}[30m`;

const MIN_RENDER_INTERVAL_MS = 50; // 20fps

export class Renderer {
  private lastRenderMs = 0;
  private pendingRender = false;

  constructor(
    private readonly config: CliConfig,
    private readonly getSnapshot: () => PriceSnapshot | null,
    private readonly getSessionState: () => SessionState,
    private readonly getAppState: () => AppState,
    private readonly subscriber?: SpreadSubscriber
  ) {}

  scheduleRender() {
    const now = Date.now();
    const elapsed = now - this.lastRenderMs;
    if (elapsed >= MIN_RENDER_INTERVAL_MS) {
      this.render();
    } else if (!this.pendingRender) {
      this.pendingRender = true;
      setTimeout(() => {
        this.pendingRender = false;
        this.render();
      }, MIN_RENDER_INTERVAL_MS - elapsed);
    }
  }

  render() {
    this.lastRenderMs = Date.now();
    const appState = this.getAppState();

    if (appState.screen === "SYMBOL_SELECT") {
      this.renderSymbolSelect(appState);
    } else {
      this.renderDashboard(appState);
    }
  }

  private renderSymbolSelect(appState: AppState) {
    const lines: string[] = [];
    const cols = process.stdout.columns || 60;
    const hr = "─".repeat(cols);

    // Header
    lines.push(
      `${BOLD}${CYAN}  BASIS CLI${RESET}  │  Select Symbol  │  ${this.config.mode.toUpperCase()}  │  ${ts(Date.now())}`
    );
    lines.push(hr);

    // Search box
    const cursor = appState.searchInput.length > 0 ? appState.searchInput : "";
    lines.push(`  ${BOLD}Search:${RESET} ${cursor}${DIM}_${RESET}    ${DIM}(${appState.filteredSymbols.length}/${appState.symbolList.length} symbols)${RESET}`);
    lines.push(hr);

    // Filtered symbol list (show max 20 visible)
    const filtered = appState.filteredSymbols;
    const maxVisible = 20;
    let startIdx = 0;
    if (filtered.length > maxVisible) {
      startIdx = Math.max(0, appState.selectedIndex - Math.floor(maxVisible / 2));
      startIdx = Math.min(startIdx, filtered.length - maxVisible);
    }
    const endIdx = Math.min(startIdx + maxVisible, filtered.length);

    if (startIdx > 0) lines.push(`  ${DIM}  ... ${startIdx} more above${RESET}`);
    for (let i = startIdx; i < endIdx; i++) {
      const sym = filtered[i];
      if (i === appState.selectedIndex) {
        lines.push(`  ${BG_CYAN}${BLACK} > ${sym} ${RESET}`);
      } else {
        lines.push(`    ${sym}`);
      }
    }
    if (endIdx < filtered.length) lines.push(`  ${DIM}  ... ${filtered.length - endIdx} more below${RESET}`);
    if (filtered.length === 0) {
      if (appState.symbolList.length === 0) {
        lines.push(`  ${DIM}Discovering symbols from NATS...${RESET}`);
      } else {
        lines.push(`  ${DIM}No symbols match "${appState.searchInput}"${RESET}`);
      }
    }

    lines.push(hr);

    // Controls
    lines.push(
      `  ${BOLD}[↑/↓]${RESET} Navigate  ${BOLD}[Enter]${RESET} Select  ${BOLD}[Type]${RESET} Search  ${BOLD}[Bksp]${RESET} Clear  ${BOLD}[Q]${RESET} Quit`
    );

    process.stdout.write(CLEAR_SCREEN + lines.join("\n") + "\n");
  }

  private renderDashboard(appState: AppState) {
    const snap = this.getSnapshot();
    const state = this.getSessionState();
    const lines: string[] = [];
    const cols = process.stdout.columns || 60;
    const hr = "─".repeat(cols);

    // Header with dynamic params
    const slipLabel = appState.editingSlippage
      ? `${BG_RED}${WHITE} EDITING SLIPPAGE: ${appState.slippageInput}_ ${RESET}`
      : `slip: ${appState.slippageBps} bps`;

    lines.push(
      `${BOLD}${CYAN}  BASIS CLI${RESET}  │  ${BOLD}${appState.symbol}${RESET}  │  ${dirLabel(appState.direction)}  │  qty: ${appState.quantity}  │  ${slipLabel}  │  ${this.config.mode.toUpperCase()}  │  ${ts(Date.now())}`
    );

    // Status badges
    const badges: string[] = [];
    if (!state.natsConnected) badges.push(`${BG_RED}${WHITE} DISCONNECTED ${RESET}`);
    if (snap) {
      const srcLagMs = Math.max(0, Date.now() - snap.tsMs);
      const recvLagMs = Math.max(0, Date.now() - snap.tsRecvMs);
      if (srcLagMs > 3000) {
        badges.push(`${BG_RED}${WHITE} STALE src:${fmtLag(srcLagMs)} ${RESET}`);
      } else if (srcLagMs > 1000) {
        badges.push(`${YELLOW}src lag: ${fmtLag(srcLagMs)}${RESET}`);
      } else {
        badges.push(`${DIM}src lag: ${fmtLag(srcLagMs)}${RESET}`);
      }
      badges.push(`${DIM}recv lag: ${fmtLag(recvLagMs)}${RESET}`);
    } else if (state.priceStale) {
      badges.push(`${YELLOW} NO DATA ${RESET}`);
    }
    // Debug: NATS message counters
    if (this.subscriber) {
      badges.push(`${DIM}nats: ${this.subscriber.msgTotal} total / ${this.subscriber.msgMatched} matched (${this.subscriber.msgSnapshotOk} ok ${this.subscriber.msgSnapshotNull} null) / ${this.subscriber.msgParseFail} fail / msg ${this.subscriber.matchedPerSec.toFixed(1)}/s / chg ${this.subscriber.changedPerSec.toFixed(1)}/s${RESET}`);
      if (this.subscriber.priceSubject) {
        badges.push(`${DIM}sub: ${this.subscriber.priceSubject}${RESET}`);
      }
    }
    if (badges.length > 0) lines.push("  " + badges.join("  "));

    lines.push(hr);

    // Prices
    if (snap) {
      lines.push(
        `  ${BOLD}BINANCE${RESET}  Bid: ${fmt(snap.binanceBid)}  Ask: ${fmt(snap.binanceAsk)}`
      );
      lines.push(
        `  ${BOLD}OKX${RESET}      Bid: ${fmt(snap.okxBid)}  Ask: ${fmt(snap.okxAsk)}`
      );
      lines.push(hr);

      // Basis
      const bpsBnOkx = snap.bpsBinanceToOkx;
      const bpsOkxBn = snap.bpsOkxToBinance;
      const activeBps = appState.direction === "binance_to_okx" ? bpsBnOkx : bpsOkxBn;
      const netBps = activeBps - this.config.feeBps;
      const bpsColor = netBps > 0 ? GREEN : netBps < -2 ? RED : YELLOW;

      lines.push(
        `  ${BOLD}BASIS:${RESET} ${fmtBps(activeBps)} bps (${dirLabel(appState.direction)})  │  ${bpsColor}NET: ${fmtBps(netBps)} bps (after ${this.config.feeBps} bps fees)${RESET}`
      );
    } else {
      lines.push(`  ${DIM}Waiting for price data...${RESET}`);
    }
    lines.push(hr);

    // Positions (always show, independent of orders)
    lines.push(`  ${BOLD}POSITIONS${RESET}`);
    lines.push(`  ${formatPositionLine("BINANCE", appState.binancePosition)}`);
    lines.push(`  ${formatPositionLine("OKX", appState.okxPosition)}`);
    lines.push(hr);

    // Orders
    lines.push(`  ${BOLD}ORDERS${RESET}`);
    if (state.binanceLeg) {
      lines.push("  " + formatLeg(state.binanceLeg));
    }
    if (state.okxLeg) {
      lines.push("  " + formatLeg(state.okxLeg));
    }
    if (!state.binanceLeg && !state.okxLeg) {
      lines.push(`  ${DIM}No active orders${RESET}`);
    }
    lines.push(hr);

    // Logs (last 6)
    lines.push(`  ${BOLD}LOG${RESET}`);
    const recentLogs = state.logs.slice(-6);
    for (const entry of recentLogs) {
      lines.push(`  ${DIM}${ts(entry.tsMs)}${RESET} ${entry.text}`);
    }
    if (recentLogs.length === 0) {
      lines.push(`  ${DIM}No log entries${RESET}`);
    }
    lines.push(hr);

    // Controls — context-sensitive
    const phaseLabel = state.phase === "IDLE"
      ? `${GREEN}IDLE${RESET}`
      : state.phase === "MONITORING"
      ? `${YELLOW}MONITORING${RESET}`
      : state.phase === "PLACING"
      ? `${YELLOW}PLACING...${RESET}`
      : state.phase === "FILLED"
      ? `${GREEN}FILLED${RESET}`
      : state.phase === "CANCELLED"
      ? `${RED}CANCELLED${RESET}`
      : `${RED}${state.phase}${RESET}`;

    if (appState.editingSlippage) {
      // Slippage edit mode — show only relevant keys
      lines.push(
        `  ${BG_RED}${WHITE} SLIPPAGE EDIT ${RESET}  │  Type number → ${BOLD}[Enter]${RESET} Confirm  ${BOLD}[Esc]${RESET} Cancel`
      );
    } else if (state.phase === "IDLE") {
      lines.push(
        `  ${phaseLabel}  │  ${BOLD}[Enter]${RESET} Execute  ${BOLD}[D]${RESET} Direction  ${BOLD}[+/-]${RESET} Qty  ${BOLD}[S]${RESET} Slippage  ${BOLD}[B]${RESET} Back  ${BOLD}[Q]${RESET} Quit`
      );
    } else {
      lines.push(
        `  ${phaseLabel}  │  ${BOLD}[R]${RESET} Amend  ${BOLD}[C]${RESET} Cancel  ${BOLD}[Q]${RESET} Quit`
      );
    }

    process.stdout.write(CLEAR_SCREEN + lines.join("\n") + "\n");
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  let decimals = 2;
  if (abs < 0.01) decimals = 8;
  else if (abs < 0.1) decimals = 6;
  else if (abs < 1) decimals = 5;
  else if (abs < 1000) decimals = 4;
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

function fmtBps(n: number): string {
  return n.toFixed(2);
}

function ts(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function dirLabel(d: string): string {
  return d === "binance_to_okx" ? "bn→okx" : "okx→bn";
}

function fmtLag(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtPosition(pos: ExchangePosition | null): { long: string; short: string } {
  if (!pos) return { long: "-.--", short: "-.--" };
  return {
    long: pos.longNotionalUsdt.toFixed(2),
    short: pos.shortNotionalUsdt.toFixed(2),
  };
}

function formatPositionLine(exchange: string, pos: ExchangePosition | null): string {
  const p = fmtPosition(pos);
  if (!pos) {
    return `${BOLD}${exchange}${RESET}  ${DIM}loading...${RESET}`;
  }
  const net = pos.longNotionalUsdt - pos.shortNotionalUsdt;
  const side = net > 0 ? "NET LONG" : net < 0 ? "NET SHORT" : "NET FLAT";
  const longAvg = pos.longQty > 0 ? fmt(pos.longAvgEntryPrice) : "-";
  const shortAvg = pos.shortQty > 0 ? fmt(pos.shortAvgEntryPrice) : "-";
  return `${BOLD}${exchange}${RESET}  Long: $${p.long} @${longAvg}  Short: $${p.short} @${shortAvg}  │  ${side} $${Math.abs(net).toFixed(2)}`;
}

function formatLeg(leg: LegOrderState): string {
  const side = leg.side.toUpperCase().padEnd(4);
  const exch = leg.exchange === "binance" ? "BN " : "OKX";
  const statusColor =
    leg.status === "filled" ? GREEN :
    leg.status === "canceled" || leg.status === "rejected" ? RED :
    YELLOW;
  const elapsed = Math.round((Date.now() - leg.placedAtMs) / 1000);
  let detail = `${elapsed}s`;
  if (leg.status === "filled") {
    detail = `avg=${fmt(leg.avgPrice)}`;
  }
  return `[${side} ${exch}]  #${leg.orderId.slice(0, 8)}  LIMIT ${fmt(leg.limitPrice)}  ${statusColor}${leg.status.toUpperCase()}${RESET}  ${detail}`;
}
