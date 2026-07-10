import type { DataFile } from "./entities.js";
import type { CanonicalReference, DatasetId, ProviderId, ResourceId } from "./ids.js";

export type DataFormat = "csv" | "tsv" | "json" | "ndjson" | "xlsx" | "parquet";

export type FieldType =
  "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "null" | "mixed";

export interface Field {
  readonly name: string;
  readonly type: FieldType;
  readonly nullable: boolean;
  readonly description?: string;
}

export interface DataSchema {
  readonly fields: readonly Field[];
  readonly rowCount?: number;
}

export type ValidationSeverity = "error" | "warning" | "recommendation";

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: ValidationSeverity;
  readonly row?: number;
  readonly field?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly warnings: readonly ValidationIssue[];
  readonly recommendations: readonly ValidationIssue[];
  readonly schema?: DataSchema;
}

export interface TransformationRecord {
  readonly operation: string;
  readonly timestamp: string;
  readonly inputSha256?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface Provenance {
  readonly schemaVersion: string;
  readonly providerId?: ProviderId;
  readonly datasetId?: DatasetId;
  readonly resourceId?: ResourceId;
  readonly sourceUrl?: string;
  readonly title?: string;
  readonly organization?: string;
  readonly retrievedAt: string;
  readonly sourceModifiedAt?: string;
  readonly sha256: string;
  readonly mediaType?: string;
  readonly localPath: string;
  readonly transformations: readonly TransformationRecord[];
}

export interface DownloadRecord {
  readonly file: DataFile;
  readonly source: CanonicalReference;
  readonly downloadedAt: string;
  readonly provenance: Provenance;
}

export type DataRow = Readonly<Record<string, unknown>>;

export interface QueryResult {
  readonly sql: string;
  readonly columns: readonly string[];
  readonly rows: readonly DataRow[];
  readonly returnedCount: number;
  readonly totalCount?: number;
  readonly durationMs: number;
  readonly truncated: boolean;
  readonly source?: CanonicalReference;
  readonly provenance?: Provenance;
}

export interface ConversionResult {
  readonly input: string;
  readonly output: string;
  readonly targetFormat: DataFormat;
  readonly bytesWritten?: number;
  readonly provenance: Provenance;
}
