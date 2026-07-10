import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { duckDbMemoryLimitBytes, EXIT_CODES, OpsiError } from "@opsi/domain";
import { stageTabularInput, type TabularStage } from "./tabular-stage.js";
import type { DataInput } from "./types.js";
import type {
  QueryLimits,
  QueryResult,
  QueryWorkerMessage,
  QueryWorkerRequest,
} from "./query-protocol.js";

const DEFAULT_LIMITS: QueryLimits = {
  rowLimit: 1_000,
  timeoutMs: 30_000,
  maxSqlBytes: 64 * 1024,
  maxColumns: 256,
  maxCellBytes: 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024,
  memoryLimit: "1GB",
  threads: 4,
};

export interface QueryExecutionOptions {
  readonly input: DataInput;
  readonly sql: string;
  readonly rowLimit?: number;
  readonly timeoutMs?: number;
  readonly maxSqlBytes?: number;
  readonly maxColumns?: number;
  readonly maxCellBytes?: number;
  readonly maxOutputBytes?: number;
  readonly memoryLimit?: string;
  readonly threads?: number;
  readonly sheet?: string;
  readonly signal?: AbortSignal;
}

export interface DuckDbQueryRunnerOptions {
  readonly workerPath: string | URL;
  readonly graceMs?: number;
  readonly stage?: typeof stageTabularInput;
  readonly makeTemporaryDirectory?: () => Promise<string>;
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
}

function workerError(error: Extract<QueryWorkerMessage, { type: "error" }>["error"]): OpsiError {
  return new OpsiError({
    code: error.code,
    message: error.message,
    exitCode: EXIT_CODES.QUERY_FAILURE,
    ...(error.context === undefined ? {} : { context: error.context }),
  });
}

function queryCancelled(): OpsiError {
  return new OpsiError({
    code: "QUERY_CANCELLED",
    message: "The query was cancelled.",
    exitCode: EXIT_CODES.QUERY_FAILURE,
  });
}

function cleanupError(failures: readonly unknown[], operationError: unknown): OpsiError {
  const first = failures[0];
  return new OpsiError({
    code: "QUERY_CLEANUP_FAILED",
    message: "Query resources could not be fully cleaned up.",
    exitCode: EXIT_CODES.QUERY_FAILURE,
    context: {
      message: first instanceof Error ? first.message : String(first),
      failureCount: failures.length,
    },
    cause: new AggregateError(
      operationError === undefined ? failures : [operationError, ...failures],
      "Query operation and cleanup failures",
    ),
  });
}

async function stopAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit").then(() => undefined);
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 100))]);
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
}

export class DuckDbQueryRunner {
  constructor(private readonly options: DuckDbQueryRunnerOptions) {}

