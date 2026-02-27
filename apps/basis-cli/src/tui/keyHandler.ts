import { SessionState } from "../types.js";
import { AppStateManager } from "./appState.js";

export interface KeyActions {
  onExecute: () => void;
  onAmend: () => void;
  onCancel: () => void;
  onQuit: () => void;
}

export function setupKeyHandler(
  appStateManager: AppStateManager,
  getSessionState: () => SessionState,
  actions: KeyActions
): () => void {
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const handler = (data: string) => {
    // Split input into individual keys (handle escape sequences as one unit)
    const keys = parseKeys(data);
    for (const key of keys) {
      processKey(key, appStateManager, getSessionState, actions);
    }
  };

  stdin.on("data", handler);

  return () => {
    stdin.removeListener("data", handler);
    stdin.setRawMode(false);
    stdin.pause();
  };
}

/** Parse raw stdin data into individual key tokens, keeping escape sequences intact */
function parseKeys(data: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] === "\x1b" && i + 1 < data.length && data[i + 1] === "[") {
      // CSI escape sequence: \x1b[ followed by parameter bytes and a final byte
      let j = i + 2;
      while (j < data.length && data.charCodeAt(j) >= 0x30 && data.charCodeAt(j) <= 0x3f) {
        j++; // skip parameter bytes (0-9, ;, etc.)
      }
      if (j < data.length) j++; // final byte (A, B, C, D, etc.)
      keys.push(data.slice(i, j));
      i = j;
    } else {
      keys.push(data[i]);
      i++;
    }
  }
  return keys;
}

function processKey(
  key: string,
  appStateManager: AppStateManager,
  getSessionState: () => SessionState,
  actions: KeyActions
): void {
  // Ctrl+C always quits
  if (key === "\u0003") {
    actions.onQuit();
    return;
  }

  const appState = appStateManager.getState();

  // Slippage editing mode intercepts all keys
  if (appState.editingSlippage) {
    appStateManager.handleSlippageKey(key);
    return;
  }

  if (appState.screen === "SYMBOL_SELECT") {
    handleSymbolSelect(key, appStateManager, actions);
  } else {
    handleDashboard(key, appStateManager, getSessionState, actions);
  }
}

function handleSymbolSelect(
  key: string,
  appState: AppStateManager,
  actions: KeyActions
): void {
  if (key === "\x1b[A") {
    appState.moveSelection(-1);
    return;
  }
  if (key === "\x1b[B") {
    appState.moveSelection(1);
    return;
  }
  if (key === "\r" || key === "\n") {
    appState.selectSymbol();
    return;
  }
  if (key === "\x7f" || key === "\b") {
    appState.handleSearchKey(key);
    return;
  }
  if (key === "\x1b") {
    appState.clearSearch();
    return;
  }
  // Q quits only when search is empty
  if (key.toLowerCase() === "q" && appState.getState().searchInput === "") {
    actions.onQuit();
    return;
  }
  // Printable characters → search
  if (/^[a-zA-Z0-9]$/.test(key)) {
    appState.handleSearchKey(key);
    return;
  }
}

function handleDashboard(
  key: string,
  appState: AppStateManager,
  getSessionState: () => SessionState,
  actions: KeyActions
): void {
  const session = getSessionState();

  // Escape key → back (only in IDLE)
  if (key === "\x1b") {
    if (session.phase === "IDLE") appState.goBack();
    return;
  }

  switch (key.toLowerCase()) {
    case "\r":
    case "\n":
      actions.onExecute();
      break;
    case "d":
      if (session.phase === "IDLE") appState.toggleDirection();
      break;
    case "+":
    case "=":
      if (session.phase === "IDLE") appState.adjustQuantity(1);
      break;
    case "-":
    case "_":
      if (session.phase === "IDLE") appState.adjustQuantity(-1);
      break;
    case "s":
      if (session.phase === "IDLE") appState.startSlippageEdit();
      break;
    case "r":
      actions.onAmend();
      break;
    case "c":
      actions.onCancel();
      break;
    case "b":
      if (session.phase === "IDLE") appState.goBack();
      break;
    case "q":
      actions.onQuit();
      break;
  }
}
