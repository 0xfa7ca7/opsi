import {
  datasetId,
  providerId,
  type DataProvider,
  type DatasetSummary,
  type SearchPage,
  type SearchQuery,
} from "@opsi/domain";
import { describe, expect, it, vi } from "vitest";
import { generateCatalogueSnapshot } from "@opsi/catalogue-snapshot";

const generatedAt = "2026-07-13T12:00:00.000Z";

describe("generateCatalogueSnapshot", () => {
  it("follows provider offsets serially, projects raw names, and sorts by name then ID", async () => {
    const pages = new Map<number, SearchPage>([
      [0, page(0, 4, [dataset("z", "Zulu", "same")], 300)],
      [300, page(300, 4, [dataset("b", "Beta", "same"), dataset("c", "Charlie", "zulu")], 600)],
      [600, page(600, 4, [dataset("a", "Alpha", "alpha")])],
    ]);
    const { provider, search } = providerForPages(pages);

    const snapshot = await generateCatalogueSnapshot(provider, { generatedAt });

    expect(search.mock.calls.map(([query]) => query)).toEqual([
      { limit: 300, offset: 0 },
      { limit: 300, offset: 300 },
      { limit: 300, offset: 600 },
    ]);
    expect(snapshot).toEqual({
      schemaVersion: "1",
      generatedAt,
      count: 4,
      datasets: [
        { id: "a", title: "Alpha", name: "alpha" },
        { id: "b", title: "Beta", name: "same" },
        { id: "z", title: "Zulu", name: "same" },
        { id: "c", title: "Charlie", name: "zulu" },
      ],
    });
  });

  it.each([
    ["missing", undefined],
    ["non-string", 42],
    ["empty", ""],
  ])("rejects a %s raw dataset name", async (_description, name) => {
    const item = dataset("a", "Alpha", name);
    const { provider } = providerForPages(new Map([[0, page(0, 1, [item])]]));

    await expect(generateCatalogueSnapshot(provider, { generatedAt })).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_INVALID",
      exitCode: 4,
      context: { field: "datasets.0.name" },
    });
  });

  it("rejects a non-advancing provider offset", async () => {
    const { provider } = providerForPages(
      new Map([[0, page(0, 2, [dataset("a", "Alpha", "alpha")], 0)]]),
    );

    await expect(generateCatalogueSnapshot(provider, { generatedAt })).rejects.toMatchObject({
      code: "CATALOGUE_PAGINATION_INVALID",
      exitCode: 4,
      context: { field: "nextOffset" },
    });
  });

  it("rejects totals that change between pages", async () => {
    const { provider } = providerForPages(
      new Map([
        [0, page(0, 2, [dataset("a", "Alpha", "alpha")], 300)],
        [300, page(300, 3, [dataset("b", "Beta", "beta")])],
      ]),
    );

    await expect(generateCatalogueSnapshot(provider, { generatedAt })).rejects.toMatchObject({
      code: "CATALOGUE_PAGINATION_INVALID",
      exitCode: 4,
      context: { field: "total" },
    });
  });

  it("rejects a final record count different from the first-page total", async () => {
    const { provider } = providerForPages(
      new Map([[0, page(0, 2, [dataset("a", "Alpha", "alpha")])]]),
    );

    await expect(generateCatalogueSnapshot(provider, { generatedAt })).rejects.toMatchObject({
      code: "CATALOGUE_PAGINATION_INVALID",
      exitCode: 4,
      context: { field: "total" },
    });
  });
});

function dataset(id: string, title: string, name: unknown): DatasetSummary {
  return {
    id: datasetId(id),
    providerId: providerId("opsi"),
    title,
    providerMetadata: { raw: name === undefined ? {} : { name } },
  };
}

function page(
  offset: number,
  total: number,
  items: readonly DatasetSummary[],
  nextOffset?: number,
): SearchPage {
  return {
    items,
    total,
    limit: 300,
    offset,
    ...(nextOffset === undefined ? {} : { nextOffset }),
  };
}

function providerForPages(pages: ReadonlyMap<number, SearchPage>): {
  readonly provider: DataProvider;
  readonly search: ReturnType<typeof vi.fn<(query: SearchQuery) => Promise<SearchPage>>>;
} {
  const search = vi.fn(async (query: SearchQuery): Promise<SearchPage> => {
    const result = pages.get(query.offset ?? 0);
    if (result === undefined) throw new Error(`Unexpected offset ${String(query.offset)}`);
    return result;
  });
  return { provider: { search } as unknown as DataProvider, search };
}
