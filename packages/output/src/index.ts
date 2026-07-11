import { renderDelimited, type OutputRow } from "./render-delimited.js";
import { renderJson, renderNdjson } from "./render-json.js";
import { renderTable } from "./render-table.js";

export { ProgressReporter } from "./progress.js";
export type { ProgressReporterOptions, WritableOutput } from "./progress.js";
export { renderDelimited } from "./render-delimited.js";
export type { OutputRow } from "./render-delimited.js";
export { renderJson, renderNdjson, serializeJson } from "./render-json.js";
export type { JsonEnvelopeInput } from "./render-json.js";
export { renderTable } from "./render-table.js";
export { escapeUnsafeJson, sanitizeTerminalText } from "./sanitize.js";

export type OutputFormat = "human" | "json" | "ndjson" | "csv" | "tsv";

export interface RendererOptions {
  readonly format: OutputFormat;
  readonly stdout: { write(chunk: string): unknown };
  readonly fields?: readonly string[];
}

export interface RendererPageOptions {
  readonly firstPage: boolean;
  readonly defaultFields?: readonly string[];
}

function projectRecord(value: unknown, fields: readonly string[]): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.fromEntries(fields.map((field) => [field, record[field] ?? null]));
}

function project(data: unknown, fields: readonly string[] | undefined): unknown {
  if (fields === undefined || fields.length === 0) return data;
  return Array.isArray(data)
    ? data.map((value) => projectRecord(value, fields))
    : projectRecord(data, fields);
}

function rowsFrom(data: unknown): readonly OutputRow[] {
  if (Array.isArray(data)) return data as readonly OutputRow[];
  if (typeof data === "object" && data !== null) return [data as OutputRow];
  return [{ value: data }];
}

export class Renderer {
  constructor(private readonly options: RendererOptions) {}

  get format(): OutputFormat {
    return this.options.format;
  }

  get streamsPages(): boolean {
    return this.options.format !== "json";
  }

  render(
    data: unknown,
    meta: Readonly<Record<string, unknown>> = {},
    defaultFields?: readonly string[],
  ): string {
    const projected = project(data, this.options.fields ?? defaultFields);
    const rows = rowsFrom(projected);
    switch (this.options.format) {
      case "json":
        return renderJson({ data: projected, meta });
      case "ndjson":
        return renderNdjson(rows);
      case "csv":
        return renderDelimited(rows, ",");
      case "tsv":
        return renderDelimited(rows, "\t");
      case "human":
        return renderTable(rows);
    }
  }

  write(
    data: unknown,
    meta: Readonly<Record<string, unknown>> = {},
    defaultFields?: readonly string[],
  ): void {
    this.options.stdout.write(this.render(data, meta, defaultFields));
  }

  writePage(data: unknown, options: RendererPageOptions): void {
    if (!this.streamsPages) {
      throw new Error("JSON output must be written as one buffered document");
    }

    const projected = project(data, this.options.fields ?? options.defaultFields);
    const rows = rowsFrom(projected);
    switch (this.options.format) {
      case "json":
        return;
      case "ndjson":
        this.options.stdout.write(renderNdjson(rows));
        return;
      case "csv":
        this.options.stdout.write(renderDelimited(rows, ",", options.firstPage));
        return;
      case "tsv":
        this.options.stdout.write(renderDelimited(rows, "\t", options.firstPage));
        return;
      case "human":
        this.options.stdout.write(renderTable(rows, options.firstPage));
    }
  }
}
