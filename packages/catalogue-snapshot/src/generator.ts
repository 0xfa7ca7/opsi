import { EXIT_CODES, OpsiError, type DataProvider, type SearchPage } from "@opsi/domain";
import {
  CATALOGUE_SCHEMA_VERSION,
  parseCatalogueSnapshot,
  type CatalogueDataset,
  type CatalogueSnapshot,
} from "./contracts.js";
import { snapshotInvalid } from "./errors.js";
import { compareCatalogueDatasets } from "./ordering.js";

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
    let page: SearchPage;
    try {
      page = await provider.search({ limit: DATASET_PAGE_SIZE, offset });
    } catch (error) {
      if (!(error instanceof OpsiError)) throw error;
      throw new OpsiError({
        code: error.code,
        message: error.message,
        exitCode: error.exitCode,
        ...(error.suggestion === undefined ? {} : { suggestion: error.suggestion }),
        context: { ...error.context, offset },
        cause: error,
      });
    }
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

  datasets.sort(compareCatalogueDatasets);
  const snapshot: CatalogueSnapshot = {
    schemaVersion: CATALOGUE_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    count: expectedTotal,
    datasets,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`);
  return parseCatalogueSnapshot(bytes);
}

function paginationInvalid(field: string): OpsiError {
  return new OpsiError({
    code: "CATALOGUE_PAGINATION_INVALID",
    message: "Catalogue pagination validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    context: { field },
  });
}
