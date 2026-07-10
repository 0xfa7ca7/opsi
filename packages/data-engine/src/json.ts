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

export async function scanNdjson(
  path: string,
  options: { readonly maxRecords: number; readonly maxRecordBytes: number },
): Promise<readonly DataRow[]> {
  const rows: DataRow[] = [];
  let pending = Buffer.alloc(0);
  const consume = (lineBuffer: Buffer): void => {
    const line = lineBuffer.toString("utf8").replace(/\r$/u, "");
    if (line.trim().length === 0) return;
    if (rows.length >= options.maxRecords)
      throw new OpsiError({
        code: "VALIDATION_RECORD_LIMIT",
        message: "Validation record limit exceeded.",
        exitCode: EXIT_CODES.UNSUPPORTED,
        suggestion: "Split the input into smaller files and validate each part.",
        context: { limit: options.maxRecords },
      });
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
  };
  for await (const raw of createReadStream(path)) {
    const chunk = Buffer.from(raw as Uint8Array);
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline === -1 ? chunk.length : newline;
      const segment = chunk.subarray(start, end);
      if (pending.length + segment.length > options.maxRecordBytes)
        throw new OpsiError({
          code: "VALIDATION_RECORD_TOO_LARGE",
          message: "An NDJSON record exceeds the validation byte limit.",
          exitCode: EXIT_CODES.UNSUPPORTED,
          suggestion: "Reduce the record size or convert the file to Parquet.",
          context: { limit: options.maxRecordBytes, row: rows.length + 1 },
        });
      pending = pending.length === 0 ? Buffer.from(segment) : Buffer.concat([pending, segment]);
      if (newline === -1) break;
      consume(pending);
      pending = Buffer.alloc(0);
      start = newline + 1;
    }
  }
  if (pending.length > 0) consume(pending);
  return rows;
}
