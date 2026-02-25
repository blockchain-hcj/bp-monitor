export class TaskLimiter {
  private running = 0;

  constructor(private readonly maxInflight: number) {}

  tryRun(task: () => Promise<void>): boolean {
    if (this.running >= this.maxInflight) {
      return false;
    }
    this.running += 1;
    task()
      .catch(() => {
        // caller handles error inside task
      })
      .finally(() => {
        this.running -= 1;
      });
    return true;
  }

  inflight(): number {
    return this.running;
  }
}
