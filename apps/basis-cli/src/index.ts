import { loadConfig } from "./config.js";
import { BinanceClient } from "./execution/binanceClient.js";
import { OkxClient } from "./execution/okxClient.js";
import { PaperClient } from "./execution/paperClient.js";
import { SpreadSubscriber } from "./nats/spreadSubscriber.js";
import { PriceFeed } from "./pricing/priceFeed.js";
import { LimitOrderPricer } from "./pricing/limitOrderPricer.js";
import { OrderManager } from "./order/orderManager.js";
import { Renderer } from "./tui/renderer.js";
import { setupKeyHandler } from "./tui/keyHandler.js";
import { AppStateManager } from "./tui/appState.js";
import { ExchangeClient } from "./types.js";

async function main() {
  const config = loadConfig();

  // Build exchange clients
  let binanceClient: ExchangeClient;
  let okxClient: ExchangeClient;

  if (config.mode === "paper") {
    binanceClient = new PaperClient("binance");
    okxClient = new PaperClient("okx");
    console.log("Running in PAPER mode (no real orders)");
  } else {
    if (!config.bnApiKey || !config.bnApiSecret) {
      throw new Error("Live mode requires BN_API_KEY and BN_API_SECRET");
    }
    if (!config.okxApiKey || !config.okxApiSecret || !config.okxApiPassphrase) {
      throw new Error("Live mode requires OKX_API_KEY, OKX_API_SECRET, and OKX_API_PASSPHRASE");
    }
    binanceClient = new BinanceClient(config.bnApiKey, config.bnApiSecret);
    okxClient = new OkxClient(config.okxApiKey, config.okxApiSecret, config.okxApiPassphrase);
  }

  // Price feed
  const priceFeed = new PriceFeed();

  // NATS subscriber (initial subject will be switched when symbol is selected)
  const subscriber = new SpreadSubscriber(
    config.natsUrl,
    `${config.natsSubjectPrefix}.${config.symbol}`
  );

  // App state manager
  const appStateManager = new AppStateManager(config, binanceClient, okxClient, priceFeed, subscriber);

  // Pricer + order manager (with dynamic params from appState)
  const pricer = new LimitOrderPricer(binanceClient, okxClient);
  const orderManager = new OrderManager(
    binanceClient,
    okxClient,
    pricer,
    priceFeed,
    config,
    () => {
      const s = appStateManager.getState();
      return {
        symbol: s.symbol,
        direction: s.direction,
        quantity: s.quantity,
        slippageBps: s.slippageBps,
      };
    }
  );

  // Renderer (reads both session state and app state)
  const renderer = new Renderer(
    config,
    () => priceFeed.snapshot,
    () => orderManager.getState(),
    () => appStateManager.getState(),
    subscriber
  );

  orderManager.setOnUpdate(() => renderer.scheduleRender());
  appStateManager.setOnUpdate(() => renderer.scheduleRender());
  appStateManager.setOnGoBack(() => orderManager.reset());

  // Wire up NATS events
  subscriber.onSnapshot((snap) => {
    priceFeed.update(snap);
    renderer.scheduleRender();
  });
  subscriber.onConnect(() => {
    orderManager.setNatsConnected(true);
  });
  subscriber.onDisconnect(() => {
    orderManager.setNatsConnected(false);
  });

  // Graceful shutdown
  let shuttingDown = false;
  const gracefulShutdown = async () => {
    if (shuttingDown) {
      // Second press = force exit
      process.stdout.write("\n\x1b[?25h");
      process.exit(0);
    }
    shuttingDown = true;

    // Hard timeout: force exit after 3s no matter what
    setTimeout(() => {
      process.stdout.write("\n\x1b[?25h");
      process.exit(0);
    }, 3000).unref();

    appStateManager.destroy();
    process.stdout.write("\n\x1b[?25h"); // Show cursor

    try {
      await orderManager.shutdown();
    } catch {}
    try {
      await subscriber.close();
    } catch {}

    cleanupKeys();
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  // Keyboard handler
  const cleanupKeys = setupKeyHandler(
    appStateManager,
    () => orderManager.getState(),
    {
      onExecute: () => {
        if (appStateManager.getState().screen === "DASHBOARD") {
          orderManager.execute();
        }
      },
      onAmend: () => orderManager.amendAll(),
      onCancel: () => orderManager.cancelAll(),
      onQuit: () => gracefulShutdown(),
    }
  );

  // Hide cursor
  process.stdout.write("\x1b[?25l");

  // Connect NATS
  await subscriber.connect();

  // Initial render (symbol select screen)
  renderer.render();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.stdout.write("\x1b[?25h");
  process.exit(1);
});
