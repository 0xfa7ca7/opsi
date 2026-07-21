export { EXIT_CODES, KlopsiError } from "./errors.js";
export type { ExitCode, FailureExitCode, KlopsiErrorOptions } from "./errors.js";
export { duckDbMemoryLimitBytes, MAX_DUCKDB_MEMORY_BYTES } from "./duckdb-memory.js";
export {
  datasetId,
  datasetReference,
  localFileReference,
  parseCanonicalReference,
  providerId,
  resourceId,
  resourceReference,
} from "./ids.js";
export type {
  CanonicalReference,
  DatasetId,
  ParsedCanonicalReference,
  ParsedDatasetReference,
  ParsedLocalFileReference,
  ParsedResourceReference,
  ProviderId,
  ResourceId,
} from "./ids.js";
export type {
  Configuration,
  DataFile,
  Dataset,
  DatasetSummary,
  License,
  Organization,
  ProviderCapability,
  ProviderDescriptor,
  ProviderMetadata,
  Resource,
} from "./entities.js";
export type {
  DataProvider,
  MetadataCache,
  NextAction,
  ResourceAccessDescriptor,
  ResourceAccessOperation,
  ResolvedResource,
  ResolvedResourceKind,
  SearchFilters,
  SearchPage,
  SearchQuery,
  SearchSort,
} from "./provider.js";
export type {
  ConversionResult,
  DataFormat,
  DataRow,
  DataSchema,
  DownloadRecord,
  Field,
  FieldType,
  Provenance,
  QueryResult,
  TransformationRecord,
  ValidationIssue,
  ValidationResult,
  ValidationSeverity,
} from "./results.js";
export { PROVENANCE_SCHEMA_VERSION } from "./results.js";
