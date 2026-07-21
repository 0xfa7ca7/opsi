import {
  EXIT_CODES,
  KlopsiError,
  datasetId,
  providerId,
  resourceId,
  resourceReference,
  type DatasetId,
  type Resource,
} from "@klopsi/domain";
import type { OpsiResourceRecord } from "./contracts.js";

const OPSI_PROVIDER_ID = providerId("opsi");

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalSize(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

export function mapOpsiResource(record: OpsiResourceRecord, parentId?: DatasetId): Resource {
  const sourceDatasetId =
    parentId ?? (typeof record.package_id === "string" ? datasetId(record.package_id) : undefined);
  if (sourceDatasetId === undefined) {
    throw new KlopsiError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: `OPSI resource ${record.id} has no package_id.`,
      exitCode: EXIT_CODES.PROVIDER_FAILURE,
      context: { provider: "opsi", resourceId: record.id },
    });
  }
  const id = resourceId(record.id);
  const description = optionalString(record.description);
  const format = optionalString(record.format);
  const mediaType = optionalString(record.mimetype);
  const sizeBytes = optionalSize(record.size);
  const modifiedAt = optionalString(record.last_modified);
  return {
    id,
    datasetId: sourceDatasetId,
    providerId: OPSI_PROVIDER_ID,
    title: optionalString(record.name) ?? record.id,
    url: record.url,
    reference: resourceReference(OPSI_PROVIDER_ID, id),
    ...(description === undefined ? {} : { description }),
    ...(format === undefined ? {} : { format }),
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    providerMetadata: { raw: record },
  };
}
