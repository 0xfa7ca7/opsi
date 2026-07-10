export type SupportedDataFormat = "csv" | "tsv" | "json" | "ndjson" | "xlsx" | "parquet";
export type DetectedInputFormat = SupportedDataFormat | "zip" | "unknown";
export type DetectionConfidence = "signature" | "media-type" | "content" | "extension" | "unknown";

export interface DataSource {
  readonly path: string;
  readonly mediaType?: string;
  readonly declaredFormat?: string;
}

export type DataInput = string | DataSource;

export interface FormatDetection {
  readonly path: string;
  readonly format: DetectedInputFormat;
  readonly confidence: DetectionConfidence;
  readonly mediaType?: string;
  readonly extension?: string;
}

export type DataRow = Readonly<Record<string, unknown>>;

export interface PreviewOptions {
  readonly limit?: number;
  readonly sheet?: string;
}

export interface DataPreview {
  readonly format: SupportedDataFormat;
  readonly columns: readonly string[];
  readonly rows: readonly DataRow[];
  readonly returnedCount: number;
  readonly truncated: boolean;
  readonly sheet?: string;
  readonly warnings: readonly ValidationIssue[];
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
  readonly format: SupportedDataFormat;
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
}
