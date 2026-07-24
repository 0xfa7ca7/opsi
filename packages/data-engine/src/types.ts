import type { ConversionResult as DomainConversionResult } from "@klopsi/domain";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

export type SupportedDataFormat = "csv" | "tsv" | "json" | "ndjson" | "xlsx" | "parquet";
export const SUPPORTED_DATA_FORMATS = ["csv", "tsv", "json", "ndjson", "xlsx", "parquet"] as const;
export type SupportedInputFormat = SupportedDataFormat | "xml" | "pcaxis";
export type DetectedInputFormat = SupportedInputFormat | "zip" | "unknown";
export type DetectionConfidence =
  "signature" | "media-type" | "content" | "declared-format" | "extension" | "unknown";
export type DetectedTextEncoding = import("./text-decoding.js").TextEncoding | "windows-1250";

export interface DataSource {
  readonly path: string;
  readonly mediaType?: string;
  readonly declaredFormat?: string;
  readonly sha256?: string;
}

export type DataInput = string | DataSource;

export interface FormatDetection {
  readonly path: string;
  readonly format: DetectedInputFormat;
  readonly confidence: DetectionConfidence;
  readonly mediaType?: string;
  readonly extension?: string;
  readonly encoding?: DetectedTextEncoding;
  readonly delimiter?: import("./text-decoding.js").DelimitedDialect;
}

export type DataRow = Readonly<Record<string, unknown>>;

export interface PreviewOptions {
  readonly limit?: number;
  readonly sheet?: string;
  readonly recordPath?: string;
}

export interface DataPreview {
  readonly format: SupportedInputFormat;
  readonly columns: readonly string[];
  readonly rows: readonly DataRow[];
  readonly returnedCount: number;
  readonly truncated: boolean;
  readonly sheet?: string;
  readonly warnings: readonly ValidationIssue[];
  readonly encoding?: DetectedTextEncoding;
  readonly delimiter?: import("./text-decoding.js").DelimitedDialect;
}

export interface DataInspection extends FormatDetection {
  readonly sizeBytes: number;
  readonly sheets?: readonly string[];
}

export type InferredFieldType = "boolean" | "integer" | "double" | "date" | "timestamp" | "string";

export interface InferredField {
  readonly name: string;
  readonly type: InferredFieldType;
  readonly nullable: boolean;
  readonly evidence: readonly unknown[];
}

export interface InferredSchema {
  readonly fields: readonly InferredField[];
  readonly sampledRows: number;
  readonly format: SupportedInputFormat;
  readonly sheet?: string;
}

export type ValidationSeverity = "error" | "warning" | "recommendation";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly recommendation: string;
  readonly row?: number;
  readonly column?: number;
  readonly field?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface DataValidationResult {
  readonly valid: boolean;
  readonly format?: DetectedInputFormat;
  readonly issues: readonly ValidationIssue[];
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly recommendations: readonly ValidationIssue[];
  readonly schema?: InferredSchema;
}

export interface DataEngineOptions {
  readonly defaultPreviewLimit?: number;
  readonly jsonNativeByteLimit?: number;
  readonly xlsxSharedStringsByteLimit?: number;
  readonly onAdapter?: (name: string) => void;
  readonly validationMaxRecords?: number;
  readonly validationMaxRecordBytes?: number;
  readonly validationMaxTotalBytes?: number;
  readonly validationMaxColumns?: number;
  readonly validationMaxStateBytes?: number;
  readonly validationMaxIssueGroups?: number;
  readonly conversionFileSystem?: Partial<ConversionFileSystem>;
  readonly conversionStageClose?: (close: () => Promise<void>) => Promise<void>;
  readonly xmlLimits?: import("./xml.js").XmlLimits;
  readonly pcAxisLimits?: import("./pcaxis.js").PcAxisLimits;
}

export interface ConversionFileSystem {
  mkdir(
    path: string,
    options: { readonly recursive: true; readonly mode: number },
  ): Promise<string | undefined>;
  lstat(path: string): Promise<Stats>;
  open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(
    path: string,
    options: { readonly force: boolean; readonly recursive?: boolean },
  ): Promise<void>;
}

export interface ConversionOptions {
  readonly input: DataInput;
  readonly output: string;
  readonly targetFormat: SupportedDataFormat;
  readonly sheet?: string;
  readonly recordPath?: string;
  readonly force: boolean;
  readonly spreadsheetSafe?: boolean;
}

export interface ConversionResult extends DomainConversionResult {
  readonly provenancePath: string;
  readonly warnings: readonly ValidationIssue[];
}