  async execute(options: QueryExecutionOptions): Promise<QueryResult> {
    const memoryLimit = options.memoryLimit ?? DEFAULT_LIMITS.memoryLimit;
    if (duckDbMemoryLimitBytes(memoryLimit) === undefined)
      throw new OpsiError({
        code: "QUERY_MEMORY_LIMIT",
        message: "DuckDB memory must be a supported positive size no larger than 1GiB.",
        exitCode: EXIT_CODES.QUERY_FAILURE,
      });
    const limits: QueryLimits = {
      rowLimit: options.rowLimit ?? DEFAULT_LIMITS.rowLimit,
      timeoutMs: options.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
      maxSqlBytes: options.maxSqlBytes ?? DEFAULT_LIMITS.maxSqlBytes,
      maxColumns: options.maxColumns ?? DEFAULT_LIMITS.maxColumns,
      maxCellBytes: options.maxCellBytes ?? DEFAULT_LIMITS.maxCellBytes,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_LIMITS.maxOutputBytes,
      memoryLimit,
      threads: options.threads ?? DEFAULT_LIMITS.threads,
    };
    let directory: string | undefined;
    let stage: TabularStage | undefined;
    let child: ChildProcess | undefined;
    let queryResult: QueryResult | undefined;
    let operationError: unknown;
    let cancelled = options.signal?.aborted ?? false;
    const abortDuringImport = () => {
      cancelled = true;
      stage?.connection.interrupt();
    };
    options.signal?.addEventListener("abort", abortDuringImport, { once: true });
    try {
      if (cancelled) throw queryCancelled();
      directory = await (this.options.makeTemporaryDirectory?.() ??
        mkdtemp(join(tmpdir(), "opsi-query-")));
      if (cancelled) throw queryCancelled();
      const databasePath = join(directory, "data.duckdb");
      stage = await (this.options.stage ?? stageTabularInput)({
        input: options.input,
        databasePath,
        xlsxRowsPath: join(directory, "xlsx.ndjson"),
        xlsxSharedStringsByteLimit: 64 * 1024 * 1024,
        preserveDatabaseOnClose: true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
      });
      if (cancelled) throw queryCancelled();
      await stage.connection.run("CHECKPOINT");
      await stage.close();
      if (cancelled) throw queryCancelled();

      const request: QueryWorkerRequest = {
        databasePath,
        invocationDirectory: directory,
        sql: options.sql,
        limits,
      };
      const path =
        this.options.workerPath instanceof URL
          ? fileURLToPath(this.options.workerPath)
          : this.options.workerPath;
      child = fork(path, [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      queryResult = await new Promise<QueryResult>((resolve, reject) => {
        let settled = false;
        let timedOut = false;
        let cancelled = false;
        let killTimer: NodeJS.Timeout | undefined;
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          if (killTimer !== undefined) clearTimeout(killTimer);
          options.signal?.removeEventListener("abort", abort);
          callback();
        };
        const timeout = () => {
          if (settled) return;
          timedOut = true;
          child?.kill("SIGINT");
          killTimer = setTimeout(() => child?.kill("SIGKILL"), this.options.graceMs ?? 250);
        };
        const deadline = setTimeout(timeout, limits.timeoutMs);
        const abort = () => {
          cancelled = true;
          child?.kill("SIGTERM");
          killTimer = setTimeout(() => child?.kill("SIGKILL"), this.options.graceMs ?? 250);
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted === true) abort();
        child?.once("message", (raw: QueryWorkerMessage) => {
          finish(() => {
            if (timedOut)
              reject(
                new OpsiError({
                  code: "QUERY_TIMEOUT",
                  message: "The query exceeded its time limit.",
                  exitCode: EXIT_CODES.QUERY_FAILURE,
                }),
              );
            else if (cancelled)
              reject(
                new OpsiError({
                  code: "QUERY_CANCELLED",
                  message: "The query was cancelled.",
                  exitCode: EXIT_CODES.QUERY_FAILURE,
                }),
              );
            else if (raw.type === "result") resolve(raw.result);
            else reject(workerError(raw.error));
          });
        });
        child?.once("error", (error) =>
          finish(() => {
            if (cancelled)
              reject(
                new OpsiError({
                  code: "QUERY_CANCELLED",
                  message: "The query was cancelled.",
                  exitCode: EXIT_CODES.QUERY_FAILURE,
                }),
              );
            else reject(error);
          }),
        );
        child?.once("exit", (code, signal) => {
          if (!settled)
            finish(() => {
              if (timedOut)
                reject(
                  new OpsiError({
                    code: "QUERY_TIMEOUT",
                    message: "The query exceeded its time limit.",
                    exitCode: EXIT_CODES.QUERY_FAILURE,
                  }),
                );
              else if (cancelled)
                reject(
                  new OpsiError({
                    code: "QUERY_CANCELLED",
                    message: "The query was cancelled.",
                    exitCode: EXIT_CODES.QUERY_FAILURE,
                  }),
                );
              else
                reject(
                  new OpsiError({
                    code: "QUERY_WORKER_EXIT",
                    message: `Query worker exited (${signal ?? code ?? "unknown"}).`,
                    exitCode: EXIT_CODES.QUERY_FAILURE,
                  }),
                );
            });
        });
        child?.send(request);
      });
    } catch (error) {
      operationError =
        cancelled || (error as Error).name === "AbortError" ? queryCancelled() : error;
    } finally {
      options.signal?.removeEventListener("abort", abortDuringImport);
      const failures: unknown[] = [];
      if (stage !== undefined) {
        try {
          await stage.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (child !== undefined) {
        try {
          await stopAndWait(child);
        } catch (error) {
          failures.push(error);
        }
      }
      if (directory !== undefined) {
        try {
          await (this.options.removeTemporaryDirectory?.(directory) ??
            rm(directory, { recursive: true, force: true }));
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) operationError = cleanupError(failures, operationError);
    }
    if (operationError !== undefined) throw operationError;
    if (queryResult === undefined)
      throw new OpsiError({
        code: "QUERY_FAILED",
        message: "The query completed without a result.",
        exitCode: EXIT_CODES.QUERY_FAILURE,
      });
    return queryResult;
  }
}
