import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { stageTabularInput } from "./tabular-stage.js";
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
}

function workerError(error: Extract<QueryWorkerMessage, { type: "error" }>["error"]): OpsiError {
  return new OpsiError({
    code: error.code,
    message: error.message,
    exitCode: EXIT_CODES.QUERY_FAILURE,
    ...(error.context === undefined ? {} : { context: error.context }),
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
    const limits: QueryLimits = {
      rowLimit: options.rowLimit ?? DEFAULT_LIMITS.rowLimit,
      timeoutMs: options.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
      maxSqlBytes: options.maxSqlBytes ?? DEFAULT_LIMITS.maxSqlBytes,
      maxColumns: options.maxColumns ?? DEFAULT_LIMITS.maxColumns,
      maxCellBytes: options.maxCellBytes ?? DEFAULT_LIMITS.maxCellBytes,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_LIMITS.maxOutputBytes,
      memoryLimit: options.memoryLimit ?? DEFAULT_LIMITS.memoryLimit,
      threads: options.threads ?? DEFAULT_LIMITS.threads,
    };
    const directory = await mkdtemp(join(tmpdir(), "opsi-query-"));
    const databasePath = join(directory, "data.duckdb");
    let child: ChildProcess | undefined;
    try {
      const stage = await stageTabularInput({
        input: options.input,
        databasePath,
        xlsxRowsPath: join(directory, "xlsx.ndjson"),
        xlsxSharedStringsByteLimit: 64 * 1024 * 1024,
        preserveDatabaseOnClose: true,
        ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
      });
      await stage.connection.run("CHECKPOINT");
      await stage.close();

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
      return await new Promise<QueryResult>((resolve, reject) => {
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
    } finally {
      if (child !== undefined) await stopAndWait(child);
      await rm(directory, { recursive: true, force: true });
    }
  }
}
