import type { DataRow, SupportedDataFormat } from "./types.js";

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

function normalizeRows(
  rows: readonly DataRow[],
  jsonColumns: ReadonlySet<string>,
): readonly DataRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        jsonColumns.has(key) ? normalizeJsonValue(value) : value,
      ]),
    ),
  );
}

function jsonColumns(reader: {
  columnCount: number;
  columnName(index: number): string;
  columnTypeJson(index: number): unknown;
}): ReadonlySet<string> {
  const columns = new Set<string>();
  for (let index = 0; index < reader.columnCount; index += 1) {
    const type = reader.columnTypeJson(index) as { alias?: unknown };
    if (type.alias === "JSON") columns.add(reader.columnName(index));
  }
  return columns;
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
    const rows = normalizeRows(
      reader.getRowObjectsJson() as readonly DataRow[],
      jsonColumns(reader),
    );
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
  onRow: (row: DataRow) => void,
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
        : `read_json_auto(${sqlString(path)}, format = 'auto')`;
    const result = await connection.stream(`SELECT * FROM ${source}`);
    const typedJsonColumns = jsonColumns(result);
    for await (const batch of result.yieldRowObjectJson())
      for (const row of normalizeRows(batch as readonly DataRow[], typedJsonColumns)) onRow(row);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
