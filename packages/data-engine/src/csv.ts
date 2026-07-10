import { createReadStream } from "node:fs";
import { parse } from "csv-parse";

export interface DelimitedReadResult {
  readonly headers: readonly string[];
  readonly records: readonly (readonly string[])[];
  readonly widths: readonly number[];
  readonly truncated: boolean;
}

export async function readDelimited(
  path: string,
  delimiter: "," | "\t",
  options: { readonly limit?: number; readonly relaxed?: boolean } = {},
): Promise<DelimitedReadResult> {
  const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
  const source = createReadStream(path);
  const parser = parse({
    bom: true,
    delimiter,
    relax_column_count: options.relaxed ?? false,
    skip_empty_lines: true,
    max_record_size: 16 * 1024 * 1024,
  });
  source.pipe(parser);
  const parsed: string[][] = [];
  try {
    for await (const raw of parser) {
      parsed.push((raw as unknown[]).map((value) => String(value)));
      if (parsed.length >= limit + 2) {
        source.destroy();
        parser.destroy();
        break;
      }
    }
  } finally {
    source.destroy();
  }
  const headers = parsed[0] ?? [];
  const allRecords = parsed.slice(1);
  return {
    headers,
    records: allRecords.slice(0, limit),
    widths: allRecords.map((record) => record.length),
    truncated: allRecords.length > limit,
  };
}

export function recordsToRows(
  headers: readonly string[],
  records: readonly (readonly unknown[])[],
): readonly Readonly<Record<string, unknown>>[] {
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] ?? null])),
  );
}
