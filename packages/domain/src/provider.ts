import type { Dataset, DatasetSummary, ProviderDescriptor, Resource } from "./entities.js";
import type { CanonicalReference, DatasetId, ResourceId } from "./ids.js";

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

export type ResolvedResourceKind = "file" | "page" | "api" | "archive" | "service";

export interface ResolvedResource {
  readonly resource: Resource;
  readonly kind: ResolvedResourceKind;
  readonly url: string;
  readonly reference?: CanonicalReference;
  readonly filename?: string;
  readonly format?: string;
  readonly mediaType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface DataProvider {
  readonly descriptor: ProviderDescriptor;

  search(query: SearchQuery): Promise<SearchPage>;
  getDataset(id: DatasetId): Promise<Dataset>;
  getResource(id: ResourceId): Promise<Resource>;
  listDatasetResources(id: DatasetId): Promise<readonly Resource[]>;
  resolveResource(resource: Resource): Promise<ResolvedResource>;
}

export interface MetadataCache {
  get<T>(key: string, schemaVersion: string): Promise<T | undefined>;
  set<T>(key: string, schemaVersion: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}
