export type LogLevel = "debug" | "info" | "warn" | "error";

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class Logger {
  constructor(private readonly level: LogLevel, private readonly scope: string) {}

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }

  child(scope: string): Logger {
    return new Logger(this.level, `${this.scope}:${scope}`);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (rank[level] < rank[this.level]) {
      return;
    }
    const entry = {
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      data
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  }
}
