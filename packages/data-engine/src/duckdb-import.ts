import type { DataRow, SupportedDataFormat } from "./types.js";
import { EXIT_CODES, OpsiError } from "@opsi/domain";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!/^\s*(?:"|\[|\{|true$|false$|null$|-?\d)/u.test(value)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function normalizeRows(rows: readonly DataRow[]): readonly DataRow[] {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeJsonValue(value)])),
  );
}

export async function previewWithDuckDb(
  path: string,
  format: Extract<SupportedDataFormat, "json" | "ndjson" | "parquet">,
  limit: number,
): Promise<{ readonly rows: readonly DataRow[]; readonly truncated: boolean }> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    allow_unsigned_extensions: "false",
    threads: "2",
    memory_limit: "512MB",
  });
  const connection = await instance.connect();
  try {
    const source =
      format === "parquet"
        ? `read_parquet(${sqlString(path)})`
        : `read_json_auto(${sqlString(path)}, format = '${format === "json" ? "array" : "newline_delimited"}')`;
    const reader = await connection.runAndReadAll(
      `SELECT * FROM ${source} LIMIT ${Math.max(1, limit + 1)}`,
    );
    const rows = normalizeRows(reader.getRowObjectsJson() as readonly DataRow[]);
    return { rows: rows.slice(0, limit), truncated: rows.length > limit };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

export async function validateWithDuckDb(
  path: string,
  format: Extract<SupportedDataFormat, "json" | "ndjson" | "parquet">,
): Promise<void> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    allow_unsigned_extensions: "false",
    threads: "2",
    memory_limit: "512MB",
  });
  const connection = await instance.connect();
  try {
    const source =
      format === "parquet"
        ? `read_parquet(${sqlString(path)})`
        : `read_json_auto(${sqlString(path)}, format = '${format === "json" ? "array" : "newline_delimited"}')`;
    await connection.runAndReadAll(`SELECT count(*) FROM ${source}`);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

export async function scanWithDuckDb(
  path: string,
  format: Extract<SupportedDataFormat, "json" | "parquet">,
  maxRecords: number,
): Promise<readonly DataRow[]> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    allow_unsigned_extensions: "false",
    threads: "2",
    memory_limit: "512MB",
  });
  const connection = await instance.connect();
  try {
    const source =
      format === "parquet"
        ? `read_parquet(${sqlString(path)})`
        : `read_json_auto(${sqlString(path)}, format = 'auto')`;
    const reader = await connection.runAndReadAll(
      `SELECT * FROM ${source} LIMIT ${maxRecords + 1}`,
    );
    const rows = normalizeRows(reader.getRowObjectsJson() as readonly DataRow[]);
    if (rows.length > maxRecords)
      throw new OpsiError({
        code: "VALIDATION_RECORD_LIMIT",
        message: "Validation record limit exceeded.",
        exitCode: EXIT_CODES.UNSUPPORTED,
        suggestion: "Split the input into smaller files and validate each part.",
        context: { limit: maxRecords },
      });
    return rows;
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
