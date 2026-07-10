import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type { DataRow } from "./types.js";

function asRow(value: unknown): DataRow {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as DataRow)
    : { value };
}

export async function previewNativeJson(
  path: string,
  limit: number,
): Promise<{ readonly rows: readonly DataRow[]; readonly truncated: boolean }> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new OpsiError({
      code: "INVALID_JSON",
      message: "The JSON file cannot be parsed.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      context: { path },
      cause: error,
    });
  }
  const values = Array.isArray(value) ? value : [value];
  return { rows: values.slice(0, limit).map(asRow), truncated: values.length > limit };
}

export async function previewNdjson(
  path: string,
  limit: number,
): Promise<{ readonly rows: readonly DataRow[]; readonly truncated: boolean }> {
  const rows: DataRow[] = [];
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        rows.push(asRow(JSON.parse(line) as unknown));
      } catch (error) {
        throw new OpsiError({
          code: "INVALID_NDJSON",
          message: "An NDJSON record cannot be parsed.",
          exitCode: EXIT_CODES.INVALID_INPUT,
          context: { path, row: rows.length + 1 },
          cause: error,
        });
      }
      if (rows.length > limit) {
        lines.close();
        input.destroy();
        break;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}
