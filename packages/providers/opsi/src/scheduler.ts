const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export class RetryableRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RetryableRequestError";
  }
}

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

export interface RequestSchedulerOptions {
  readonly intervalMs?: number;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
  readonly jitterRatio?: number;
  readonly random?: () => number;
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class RequestScheduler {
  private readonly intervalMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private startQueue: Promise<void> = Promise.resolve();
  private lastStart = Number.NEGATIVE_INFINITY;

  constructor(options: RequestSchedulerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 7_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseMs = options.retryBaseMs ?? 500;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.random = options.random ?? Math.random;
  }

  schedule<Result>(
    key: string,
    retryable: boolean,
    task: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing as Promise<Result>;

    const promise = this.run(retryable, task, signal).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async run<Result>(
    retryable: boolean,
    task: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    for (let attempt = 0; ; attempt += 1) {
      await this.acquireStart(attempt === 0 ? 0 : this.retryDelay(attempt), signal);
      try {
        return await task();
      } catch (error) {
        if (!(error instanceof RetryableRequestError) || !retryable || attempt >= this.maxRetries) {
          throw error;
        }
        if (error.retryAfterMs !== undefined) {
          await wait(error.retryAfterMs, signal);
        }
      }
    }
  }

  private acquireStart(minimumDelayMs: number, signal?: AbortSignal): Promise<void> {
    const start = this.startQueue.then(async () => {
      const intervalDelay = Math.max(0, this.lastStart + this.intervalMs - Date.now());
      await wait(Math.max(intervalDelay, minimumDelayMs), signal);
      this.lastStart = Date.now();
    });
    this.startQueue = start.catch(() => undefined);
    return start;
  }

  private retryDelay(attempt: number): number {
    const base = this.retryBaseMs * 2 ** (attempt - 1);
    const jitter = base * this.jitterRatio * (this.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }
}

export function canonicalRequestKey(operation: string, input: unknown): string {
  return `${operation}:${stableJson(input)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
