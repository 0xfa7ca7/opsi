import type { CanonicalReference, DatasetId, ProviderId, ResourceId } from "./ids.js";

export type ProviderCapability =
  "search" | "dataset" | "resource" | "dataset-resources" | "resolve-resource";

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly name: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly description?: string;
  readonly homepage?: string;
}

export interface ProviderMetadata {
  readonly raw: Readonly<Record<string, unknown>>;
}

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
  readonly providerMetadata?: ProviderMetadata;
}

export interface Dataset extends DatasetSummary {
  readonly resources: readonly Resource[];
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
  readonly providerMetadata?: ProviderMetadata;
}

export interface DataFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType?: string;
  readonly source?: CanonicalReference;
}

export type Configuration = Readonly<Record<string, unknown>>;
