import {
  datasetId,
  providerId,
  resourceId,
  type DataProvider,
  type Dataset,
  type Resource,
  type SearchPage,
} from "@klopsi/domain";
import { describe, expect, it, vi } from "vitest";
import { KlopsiClient, ProviderRegistry } from "../src/index.js";

function provider(id = "fixture"): DataProvider {
  const provider = providerId(id);
  const resource: Resource = {
    id: resourceId("resource-1"),
    datasetId: datasetId("dataset-1"),
    providerId: provider,
    title: "Resource",
    url: "https://example.invalid/data.csv",
  };
  const dataset: Dataset = {
    id: datasetId("dataset-1"),
    providerId: provider,
    title: "Dataset",
    resources: [resource],
  };
  const page: SearchPage = { items: [dataset], total: 1, limit: 10, offset: 0 };
  return {
    descriptor: { id: provider, name: "Fixture", capabilities: ["search", "dataset"] },
    search: vi.fn(async () => page),
    getDataset: vi.fn(async () => dataset),
    getResource: vi.fn(async () => resource),
    listDatasetResources: vi.fn(async () => [resource]),
    resolveResource: vi.fn(async (value) => ({ resource: value, kind: "file", url: value.url })),
  };
}

describe("catalogue client", () => {
  it("routes catalogue methods through the selected provider", async () => {
    const fixture = provider();
    const registry = new ProviderRegistry([fixture]);
    const client = new KlopsiClient({ registry, providerId: "fixture" });

    await expect(client.search({ text: "promet" })).resolves.toMatchObject({ total: 1 });
    await expect(client.datasets.get(datasetId("dataset-1"))).resolves.toMatchObject({
      title: "Dataset",
    });
    await expect(client.datasets.resources(datasetId("dataset-1"))).resolves.toHaveLength(1);
    await expect(client.resources.get(resourceId("resource-1"))).resolves.toMatchObject({
      title: "Resource",
    });
    expect(client.providers.list()).toEqual([fixture.descriptor]);
    expect(fixture.search).toHaveBeenCalledWith({ text: "promet" });
  });

  it("reports an unknown provider as invalid input", () => {
    const registry = new ProviderRegistry([provider()]);
    expect(() => registry.get("missing")).toThrowError(
      expect.objectContaining({ code: "PROVIDER_NOT_FOUND", exitCode: 2 }),
    );
  });

  it("rejects duplicate provider registrations", () => {
    const fixture = provider();
    expect(() => new ProviderRegistry([fixture, fixture])).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_PROVIDER", exitCode: 2 }),
    );
  });
});
