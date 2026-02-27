import {
  AppState,
  CliConfig,
  ExchangeClient,
} from "../types.js";
import { PriceFeed } from "../pricing/priceFeed.js";
import { SpreadSubscriber } from "../nats/spreadSubscriber.js";

const POSITION_POLL_MS = 5_000;

export class AppStateManager {
  private state: AppState;
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (() => void) | null = null;
  private _onGoBack: (() => void) | null = null;

  constructor(
    private readonly config: CliConfig,
    private readonly binanceClient: ExchangeClient,
    private readonly okxClient: ExchangeClient,
    private readonly priceFeed: PriceFeed,
    private readonly subscriber: SpreadSubscriber
  ) {
    this.state = {
      screen: "SYMBOL_SELECT",
      symbolList: [],
      filteredSymbols: [],
      searchInput: "",
      selectedIndex: 0,
      symbol: config.symbol,
      direction: config.direction,
      quantity: config.quantity,
      slippageBps: config.slippageBps,
      binancePosition: null,
      okxPosition: null,
      editingSlippage: false,
      slippageInput: "",
    };

    // Wire up symbol discovery from NATS
    this.subscriber.onSymbolDiscovered((symbol) => {
      this.addDiscoveredSymbol(symbol);
    });
  }

  getState(): AppState {
    return this.state;
  }

  setOnUpdate(cb: () => void) {
    this.onUpdate = cb;
  }

  setOnGoBack(cb: () => void) {
    this._onGoBack = cb;
  }

  private emit() {
    this.onUpdate?.();
  }

  // --- Symbol discovery ---

  addDiscoveredSymbol(symbol: string): void {
    if (this.state.symbolList.includes(symbol)) return;
    this.state.symbolList.push(symbol);
    this.state.symbolList.sort();
    this.refilter();
    this.emit();
  }

  // --- SYMBOL_SELECT actions ---

  handleSearchKey(key: string): void {
    if (key === "\x7f" || key === "\b") {
      this.state.searchInput = this.state.searchInput.slice(0, -1);
    } else if (/^[a-zA-Z0-9]$/.test(key)) {
      this.state.searchInput += key.toUpperCase();
    } else {
      return;
    }
    this.state.selectedIndex = 0;
    this.refilter();
    this.emit();
  }

  clearSearch(): void {
    this.state.searchInput = "";
    this.state.selectedIndex = 0;
    this.refilter();
    this.emit();
  }

  moveSelection(delta: number): void {
    const len = this.state.filteredSymbols.length;
    if (len === 0) return;
    this.state.selectedIndex = (this.state.selectedIndex + delta + len) % len;
    this.emit();
  }

  selectSymbol(): void {
    const list = this.state.filteredSymbols;
    if (list.length === 0) return;
    const symbol = list[this.state.selectedIndex];
    this.state.symbol = symbol;
    this.state.screen = "DASHBOARD";
    this.state.binancePosition = null;
    this.state.okxPosition = null;

    // Switch NATS subscription
    const newSubject = `${this.config.natsSubjectPrefix}.${symbol}`;
    this.priceFeed.clear();
    this.subscriber.switchSubject(newSubject);

    // Start position polling
    this.startPositionPolling();
    this.emit();
  }

  // --- DASHBOARD actions ---

  goBack(): void {
    this.stopPositionPolling();
    this._onGoBack?.();
    this.state.screen = "SYMBOL_SELECT";
    this.state.binancePosition = null;
    this.state.okxPosition = null;
    this.state.editingSlippage = false;
    this.state.slippageInput = "";
    this.state.searchInput = "";
    this.refilter();
    this.priceFeed.clear();
    this.emit();
  }

  toggleDirection(): void {
    this.state.direction =
      this.state.direction === "binance_to_okx" ? "okx_to_binance" : "binance_to_okx";
    this.emit();
  }

  adjustQuantity(delta: number): void {
    const step = this.getQuantityStep();
    const newQty = Math.max(step, +(this.state.quantity + delta * step).toFixed(8));
    this.state.quantity = newQty;
    this.emit();
  }

  startSlippageEdit(): void {
    this.state.editingSlippage = true;
    this.state.slippageInput = String(this.state.slippageBps);
    this.emit();
  }

  handleSlippageKey(key: string): boolean {
    if (!this.state.editingSlippage) return false;

    if (key === "\r" || key === "\n") {
      const val = Number(this.state.slippageInput);
      if (Number.isFinite(val) && val >= 0) {
        this.state.slippageBps = val;
      }
      this.state.editingSlippage = false;
      this.state.slippageInput = "";
      this.emit();
      return true;
    }

    if (key === "\x1b") {
      this.state.editingSlippage = false;
      this.state.slippageInput = "";
      this.emit();
      return true;
    }

    if (key === "\x7f" || key === "\b") {
      this.state.slippageInput = this.state.slippageInput.slice(0, -1);
      this.emit();
      return true;
    }

    if (/^[0-9.]$/.test(key)) {
      this.state.slippageInput += key;
      this.emit();
      return true;
    }

    return true;
  }

  // --- Position polling ---

  private startPositionPolling(): void {
    this.stopPositionPolling();
    this.pollPositions();
    this.positionTimer = setInterval(() => this.pollPositions(), POSITION_POLL_MS);
  }

  private stopPositionPolling(): void {
    if (this.positionTimer) {
      clearInterval(this.positionTimer);
      this.positionTimer = null;
    }
  }

  private async pollPositions(): Promise<void> {
    const symbol = this.state.symbol;
    try {
      const [bnPos, okxPos] = await Promise.all([
        this.binanceClient.getPosition(symbol),
        this.okxClient.getPosition(symbol),
      ]);
      if (this.state.symbol === symbol && this.state.screen === "DASHBOARD") {
        this.state.binancePosition = bnPos;
        this.state.okxPosition = okxPos;
        this.emit();
      }
    } catch {
      // Silently ignore position polling errors
    }
  }

  destroy(): void {
    this.stopPositionPolling();
  }

  // --- Helpers ---

  private refilter(): void {
    const q = this.state.searchInput;
    if (q === "") {
      this.state.filteredSymbols = [...this.state.symbolList];
    } else {
      this.state.filteredSymbols = this.state.symbolList.filter((s) => s.includes(q));
    }
    // Clamp selection index
    if (this.state.selectedIndex >= this.state.filteredSymbols.length) {
      this.state.selectedIndex = Math.max(0, this.state.filteredSymbols.length - 1);
    }
  }

  private getQuantityStep(): number {
    const sym = this.state.symbol;
    if (sym === "BTCUSDT") return 0.001;
    if (sym === "ETHUSDT") return 0.01;
    return 0.1;
  }
}
