import { EXIT_CODES, OpsiError } from "@opsi/domain";

function safeSqlText(value: string, kind: "path" | "identifier"): string {
  if (value.includes("\0"))
    throw new OpsiError({
      code: "INVALID_CONVERSION_PATH",
      message: `The conversion ${kind} contains a NUL byte.`,
      exitCode: EXIT_CODES.INVALID_INPUT,
    });
  return value;
}

/** Quote trusted values for DuckDB syntax positions that do not accept parameters. */
export function sqlString(value: string): string {
  return `'${safeSqlText(value, "path").replaceAll("'", "''")}'`;
}

/** Quote a column name returned by DuckDB itself. */
export function sqlIdentifier(value: string): string {
  return `"${safeSqlText(value, "identifier").replaceAll('"', '""')}"`;
}
