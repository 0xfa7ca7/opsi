import { closeSync, openSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { DuckDBInstance, DuckDBTypeId, DuckDBConnection } from "@duckdb/node-api";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { detectFormat } from "./detect.js";
import { sqlString } from "./sql-path.js";
import type { DataInput, SupportedDataFormat, ValidationIssue } from "./types.js";
import { scanXlsx } from "./xlsx.js";

export interface StagedColumn {
  readonly name: string;
  readonly typeId: DuckDBTypeId;
}

export interface TabularStage {
  readonly connection: DuckDBConnection;
  readonly columns: readonly StagedColumn[];
  readonly sourceFormat: SupportedDataFormat;
  readonly inputPath: string;
  readonly warnings: readonly ValidationIssue[];
  close(): Promise<void>;
}

function supported(format: string): format is SupportedDataFormat {
  return ["csv", "tsv", "json", "ndjson", "xlsx", "parquet"].includes(format);
}

function sourceExpression(format: Exclude<SupportedDataFormat, "xlsx">, path: string): string {
  const input = sqlString(path);
  switch (format) {
    case "csv":
      return `read_csv(${input}, auto_detect = true, header = true, delim = ',', sample_size = -1, strict_mode = true, nullstr = '', allow_quoted_nulls = false)`;
    case "tsv":
      return `read_csv(${input}, auto_detect = true, header = true, delim = '\t', sample_size = -1, strict_mode = true, nullstr = '', allow_quoted_nulls = false)`;
    case "json":
      return `read_json_auto(${input}, format = 'auto', union_by_name = true, sample_size = -1)`;
    case "ndjson":
      return `read_json_auto(${input}, format = 'newline_delimited', union_by_name = true, sample_size = -1)`;
    case "parquet":
      return `read_parquet(${input})`;
  }
}

async function xlsxAsNdjson(
  input: string,
  path: string,
  sheet: string | undefined,
  sharedStringsByteLimit: number,
  signal?: AbortSignal,
): Promise<readonly ValidationIssue[]> {
  const warnings: ValidationIssue[] = [];
  let descriptor: number | undefined;
  let sawHeader = false;
  let sawRow = false;
  try {
    signal?.throwIfAborted();
    descriptor = openSync(path, "wx", 0o600);
    await scanXlsx(
      input,
      sheet,
      {
        maxRecords: Number.MAX_SAFE_INTEGER,
        sharedStringsByteLimit,
        maxColumns: 16_384,
      },
      (row, rowWarnings) => {
        signal?.throwIfAborted();
        sawRow = true;
        warnings.push(...rowWarnings);
        writeSync(descriptor as number, `${JSON.stringify(row)}\n`);
      },
      (issue) => warnings.push(issue),
      (_columns, headerWarnings) => {
        sawHeader = true;
        warnings.push(...headerWarnings);
      },
    );
    signal?.throwIfAborted();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (!sawHeader || !sawRow)
    throw new OpsiError({
      code: "EMPTY_TABULAR_INPUT",
      message: "The selected XLSX sheet has no data rows to convert.",
      exitCode: EXIT_CODES.INVALID_INPUT,
    });
  return warnings;
}

export async function stageTabularInput(options: {
  readonly input: DataInput;
  readonly sheet?: string;
  readonly databasePath: string;
  readonly xlsxRowsPath: string;
  readonly xlsxSharedStringsByteLimit: number;
  readonly preserveDatabaseOnClose?: boolean;
  readonly signal?: AbortSignal;
}): Promise<TabularStage> {
  options.signal?.throwIfAborted();
  const detection = await detectFormat(options.input);
  options.signal?.throwIfAborted();
  if (!supported(detection.format))
    throw new OpsiError({
      code: "UNSUPPORTED_CONVERSION_FORMAT",
      message: `The detected format '${detection.format}' cannot be converted.`,
      exitCode: EXIT_CODES.UNSUPPORTED,
      suggestion: "Use CSV, TSV, JSON, NDJSON, XLSX, or Parquet input.",
      context: { format: detection.format },
    });

  let warnings: readonly ValidationIssue[] = [];
  let stagedSource = detection.path;
  let stagedFormat: Exclude<SupportedDataFormat, "xlsx"> = detection.format as Exclude<
    SupportedDataFormat,
    "xlsx"
  >;
  if (detection.format === "xlsx") {
    warnings = await xlsxAsNdjson(
      detection.path,
      options.xlsxRowsPath,
      options.sheet,
      options.xlsxSharedStringsByteLimit,
      options.signal,
    );
    stagedSource = options.xlsxRowsPath;
    stagedFormat = "ndjson";
  }

  let instance: DuckDBInstance | undefined;
  let connection: DuckDBConnection | undefined;
  const interrupt = () => connection?.interrupt();
  options.signal?.addEventListener("abort", interrupt, { once: true });
  let closed = false;
  const cleanup = async (preserveDatabase: boolean): Promise<void> => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", interrupt);
    const failures: unknown[] = [];
    if (connection !== undefined) {
      try {
        connection.closeSync();
      } catch (error) {
        failures.push(error);
      }
    }
    if (instance !== undefined) {
      try {
        instance.closeSync();
      } catch (error) {
        failures.push(error);
      }
    }
    for (const path of [
      ...(preserveDatabase ? [] : [options.databasePath]),
      `${options.databasePath}.wal`,
      options.xlsxRowsPath,
    ]) {
      try {
        await rm(path, { force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, "Failed to close tabular staging resources.");
  };
  try {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    instance = await DuckDBInstance.create(options.databasePath, {
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
      allow_unsigned_extensions: "false",
      threads: "2",
      memory_limit: "512MB",
    });
    options.signal?.throwIfAborted();
    connection = await instance.connect();
    options.signal?.throwIfAborted();
    // This is an OPSI-owned statement. Only the path literal is variable and is
    // quoted by sqlString; no user SQL reaches the staging connection.
    await connection.run(
      `CREATE TABLE data AS SELECT * FROM ${sourceExpression(stagedFormat, stagedSource)}`,
    );
    const result = await connection.runAndReadAll("SELECT * FROM data LIMIT 0");
    const columns = Array.from({ length: result.columnCount }, (_, index) => ({
      name: result.columnName(index),
      typeId: result.columnTypeId(index),
    }));
    if (columns.length === 0)
      throw new OpsiError({
        code: "EMPTY_TABULAR_INPUT",
        message: "The input has no columns to convert.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    return {
      connection,
      columns,
      sourceFormat: detection.format,
      inputPath: detection.path,
      warnings,
      async close() {
        await cleanup(options.preserveDatabaseOnClose ?? false);
      },
    };
  } catch (error) {
    try {
      await cleanup(false);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Tabular staging and cleanup failed.", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}

export async function verifyStagedDatabase(databasePath: string): Promise<void> {
  let instance: DuckDBInstance | undefined;
  let connection: DuckDBConnection | undefined;
  let operationError: unknown;
  try {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    instance = await DuckDBInstance.create(databasePath, {
      access_mode: "READ_ONLY",
      enable_external_access: "false",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
      allow_community_extensions: "false",
      allow_unsigned_extensions: "false",
      lock_configuration: "true",
    });
    connection = await instance.connect();
    const result = await connection.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const tableNames = result
      .getRowObjectsJS()
      .map((row) => row.table_name)
      .filter((name): name is string => typeof name === "string");
    if (tableNames.length !== 1 || tableNames[0] !== "data")
      throw new OpsiError({
        code: "STAGED_DATABASE_INVALID",
        message: "The staged DuckDB database does not contain exactly one data table.",
        exitCode: EXIT_CODES.QUERY_FAILURE,
        context: { tables: tableNames },
      });
  } catch (error) {
    operationError =
      error instanceof OpsiError
        ? error
        : new OpsiError({
            code: "STAGED_DATABASE_INVALID",
            message: "The staged DuckDB database could not be verified.",
            exitCode: EXIT_CODES.QUERY_FAILURE,
            context: { message: error instanceof Error ? error.message : String(error) },
            cause: error,
          });
  } finally {
    const failures: unknown[] = [];
    for (const close of [
      connection === undefined ? undefined : () => connection?.closeSync(),
      instance === undefined ? undefined : () => instance?.closeSync(),
    ]) {
      if (close === undefined) continue;
      try {
        close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      operationError = new OpsiError({
        code: "STAGED_DATABASE_CLEANUP_FAILED",
        message: "The staged DuckDB verification resources could not be closed.",
        exitCode: EXIT_CODES.QUERY_FAILURE,
        context: { failureCount: failures.length },
        cause: new AggregateError(
          operationError === undefined ? failures : [operationError, ...failures],
          "Staged database verification and cleanup failures",
        ),
      });
  }
  if (operationError !== undefined) throw operationError;
}

export function isStringColumn(typeId: DuckDBTypeId): boolean {
  // Stable DuckDB logical type identifiers: VARCHAR, STRING_LITERAL, ENUM.
  return [17, 37, 23].includes(typeId as number);
}
