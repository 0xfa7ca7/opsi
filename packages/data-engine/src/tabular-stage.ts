import { closeSync, openSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { DuckDBInstance, DuckDBTypeId, type DuckDBConnection } from "@duckdb/node-api";
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
): Promise<readonly ValidationIssue[]> {
  const warnings: ValidationIssue[] = [];
  let descriptor: number | undefined;
  let sawHeader = false;
  let sawRow = false;
  try {
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
}): Promise<TabularStage> {
  const detection = await detectFormat(options.input);
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
    );
    stagedSource = options.xlsxRowsPath;
    stagedFormat = "ndjson";
  }

  const instance = await DuckDBInstance.create(options.databasePath, {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    allow_unsigned_extensions: "false",
    threads: "2",
    memory_limit: "512MB",
  });
  const connection = await instance.connect();
  let closed = false;
  try {
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
        if (closed) return;
        closed = true;
        connection.closeSync();
        instance.closeSync();
        await Promise.all([
          rm(options.databasePath, { force: true }),
          rm(`${options.databasePath}.wal`, { force: true }),
          rm(options.xlsxRowsPath, { force: true }),
        ]);
      },
    };
  } catch (error) {
    connection.closeSync();
    instance.closeSync();
    await Promise.all([
      rm(options.databasePath, { force: true }),
      rm(`${options.databasePath}.wal`, { force: true }),
      rm(options.xlsxRowsPath, { force: true }),
    ]);
    throw error;
  }
}

export function isStringColumn(typeId: DuckDBTypeId): boolean {
  return (
    typeId === DuckDBTypeId.VARCHAR ||
    typeId === DuckDBTypeId.STRING_LITERAL ||
    typeId === DuckDBTypeId.ENUM
  );
}
