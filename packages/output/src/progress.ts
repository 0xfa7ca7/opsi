import { sanitizeTerminalText } from "./sanitize.js";

export interface WritableOutput {
  readonly isTTY?: boolean;
  write(chunk: string): unknown;
}

export interface ProgressReporterOptions {
  readonly stream: WritableOutput;
  readonly quiet?: boolean;
  readonly intervalMs?: number;
}

export class ProgressReporter {
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private lastWriteAt = Number.NEGATIVE_INFINITY;
  private pending: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ProgressReporterOptions) {
    this.enabled = options.stream.isTTY === true && options.quiet !== true;
    this.intervalMs = options.intervalMs ?? 100;
  }

  update(message: string): void {
    if (!this.enabled) return;
    const sanitized = sanitizeTerminalText(message);
    const elapsed = Date.now() - this.lastWriteAt;
    if (elapsed >= this.intervalMs && this.timer === undefined) {
      this.write(sanitized);
      return;
    }
    this.pending = sanitized;
    if (this.timer === undefined) {
      this.timer = setTimeout(
        () => {
          this.timer = undefined;
          const pending = this.pending;
          this.pending = undefined;
          if (pending !== undefined) this.write(pending);
        },
        Math.max(0, this.intervalMs - elapsed),
      );
    }
  }

  finish(message?: string): void {
    if (!this.enabled) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    if (message !== undefined) this.options.stream.write(`\r${sanitizeTerminalText(message)}\n`);
    else this.options.stream.write("\n");
  }

  private write(message: string): void {
    this.lastWriteAt = Date.now();
    this.options.stream.write(`\r${message}`);
  }
}
