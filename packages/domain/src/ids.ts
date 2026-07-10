import { OpsiError } from "./errors.js";

declare const providerIdBrand: unique symbol;
declare const datasetIdBrand: unique symbol;
declare const resourceIdBrand: unique symbol;
declare const canonicalReferenceBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: "ProviderId" };
export type DatasetId = string & { readonly [datasetIdBrand]: "DatasetId" };
export type ResourceId = string & { readonly [resourceIdBrand]: "ResourceId" };
export type CanonicalReference = string & {
  readonly [canonicalReferenceBrand]: "CanonicalReference";
};

function nonEmptyId<T extends string>(value: string, label: string): T {
  if (value.trim().length === 0) {
    throw new OpsiError({
      code: "INVALID_ID",
      message: `${label} cannot be empty`,
      exitCode: 2,
      context: { value },
    });
  }
  return value as T;
}

export function providerId(value: string): ProviderId {
  const id = nonEmptyId<ProviderId>(value, "Provider ID");
  if (id.includes(":")) {
    throw new OpsiError({
      code: "INVALID_ID",
      message: "Provider ID cannot contain ':'",
      exitCode: 2,
      context: { value },
    });
  }
  return id;
}

export function datasetId(value: string): DatasetId {
  return nonEmptyId<DatasetId>(value, "Dataset ID");
}

export function resourceId(value: string): ResourceId {
  return nonEmptyId<ResourceId>(value, "Resource ID");
}

export interface ParsedDatasetReference {
  readonly providerId: ProviderId;
  readonly kind: "dataset";
  readonly id: DatasetId;
}

export interface ParsedResourceReference {
  readonly providerId: ProviderId;
  readonly kind: "resource";
  readonly id: ResourceId;
}

export interface ParsedLocalFileReference {
  readonly providerId: "local";
  readonly kind: "file";
  readonly id: string;
}

export type ParsedCanonicalReference =
  ParsedDatasetReference | ParsedResourceReference | ParsedLocalFileReference;

export function datasetReference(provider: ProviderId, id: DatasetId): CanonicalReference {
  return `${provider}:dataset:${id}` as CanonicalReference;
}

export function resourceReference(provider: ProviderId, id: ResourceId): CanonicalReference {
  return `${provider}:resource:${id}` as CanonicalReference;
}

export function localFileReference(absolutePath: string): CanonicalReference {
  const path = nonEmptyId<string>(absolutePath, "File path");
  return `local:file:${path}` as CanonicalReference;
}

export function parseCanonicalReference(reference: string): ParsedCanonicalReference {
  const firstSeparator = reference.indexOf(":");
  const secondSeparator = reference.indexOf(":", firstSeparator + 1);
  const provider = reference.slice(0, firstSeparator);
  const kind = reference.slice(firstSeparator + 1, secondSeparator);
  const id = reference.slice(secondSeparator + 1);

  if (
    firstSeparator <= 0 ||
    secondSeparator <= firstSeparator + 1 ||
    id.trim().length === 0 ||
    (provider === "local" && kind !== "file") ||
    (kind !== "dataset" && kind !== "resource" && !(provider === "local" && kind === "file"))
  ) {
    throw invalidReference(reference);
  }

  if (provider === "local" && kind === "file") {
    return { providerId: "local", kind, id };
  }

  if (kind === "dataset") {
    return { providerId: providerId(provider), kind, id: datasetId(id) };
  }

  return { providerId: providerId(provider), kind: "resource", id: resourceId(id) };
}

function invalidReference(reference: string): OpsiError {
  return new OpsiError({
    code: "INVALID_REFERENCE",
    message: `Invalid canonical reference: ${reference}`,
    exitCode: 2,
    suggestion: "Use <provider>:dataset:<id>, <provider>:resource:<id>, or local:file:<path>.",
    context: { reference },
  });
}
