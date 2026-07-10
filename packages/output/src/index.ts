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
}

function rowsFrom(data: unknown): readonly OutputRow[] {
  if (Array.isArray(data)) return data as readonly OutputRow[];
  if (typeof data === "object" && data !== null) return [data as OutputRow];
  return [{ value: data }];
}

export class Renderer {
  constructor(private readonly options: RendererOptions) {}

  render(data: unknown, meta: Readonly<Record<string, unknown>> = {}): string {
    const rows = rowsFrom(data);
    switch (this.options.format) {
      case "json":
        return renderJson({ data, meta });
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

  write(data: unknown, meta: Readonly<Record<string, unknown>> = {}): void {
    this.options.stdout.write(this.render(data, meta));
  }
}
