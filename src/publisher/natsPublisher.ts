import { JetStreamClient, NatsConnection, PubAck, connect } from "nats";
import { EventPublisher, PublishAck, RuntimeConfig, SpreadEvent } from "../types.js";

export class NatsEventPublisher implements EventPublisher {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;

  constructor(private readonly config: RuntimeConfig) {}

  async init(): Promise<void> {
    this.nc = await connect({ servers: this.config.natsUrl, timeout: this.config.publishTimeoutMs });
    this.js = this.nc.jetstream();

    try {
      const jsm = await this.nc.jetstreamManager();
      await jsm.streams.add({
        name: this.config.natsStream,
        subjects: [`${this.config.natsSubjectPrefix}.>`],
        max_age: 1000 * 60 * 60 * 24 * 7
      });
    } catch {
      // Stream likely exists already.
    }
  }

  async publishSpread(event: SpreadEvent): Promise<PublishAck> {
    if (!this.js) {
      throw new Error("NATS publisher not initialized");
    }
    const subject = `${this.config.natsSubjectPrefix}.binance_okx.${event.symbol}`;
    let lastError: unknown;

    for (let i = 0; i <= this.config.publishRetries; i += 1) {
      try {
        const ack: PubAck = await this.js.publish(subject, Buffer.from(JSON.stringify(event)));
        return {
          stream: ack.stream,
          seq: ack.seq
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`Publish failed: ${String(lastError)}`);
  }

  async close(): Promise<void> {
    await this.nc?.drain();
    this.nc = null;
    this.js = null;
  }
}
