export type ExitCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const EXIT_CODES = Object.freeze({
  INTERNAL: 1,
  INVALID_INPUT: 2,
  NOT_FOUND: 3,
  PROVIDER_FAILURE: 4,
  UNSUPPORTED: 5,
  INTEGRITY_FAILURE: 6,
  QUERY_FAILURE: 7,
  PARTIAL_SUCCESS: 8,
} as const satisfies Readonly<Record<string, ExitCode>>);

export interface OpsiErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly exitCode: ExitCode;
  readonly suggestion?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class OpsiError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly suggestion?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  override readonly cause?: unknown;

  constructor(options: OpsiErrorOptions) {
    super(options.message);
    this.name = "OpsiError";
    this.code = options.code;
    this.exitCode = options.exitCode;

    if (options.suggestion !== undefined) {
      this.suggestion = options.suggestion;
    }
    if (options.context !== undefined) {
      this.context = options.context;
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
    };
  }
}
