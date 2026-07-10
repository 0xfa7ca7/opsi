import {
  datasetId,
  datasetReference,
  providerId,
  type Dataset,
  type DatasetSummary,
  type License,
  type Organization,
} from "@opsi/domain";
import type { OpsiDatasetRecord } from "./contracts.js";
import { mapOpsiResource } from "./map-resource.js";

const OPSI_PROVIDER_ID = providerId("opsi");

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapOrganization(record: OpsiDatasetRecord): Organization | undefined {
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

function mapLicense(record: OpsiDatasetRecord): License | undefined {
  const name = optionalString(record.license_title) ?? optionalString(record.license_id);
  if (name === undefined) return undefined;
  const id = optionalString(record.license_id);
  return { name, ...(id === undefined ? {} : { id }) };
}

export function mapOpsiDatasetSummary(record: OpsiDatasetRecord): DatasetSummary {
  const id = datasetId(record.id);
  const description = optionalString(record.notes);
  const organization = mapOrganization(record);
  const license = mapLicense(record);
  const tags = record.tags?.map((tag) => tag.name);
  const modifiedAt = optionalString(record.metadata_modified);
  const resourceCount = record.resources?.length ?? record.num_resources;
  return {
    id,
    providerId: OPSI_PROVIDER_ID,
    title: record.title,
    reference: datasetReference(OPSI_PROVIDER_ID, id),
    ...(description === undefined ? {} : { description }),
    ...(organization === undefined ? {} : { organization }),
    ...(license === undefined ? {} : { license }),
    ...(tags === undefined ? {} : { tags }),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    ...(resourceCount === undefined ? {} : { resourceCount }),
    providerMetadata: { raw: record },
  };
}

export function mapOpsiDataset(record: OpsiDatasetRecord): Dataset {
  const summary = mapOpsiDatasetSummary(record);
  return {
    ...summary,
    resources: (record.resources ?? []).map((resource) => mapOpsiResource(resource, summary.id)),
  };
}
