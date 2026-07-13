import { EXIT_CODES, OpsiError, type DataProvider } from "@opsi/domain";
import {
  CATALOGUE_SCHEMA_VERSION,
  parseCatalogueSnapshot,
  type CatalogueDataset,
  type CatalogueSnapshot,
} from "./contracts.js";

const DATASET_PAGE_SIZE = 300;

export interface GenerateCatalogueSnapshotOptions {
  readonly generatedAt: string;
}

export async function generateCatalogueSnapshot(
  provider: DataProvider,
  options: GenerateCatalogueSnapshotOptions,
): Promise<CatalogueSnapshot> {
  const datasets: CatalogueDataset[] = [];
  let offset = 0;
  let expectedTotal: number | undefined;

  while (true) {
    const page = await provider.search({ limit: DATASET_PAGE_SIZE, offset });
    if (expectedTotal === undefined) {
      expectedTotal = page.total;
    } else if (page.total !== expectedTotal) {
      throw paginationInvalid("total");
    }

    for (const item of page.items) {
      const name = item.providerMetadata?.raw.name;
      if (typeof name !== "string" || name.length === 0) {
        throw snapshotInvalid(`datasets.${datasets.length}.name`);
      }
      datasets.push({ id: item.id, title: item.title, name });
    }

    if (page.nextOffset === undefined) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) {
      throw paginationInvalid("nextOffset");
    }
    offset = page.nextOffset;
  }

  if (datasets.length !== expectedTotal) {
    throw paginationInvalid("total");
  }

  datasets.sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  const snapshot: CatalogueSnapshot = {
    schemaVersion: CATALOGUE_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    count: expectedTotal,
    datasets,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`);
  return parseCatalogueSnapshot(bytes);
}

function snapshotInvalid(field: string): OpsiError {
  return new OpsiError({
    code: "CATALOGUE_SNAPSHOT_INVALID",
    message: "Catalogue snapshot validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    context: { field },
  });
}

function paginationInvalid(field: string): OpsiError {
  return new OpsiError({
    code: "CATALOGUE_PAGINATION_INVALID",
    message: "Catalogue pagination validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    context: { field },
  });
}
