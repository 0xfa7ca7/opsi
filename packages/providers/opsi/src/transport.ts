import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { envelopeSchema } from "./contracts.js";
import {
  OPSI_OPERATIONS,
  type OpsiOperationInputs,
  type OpsiOperationName,
  type OpsiOperationResults,
} from "./operations.js";
import {
  RequestScheduler,
  RetryableRequestError,
  canonicalRequestKey,
  isRetryableStatus,
} from "./scheduler.js";

export const DEFAULT_OPSI_BASE_URL = "https://podatki.gov.si/api/gw/opsi-api-basic/2.2.3";

export type OpsiFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpsiTransportOptions {
  readonly baseUrl?: string;
  readonly fetch?: OpsiFetch;
  readonly scheduler?: RequestScheduler;
  readonly timeoutMs?: number;
}

function queryValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new OpsiError({
    code: "INVALID_PROVIDER_REQUEST",
    message: "OPSI query parameters must be scalar values.",
    exitCode: EXIT_CODES.INVALID_INPUT,
  });
}

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/u.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

type ProviderErrorKind = "request" | "invalid-response" | "not-found";

function providerError(
  operation: OpsiOperationName,
  message: string,
  cause?: unknown,
  kind: ProviderErrorKind = "request",
): OpsiError {
  const notFound =
    kind === "not-found" && (operation === "package_show" || operation === "resource_show");
  const entity = operation === "package_show" ? "DATASET" : "RESOURCE";
  return new OpsiError({
    code: notFound
      ? `${entity}_NOT_FOUND`
      : kind === "invalid-response"
        ? "INVALID_PROVIDER_RESPONSE"
        : "PROVIDER_REQUEST_FAILED",
    message,
    exitCode: notFound ? EXIT_CODES.NOT_FOUND : EXIT_CODES.PROVIDER_FAILURE,
    context: { provider: "opsi", operation },
    ...(cause === undefined ? {} : { cause }),
  });
}

export class OpsiTransport {
  private readonly baseUrl: string;
  private readonly fetch: OpsiFetch;
  private readonly scheduler: RequestScheduler;
  private readonly timeoutMs: number;

  constructor(options: OpsiTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPSI_BASE_URL).replace(/\/$/u, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.scheduler = options.scheduler ?? new RequestScheduler();
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  call<Operation extends OpsiOperationName>(
    operation: Operation,
    input: OpsiOperationInputs[Operation],
    signal?: AbortSignal,
  ): Promise<OpsiOperationResults[Operation]> {
    const definition = OPSI_OPERATIONS[operation];
    const parsedInput = definition.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new OpsiError({
        code: "INVALID_PROVIDER_REQUEST",
        message: `Invalid OPSI ${operation} input.`,
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { operation, issues: parsedInput.error.issues },
        cause: parsedInput.error,
      });
    }
    const key = canonicalRequestKey(operation, parsedInput.data);
    return this.scheduler
      .schedule(
        key,
        definition.retryable,
        () => this.execute(operation, parsedInput.data as OpsiOperationInputs[Operation], signal),
        signal,
      )
      .catch((error: unknown) => {
        if (error instanceof RetryableRequestError) {
          throw providerError(operation, error.message, error);
        }
        throw error;
      });
  }

  private async execute<Operation extends OpsiOperationName>(
    operation: Operation,
    input: OpsiOperationInputs[Operation],
    signal?: AbortSignal,
  ): Promise<OpsiOperationResults[Operation]> {
    const definition = OPSI_OPERATIONS[operation];
    const url = new URL(`${this.baseUrl}${definition.path}`);
    const init: RequestInit = { method: definition.method };
    if (definition.parameters === "query") {
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) url.searchParams.set(key, queryValue(value));
      }
    } else if (definition.parameters === "json") {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(input);
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await this.fetch(url, { ...init, signal: combinedSignal });
    } catch (error) {
      throw new RetryableRequestError("OPSI network request failed.", undefined, undefined, error);
    }

    if (isRetryableStatus(response.status)) {
      throw new RetryableRequestError(
        `OPSI temporarily returned HTTP ${response.status}.`,
        response.status,
        retryAfterMilliseconds(response.headers.get("retry-after")),
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw providerError(
        operation,
        "OPSI returned a non-JSON response.",
        error,
        "invalid-response",
      );
    }

    const parsed = envelopeSchema(definition.resultSchema).safeParse(body);
    if (!parsed.success) {
      throw providerError(
        operation,
        "OPSI returned an invalid response envelope.",
        parsed.error,
        "invalid-response",
      );
    }
    if (!parsed.data.success) {
      const errorText = `${parsed.data.error.__type ?? ""} ${parsed.data.error.message ?? ""}`;
      const kind =
        response.status === 404 || /not found/iu.test(errorText) ? "not-found" : "request";
      throw providerError(
        operation,
        parsed.data.error.message ?? `OPSI ${operation} request failed.`,
        parsed.data.error,
        kind,
      );
    }
    if (!response.ok) {
      throw providerError(operation, `OPSI returned HTTP ${response.status}.`);
    }
    return parsed.data.result as OpsiOperationResults[Operation];
  }
}
