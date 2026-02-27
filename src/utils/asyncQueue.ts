interface AsyncQueueOptions<T> {
  keyOf?: (value: T) => string;
}

export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly keyedOrder: string[] = [];
  private readonly keyedValues = new Map<string, T>();
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;
  private readonly keyOf: ((value: T) => string) | null;

  constructor(options?: AsyncQueueOptions<T>) {
    this.keyOf = options?.keyOf ?? null;
  }

  push(value: T): void {
    if (this.ended) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ done: false, value });
      return;
    }
    if (!this.keyOf) {
      this.values.push(value);
      return;
    }

    const key = this.keyOf(value);
    if (this.keyedValues.has(key)) {
      this.keyedValues.set(key, value);
      return;
    }
    this.keyedValues.set(key, value);
    this.keyedOrder.push(key);
  }

  end(): void {
    this.ended = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ done: true, value: undefined as never });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.keyOf && this.keyedOrder.length > 0) {
      const key = this.keyedOrder.shift() as string;
      const value = this.keyedValues.get(key) as T;
      this.keyedValues.delete(key);
      return { done: false, value };
    }
    if (this.values.length > 0) {
      return { done: false, value: this.values.shift() as T };
    }
    if (this.ended) {
      return { done: true, value: undefined as never };
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  async *iterate(): AsyncIterable<T> {
    while (true) {
      const item = await this.next();
      if (item.done) {
        break;
      }
      yield item.value;
    }
  }
}
