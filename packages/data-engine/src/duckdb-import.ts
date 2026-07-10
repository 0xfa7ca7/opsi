import type { DataRow, SupportedDataFormat } from "./types.js";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
    const rows = reader.getRowObjectsJson() as readonly DataRow[];
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
