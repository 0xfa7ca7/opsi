import { stat } from "node:fs/promises";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { readDelimited, recordsToRows } from "./csv.js";
import { detectFormat } from "./detect.js";
import { previewWithDuckDb } from "./duckdb-import.js";
import { previewNativeJson, previewNdjson } from "./json.js";
import { normalizeInput } from "./sample.js";
import type {
  DataEngineOptions,
  DataInput,
  DataInspection,
  DataPreview,
  DataRow,
  InferredFieldType,
  InferredSchema,
  PreviewOptions,
  SupportedDataFormat,
} from "./types.js";
import { listSheets, previewXlsx } from "./xlsx.js";
import { validateData } from "./validate.js";

function supported(format: string): format is SupportedDataFormat {
  return ["csv", "tsv", "json", "ndjson", "xlsx", "parquet"].includes(format);
}

function unsupported(format: string): never {
  const archive = format === "zip";
  throw new OpsiError({
    code: archive ? "DOWNLOAD_ONLY_FORMAT" : "UNSUPPORTED_FORMAT",
    message: archive
      ? "ZIP archives are download-only and cannot be previewed directly."
      : `The detected format '${format}' is not supported for data inspection.`,
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion: archive
      ? "Download the archive, extract a supported tabular file, then preview that file."
      : "Download or convert the resource to CSV, TSV, JSON, NDJSON, XLSX, or Parquet.",
    context: { format },
  });
}

function columnsFor(rows: readonly DataRow[]): readonly string[] {
  const columns = new Set<string>();
  for (const row of rows) for (const column of Object.keys(row)) columns.add(column);
  return [...columns];
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function inferredType(value: unknown): InferredFieldType | "null" {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "double";
  if (value instanceof Date) return "timestamp";
  const text = String(value).trim();
  if (/^(?:true|false)$/iu.test(text)) return "boolean";
  if (/^[+-]?\d+$/u.test(text)) return "integer";
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+[eE][+-]?\d+)$/u.test(text)) return "double";
  if (validCalendarDate(text)) return "date";
  if (/^\d{4}-\d{2}-\d{2}T/u.test(text) && !Number.isNaN(Date.parse(text))) return "timestamp";
  return "string";
}

function mergeTypes(types: readonly InferredFieldType[]): InferredFieldType {
  const unique = new Set(types);
  if (unique.size === 0) return "string";
  if (unique.size === 1) return types[0] ?? "string";
  if ([...unique].every((type) => type === "integer" || type === "double")) return "double";
  return "string";
}

export class DataEngine {
  private readonly defaultPreviewLimit: number;
  private readonly jsonNativeByteLimit: number;
  private readonly xlsxSharedStringsByteLimit: number;

  constructor(private readonly options: DataEngineOptions = {}) {
    this.defaultPreviewLimit = options.defaultPreviewLimit ?? 20;
    this.jsonNativeByteLimit = options.jsonNativeByteLimit ?? 1024 * 1024;
    this.xlsxSharedStringsByteLimit = options.xlsxSharedStringsByteLimit ?? 16 * 1024 * 1024;
  }

  async inspect(input: DataInput): Promise<DataInspection> {
    const detection = await detectFormat(input);
    const details = await stat(detection.path);
    const sheets =
      detection.format === "xlsx"
        ? await listSheets(detection.path, this.xlsxSharedStringsByteLimit)
        : undefined;
    return {
      ...detection,
      sizeBytes: details.size,
      ...(sheets === undefined ? {} : { sheets }),
    };
  }

  async preview(input: DataInput, options: PreviewOptions = {}): Promise<DataPreview> {
    const limit = options.limit ?? this.defaultPreviewLimit;
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new OpsiError({
        code: "INVALID_PREVIEW_LIMIT",
        message: "Preview row limit must be a positive integer.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    const detection = await detectFormat(input);
    if (!supported(detection.format)) unsupported(detection.format);
    if (detection.format === "csv" || detection.format === "tsv") {
      this.options.onAdapter?.(detection.format);
      const parsed = await readDelimited(detection.path, detection.format === "csv" ? "," : "\t", {
        limit,
      });
      const rows = recordsToRows(parsed.headers, parsed.records);
      return {
        format: detection.format,
        columns: parsed.headers,
        rows,
        returnedCount: rows.length,
        truncated: parsed.truncated,
        warnings: [],
      };
    }
    if (detection.format === "xlsx") {
      this.options.onAdapter?.("xlsx");
      const preview = await previewXlsx(
        detection.path,
        options.sheet,
        limit,
        this.xlsxSharedStringsByteLimit,
      );
      return { format: "xlsx", ...preview, returnedCount: preview.rows.length };
    }
    let result: { readonly rows: readonly DataRow[]; readonly truncated: boolean };
    if (detection.format === "ndjson") {
      if ((await stat(detection.path)).size <= this.jsonNativeByteLimit) {
        this.options.onAdapter?.("ndjson");
        result = await previewNdjson(detection.path, limit);
      } else {
        this.options.onAdapter?.("duckdb-ndjson");
        result = await previewWithDuckDb(detection.path, "ndjson", limit);
      }
    } else if (
      detection.format === "json" &&
      (await stat(detection.path)).size <= this.jsonNativeByteLimit
    ) {
      this.options.onAdapter?.("native-json");
      result = await previewNativeJson(detection.path, limit);
    } else {
      this.options.onAdapter?.(detection.format === "json" ? "duckdb-json" : "duckdb-parquet");
      result = await previewWithDuckDb(detection.path, detection.format, limit);
    }
    const columns = columnsFor(result.rows);
    return {
      format: detection.format,
      columns,
      rows: result.rows,
      returnedCount: result.rows.length,
      truncated: result.truncated,
      warnings: [],
    };
  }

  async inferSchema(input: DataInput, options: PreviewOptions = {}): Promise<InferredSchema> {
    const preview = await this.preview(input, { ...options, limit: options.limit ?? 500 });
    const fields = preview.columns.map((name) => {
      const values = preview.rows.map((row) => row[name]);
      const nonNull = values.filter((value) => inferredType(value) !== "null");
      const evidence = [...new Set(nonNull.map((value) => JSON.stringify(value)))]
        .slice(0, 3)
        .map((value) => JSON.parse(value) as unknown);
      return {
        name,
        type: mergeTypes(nonNull.map((value) => inferredType(value) as InferredFieldType)),
        nullable: preview.truncated || nonNull.length !== values.length,
        evidence,
      };
    });
    return {
      fields,
      sampledRows: preview.rows.length,
      format: preview.format,
      ...(preview.sheet === undefined ? {} : { sheet: preview.sheet }),
    };
  }

  validate(input: DataInput, options: PreviewOptions = {}) {
    return validateData(this, normalizeInput(input), options, {
      maxRecords: 100_000,
      maxRecordBytes: 16 * 1024 * 1024,
      xlsxSharedStringsByteLimit: this.xlsxSharedStringsByteLimit,
    });
  }
}
