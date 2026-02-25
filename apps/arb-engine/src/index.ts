import { loadConfig } from "./config.js";
import { startHttpServer } from "./control/httpServer.js";
import { ExecutionRouter } from "./execution/router.js";
import { SpreadSubscriber } from "./nats/spreadSubscriber.js";
import { PositionReconciler } from "./position/positionReconciler.js";
import { RiskGuard } from "./risk/guard.js";
import { SignalEngine } from "./strategy/signalEngine.js";
import { StateStore } from "./strategy/stateStore.js";

function printSpreadStatus(
  signal: SignalEngine,
  stateStore: StateStore,
  event: Parameters<SignalEngine["evaluate"]>[0]
): void {
  const snapshots = signal.inspect(event);
  if (snapshots.length === 0) {
    return;
  }

  const parts = snapshots.map((s) => {
    const action = s.isOpen ? "HOLD/CLOSE" : "WAIT/OPEN";
    const gap = s.isOpen ? s.gap_to_close_bps : s.gap_to_open_bps;
    const gapLabel = s.isOpen ? "toClose" : "toOpen";
    return `${s.direction} raw=${s.raw_bps.toFixed(2)} net=${s.net_bps.toFixed(2)} ${action} ${gapLabel}=${gap.toFixed(
      2
    )} open=${s.open_bps.toFixed(2)} close=${s.close_bps.toFixed(2)} openNow=${s.can_open_now ? "Y" : "N"} closeNow=${
      s.should_close_now ? "Y" : "N"
    }`;
  });

  const riskMode = stateStore.getRiskMode();
  console.log(`[arb][${event.symbol}][risk=${riskMode}] ${parts.join(" | ")}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.tradeMode !== "paper" && config.tradeMode !== "live") {
    throw new Error(`Invalid TRADE_MODE=${config.tradeMode}`);
  }

  const stateStore = new StateStore();
  const risk = new RiskGuard(stateStore);
  const signal = new SignalEngine(config.strategy, stateStore);
  const router = new ExecutionRouter(config);
  const reconciler = new PositionReconciler(config, router, stateStore, risk);
  const subscriber = new SpreadSubscriber(config.natsUrl, config.natsSubjectPrefix);

  let ready = false;
  let lastEventAtMs = 0;
  let lastError: string | undefined;

  const server = await startHttpServer(config.controlPort, {
    config,
    store: stateStore,
    risk,
    getHealth: () => ({
      ready,
      lastEventAtMs,
      lastError
    })
  });

  await reconciler.start();
  risk.setMode("normal", "startup_force_normal");
  ready = true;
  console.log(`[arb-engine] started, port=${config.controlPort}, mode=${config.tradeMode}`);

  const shutdown = async () => {
    ready = false;
    await subscriber.close();
    await reconciler.stop();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  for await (const event of subscriber.stream()) {
    try {
      lastEventAtMs = Date.now();
      risk.onEvent(event);
      printSpreadStatus(signal, stateStore, event);

      const intents = signal.evaluate(event);
      for (const intent of intents) {
        console.log(
          `[arb][intent] action=${intent.action} symbol=${intent.symbol} direction=${intent.direction} net=${intent.net_bps.toFixed(
            2
          )} reason="${intent.reason}"`
        );
        const result = await router.execute(intent);
        if (!result.ok || result.partialFill) {
          const reason = result.legs
            .filter((v) => !v.ok)
            .map((v) => `${v.exchange}:${v.error ?? "failed"}`)
            .join(",");
          console.error(
            `[arb][exec-fail] action=${intent.action} symbol=${intent.symbol} direction=${intent.direction} reason=${reason || "partial_fill"}`
          );
          risk.onExecutionFailure(intent, reason || "partial_fill");
          continue;
        }

        if (intent.action === "open") {
          stateStore.setOpen(intent.symbol, intent.direction, intent.net_bps, intent.reason);
        } else {
          stateStore.setFlat(intent.symbol, intent.direction, intent.reason);
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      risk.setMode("close_only", `runtime_error:${lastError}`);
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
