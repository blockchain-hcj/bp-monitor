export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  incCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observe(name: string, value: number): void {
    const bucket = this.histograms.get(name);
    if (!bucket) {
      this.histograms.set(name, [value]);
      return;
    }
    bucket.push(value);
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    for (const [name, value] of this.counters.entries()) {
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }
    for (const [name, value] of this.gauges.entries()) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }
    for (const [name, values] of this.histograms.entries()) {
      if (values.length === 0) {
        continue;
      }
      const sorted = [...values].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
      lines.push(`# TYPE ${name}_summary gauge`);
      lines.push(`${name}_summary{quantile="0.5"} ${p50}`);
      lines.push(`${name}_summary{quantile="0.95"} ${p95}`);
      lines.push(`${name}_summary{quantile="0.99"} ${p99}`);
      lines.push(`${name}_summary_count ${values.length}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
