import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
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
    throw new KlopsiError({
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
        throw new KlopsiError({
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
  onRow: (row: DataRow) => void,
): Promise<void> {
  let rowCount = 0;
  let pending = Buffer.alloc(0);
  const consume = (lineBuffer: Buffer): void => {
    const line = lineBuffer.toString("utf8").replace(/\r$/u, "");
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new KlopsiError({
        code: "INVALID_NDJSON",
        message: "An NDJSON record cannot be parsed.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { path, row: rowCount + 1 },
        cause: error,
      });
    }
    onRow(asRow(parsed));
    rowCount += 1;
  };
  for await (const raw of createReadStream(path)) {
    const chunk = Buffer.from(raw as Uint8Array);
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline === -1 ? chunk.length : newline;
      const segment = chunk.subarray(start, end);
      if (pending.length + segment.length > options.maxRecordBytes)
        throw new KlopsiError({
          code: "VALIDATION_RECORD_TOO_LARGE",
          message: "An NDJSON record exceeds the validation byte limit.",
          exitCode: EXIT_CODES.UNSUPPORTED,
          suggestion: "Reduce the record size or convert the file to Parquet.",
          context: { limit: options.maxRecordBytes, row: rowCount + 1 },
        });
      pending = pending.length === 0 ? Buffer.from(segment) : Buffer.concat([pending, segment]);
      if (newline === -1) break;
      consume(pending);
      pending = Buffer.alloc(0);
      start = newline + 1;
    }
  }
  if (pending.length > 0) consume(pending);
}
