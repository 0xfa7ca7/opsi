export type ProviderId = string & { readonly __providerId: unique symbol };
export type DatasetId = string & { readonly __datasetId: unique symbol };
export type ResourceId = string & { readonly __resourceId: unique symbol };
export type CanonicalReference = string & { readonly __canonicalReference: unique symbol };
export type DataFormat = "csv" | "tsv" | "json" | "ndjson" | "xlsx" | "parquet";

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
}
export interface License {
  readonly id?: string;
  readonly name: string;
  readonly url?: string;
}
export interface Resource {
  readonly id: ResourceId;
  readonly datasetId: DatasetId;
  readonly providerId: ProviderId;
  readonly title: string;
  readonly url: string;
  readonly reference?: CanonicalReference;
  readonly description?: string;
  readonly format?: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  readonly modifiedAt?: string;
}
export interface DatasetSummary {
  readonly id: DatasetId;
  readonly providerId: ProviderId;
  readonly title: string;
  readonly reference?: CanonicalReference;
  readonly description?: string;
  readonly organization?: Organization;
  readonly license?: License;
  readonly tags?: readonly string[];
  readonly modifiedAt?: string;
  readonly resourceCount?: number;
}
export interface Dataset extends DatasetSummary {
  readonly resources: readonly Resource[];
}
export interface SearchFilters {
  readonly organization?: string;
  readonly tags?: readonly string[];
  readonly formats?: readonly string[];
  readonly license?: string;
  readonly modifiedAfter?: string;
  readonly modifiedBefore?: string;
}
export interface SearchSort {
  readonly field: string;
  readonly direction: "asc" | "desc";
}
export interface SearchQuery {
  readonly text?: string;
  readonly filters?: SearchFilters;
  readonly sort?: readonly SearchSort[];
  readonly limit?: number;
  readonly offset?: number;
}
export interface SearchPage {
  readonly items: readonly DatasetSummary[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly nextOffset?: number;
}
export type ProviderCapability =
  "search" | "dataset" | "resource" | "dataset-resources" | "resolve-resource";
export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly name: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly description?: string;
  readonly homepage?: string;
}
export interface ResolvedResource {
  readonly resource: Resource;
  readonly kind: "file" | "page" | "api" | "archive" | "service";
  readonly url: string;
  readonly reference?: CanonicalReference;
  readonly filename?: string;
  readonly format?: string;
  readonly mediaType?: string;
}
export interface DataProvider {
  readonly descriptor: ProviderDescriptor;
  search(query: SearchQuery): Promise<SearchPage>;
  getDataset(id: DatasetId): Promise<Dataset>;
  getResource(id: ResourceId): Promise<Resource>;
  listDatasetResources(id: DatasetId): Promise<readonly Resource[]>;
  resolveResource(resource: Resource): Promise<ResolvedResource>;
}
export interface DataFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType?: string;
  readonly source?: CanonicalReference;
}
export interface Field {
  readonly name: string;
  readonly type: string;
  readonly nullable?: boolean;
}
export type FieldType = string;
export type Configuration = Readonly<Record<string, unknown>>;
export type DownloadRecord = Readonly<Record<string, unknown>>;
export type Provenance = Readonly<Record<string, unknown>>;
export type QueryResult = Readonly<Record<string, unknown>>;
export type ValidationIssue = Readonly<Record<string, unknown>>;
export type ValidationResult = Readonly<Record<string, unknown>>;
export type ParsedCanonicalReference = Readonly<Record<string, unknown>>;

export class ProviderRegistry {
  constructor(providers?: readonly DataProvider[]);
  register(provider: DataProvider): void;
  get(id: string): DataProvider;
  list(): readonly ProviderDescriptor[];
}
export interface OpsiClientOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
  readonly cwd?: string;
  readonly queryWorkerPath?: string | URL;
  readonly cache?: unknown;
  readonly downloads?: Readonly<Record<string, unknown>>;
}
export class OpsiClient {
  constructor(options: OpsiClientOptions);
  readonly datasets: {
    get(id: DatasetId, providerId?: string): Promise<Dataset>;
    resources(id: DatasetId, providerId?: string): Promise<readonly Resource[]>;
  };
  readonly resources: { get(id: ResourceId, providerId?: string): Promise<Resource> };
  readonly providers: { list(): readonly ProviderDescriptor[] };
  readonly data: unknown;
  readonly conversions: unknown;
  readonly query: unknown;
  search(query: SearchQuery): Promise<SearchPage>;
}
