import { datasetId, providerId, resourceId, type DataProvider, type Resource } from "@opsi/domain";
import { describe, expect, it, vi } from "vitest";
import { DownloadService, ProviderRegistry } from "../src/index.js";

const resource: Resource = {
  id: resourceId("r"),
  datasetId: datasetId("d"),
  providerId: providerId("p"),
  title: "r",
  url: "https://example.test/file",
};
function service(filename: string, offline = false) {
  const provider: DataProvider = {
    descriptor: { id: providerId("p"), name: "p", capabilities: [] },
    search: vi.fn(),
    getDataset: vi.fn(),
    getResource: vi.fn(async () => resource),
    listDatasetResources: vi.fn(),
    resolveResource: vi.fn(async () => ({ resource, kind: "file", url: resource.url, filename })),
  };
  const download = vi.fn(async (input: { destination: string }) => ({
    path: input.destination,
    finalUrl: resource.url,
    redirectChain: [resource.url],
    bytes: 1,
    sha256: "a".repeat(64),
  }));
  const probe = vi.fn();
  const provenance = { write: vi.fn(async () => "sidecar") };
  return {
    service: new DownloadService({
      registry: new ProviderRegistry([provider]),
      providerId: "p",
      downloader: { download, probe } as never,
      provenance: provenance as never,
      downloadDir: "/safe/downloads",
      limits: { maxBytes: 10, timeoutMs: 100 },
      offline,
    }),
    download,
    probe,
  };
}
describe("DownloadService containment", () => {
  it.each(["../../escape", "/absolute/escape", "..\\..\\escape", "", "CON"])(
    "sanitizes provider filename %j and fallback",
    async (filename) => {
      const fixture = service(filename);
      await fixture.service.resource(resource.id);
      const target = (fixture.download.mock.calls[0]?.[0] as { destination: string }).destination;
      expect(target.startsWith("/safe/downloads/")).toBe(true);
      expect(target.slice("/safe/downloads/".length)).not.toMatch(/[\\/]/u);
    },
  );
  it("rejects offline headers before probing", async () => {
    const fixture = service("file", true);
    await expect(fixture.service.headers(resource.id)).rejects.toMatchObject({
      code: "OFFLINE_CACHE_MISS",
    });
    expect(fixture.probe).not.toHaveBeenCalled();
  });
});
