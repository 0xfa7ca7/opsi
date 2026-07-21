import {
  datasetId,
  datasetReference,
  providerId,
  type Dataset,
  type DatasetSummary,
  type License,
  type Organization,
} from "@klopsi/domain";
import type { KlopsiDatasetRecord } from "./contracts.js";
import { mapKlopsiResource } from "./map-resource.js";

const KLOPSI_PROVIDER_ID = providerId("klopsi");

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapOrganization(record: KlopsiDatasetRecord): Organization | undefined {
  const organization = record.organization;
  if (organization === null || organization === undefined) return undefined;
  const title = optionalString(organization.title);
  const description = optionalString(organization.description);
  return {
    id: organization.id,
    name: organization.name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  };
}

function mapLicense(record: KlopsiDatasetRecord): License | undefined {
  const name = optionalString(record.license_title) ?? optionalString(record.license_id);
  if (name === undefined) return undefined;
  const id = optionalString(record.license_id);
  return { name, ...(id === undefined ? {} : { id }) };
}

export function mapKlopsiDatasetSummary(record: KlopsiDatasetRecord): DatasetSummary {
  const id = datasetId(record.id);
  const description = optionalString(record.notes);
  const organization = mapOrganization(record);
  const license = mapLicense(record);
  const tags = record.tags?.map((tag) => tag.name);
  const modifiedAt = optionalString(record.metadata_modified);
  const resourceCount = record.resources?.length ?? record.num_resources;
  return {
    id,
    providerId: KLOPSI_PROVIDER_ID,
    title: record.title,
    reference: datasetReference(KLOPSI_PROVIDER_ID, id),
    ...(description === undefined ? {} : { description }),
    ...(organization === undefined ? {} : { organization }),
    ...(license === undefined ? {} : { license }),
    ...(tags === undefined ? {} : { tags }),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    ...(resourceCount === undefined ? {} : { resourceCount }),
    providerMetadata: { raw: record },
  };
}

export function mapKlopsiDataset(record: KlopsiDatasetRecord): Dataset {
  const summary = mapKlopsiDatasetSummary(record);
  return {
    ...summary,
    resources: (record.resources ?? []).map((resource) => mapKlopsiResource(resource, summary.id)),
  };
}
