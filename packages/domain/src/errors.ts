import type { NextAction } from "./provider.js";

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type FailureExitCode = Exclude<ExitCode, 0>;

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INTERNAL: 1,
  INVALID_INPUT: 2,
  NOT_FOUND: 3,
  PROVIDER_FAILURE: 4,
  UNSUPPORTED: 5,
  INTEGRITY_FAILURE: 6,
  QUERY_FAILURE: 7,
  PARTIAL_SUCCESS: 8,
} as const satisfies Readonly<Record<string, ExitCode>>);

export interface KlopsiErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly exitCode: FailureExitCode;
  readonly suggestion?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly nextActions?: readonly NextAction[];
  readonly cause?: unknown;
}

export class KlopsiError extends Error {
  readonly code: string;
  readonly exitCode: FailureExitCode;
  readonly suggestion?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly nextActions?: readonly NextAction[];
  override readonly cause?: unknown;

  constructor(options: KlopsiErrorOptions) {
    super(options.message);
    this.name = "KlopsiError";
    this.code = options.code;
    this.exitCode = options.exitCode;

    if (options.suggestion !== undefined) {
      this.suggestion = options.suggestion;
    }
    if (options.context !== undefined) {
      this.context = options.context;
    }
    if (options.nextActions !== undefined && options.nextActions.length > 0) {
      this.nextActions = options.nextActions;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      code: this.code,
      message: this.message,
      exitCode: this.exitCode,
      ...(this.suggestion === undefined ? {} : { suggestion: this.suggestion }),
      ...(this.context === undefined ? {} : { context: this.context }),
      ...(this.nextActions === undefined ? {} : { nextActions: this.nextActions }),
    };
  }
}
