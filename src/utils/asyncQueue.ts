export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  end(): void {
    this.ended = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ done: true, value: undefined as never });
    }
  }

  async next(): Promise<IteratorResult<T>> {
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
