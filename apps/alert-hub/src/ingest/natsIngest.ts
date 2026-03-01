import { connect, NatsConnection } from "nats";

export interface NatsIngestOptions {
  enabled: boolean;
  natsUrl: string;
  subject: string;
  onPayload: (payload: unknown) => void;
}

export interface NatsIngestHandle {
  close(): Promise<void>;
}

export async function startNatsIngest(options: NatsIngestOptions): Promise<NatsIngestHandle> {
  if (!options.enabled) {
    return {
      async close() {
        return;
      }
    };
  }

  const nc: NatsConnection = await connect({ servers: options.natsUrl });
  const sub = nc.subscribe(options.subject);

  void (async () => {
    for await (const msg of sub) {
      try {
        const raw = msg.string();
        options.onPayload(JSON.parse(raw));
      } catch (error) {
        console.error("[alert-hub][nats] drop invalid message", error instanceof Error ? error.message : String(error));
      }
    }
  })();

  return {
    async close() {
      sub.unsubscribe();
      await nc.drain();
      await nc.close();
    }
  };
}
