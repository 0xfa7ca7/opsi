import {
  datasetId,
  EXIT_CODES,
  KlopsiError,
  providerId,
  type DataProvider,
  type DatasetSummary,
  type SearchPage,
  type SearchQuery,
} from "@klopsi/domain";
import { describe, expect, it, vi } from "vitest";
import { generateCatalogueSnapshot } from "@klopsi/catalogue-snapshot";

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

  it("sorts Unicode names and IDs by code unit without calling localeCompare", async () => {
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("locale-sensitive comparison must not be used");
    });
    const { provider } = providerForPages(
      new Map([
        [
          0,
          page(0, 4, [
            dataset("Ć", "C acute ID", "same"),
            dataset("b", "C acute", "Ć"),
            dataset("Ç", "C cedilla ID", "same"),
            dataset("a", "C cedilla", "Ç"),
          ]),
        ],
      ]),
    );

    const snapshot = await generateCatalogueSnapshot(provider, { generatedAt });

    expect(snapshot.datasets.map(({ name, id }) => [name, id])).toEqual([
      ["same", "Ç"],
      ["same", "Ć"],
      ["Ç", "a"],
      ["Ć", "b"],
    ]);
    expect(localeCompare).not.toHaveBeenCalled();
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

  it("adds the failing page offset to provider diagnostics", async () => {
    const upstream = new KlopsiError({
      code: "PROVIDER_REQUEST_FAILED",
      message: "KLOPSI response body timed out.",
      exitCode: EXIT_CODES.PROVIDER_FAILURE,
      context: { provider: "klopsi", operation: "package_search", status: 200 },
      cause: new Error("secret upstream response body"),
    });
    const search = vi.fn(async (query: SearchQuery): Promise<SearchPage> => {
      if (query.offset === 0) {
        return page(0, 2, [dataset("a", "Alpha", "alpha")], 300);
      }
      throw upstream;
    });
    const provider = { search } as unknown as DataProvider;

    let received: unknown;
    try {
      await generateCatalogueSnapshot(provider, { generatedAt });
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(KlopsiError);
    if (!(received instanceof KlopsiError)) throw new Error("expected KlopsiError");
    expect(received.toJSON()).toEqual({
      code: "PROVIDER_REQUEST_FAILED",
      message: "KLOPSI response body timed out.",
      exitCode: EXIT_CODES.PROVIDER_FAILURE,
      context: {
        provider: "klopsi",
        operation: "package_search",
        status: 200,
        offset: 300,
      },
    });
    expect(JSON.stringify(received)).not.toContain("secret upstream response body");
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
    providerId: providerId("klopsi"),
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
