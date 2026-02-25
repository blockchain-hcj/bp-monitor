import { StringCodec, connect } from "nats";
import { loadConfig } from "../config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const subject = process.env.NATS_TAIL_SUBJECT?.trim() || `${config.natsSubjectPrefix}.>`;
  const sc = StringCodec();

  const nc = await connect({ servers: config.natsUrl, timeout: 2000 });
  const sub = nc.subscribe(subject);

  console.log(`[nats:tail] connected: ${config.natsUrl}`);
  console.log(`[nats:tail] subject: ${subject}`);
  console.log("[nats:tail] watching... press Ctrl+C to stop");

  process.on("SIGINT", async () => {
    console.log("\n[nats:tail] stopping...");
    await nc.drain();
    process.exit(0);
  });

  for await (const msg of sub) {
    const now = new Date().toISOString();
    const raw = sc.decode(msg.data);
    try {
      const parsed = JSON.parse(raw);
      console.log(`[${now}] ${msg.subject}`, parsed);
    } catch {
      console.log(`[${now}] ${msg.subject}`, raw);
    }
  }
}

main().catch((error) => {
  console.error("[nats:tail] failed:", error);
  process.exit(1);
});
