import { StringCodec, connect } from "nats";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SpreadEvent } from "../src/types.js";

describe("NATS queue message logging", () => {
  it("subscribes and logs a live message produced by the running monitor", async () => {
    const config = loadConfig();
    const subject = `${config.natsSubjectPrefix}.>`;
    const sc = StringCodec();
    let nc;
    try {
      nc = await connect({ servers: config.natsUrl, timeout: 2000 });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EPERM" || err.code === "ECONNREFUSED") {
        console.log(`[NATS TEST] skip: cannot connect to ${config.natsUrl} (${err.code})`);
        return;
      }
      throw error;
    }
    const sub = nc.subscribe(subject, { max: 1 });

    try {
      const msg = await Promise.race([
        (async () => {
          for await (const m of sub) {
            return m;
          }
          throw new Error("NATS subscription closed before receiving a message");
        })(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Timeout waiting for NATS message")), 5000);
        })
      ]);

      const payload = JSON.parse(sc.decode(msg.data)) as SpreadEvent;
      console.log("[NATS TEST] received live message from queue:", payload);

      expect(typeof payload.symbol).toBe("string");
      expect(payload.market_type).toBe("usdt_perp");
      expect(["binance", "okx", "deepbook"]).toContain(payload.exchange_a);
      expect(["binance", "okx", "deepbook"]).toContain(payload.exchange_b);
    } finally {
      await nc.drain();
    }
  }, 20_000);
});
