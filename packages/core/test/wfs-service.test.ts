import { writeFile } from "node:fs/promises";
import { datasetId, providerId, resourceId, type DataProvider, type Resource } from "@opsi/domain";
import { describe, expect, it, vi } from "vitest";
import { ProviderRegistry } from "../src/registry.js";
import { WfsService } from "../src/wfs/service.js";

const resource: Resource = {
  id: resourceId("wfs"),
  datasetId: datasetId("dataset"),
  providerId: providerId("fixture"),
  title: "WFS",
  url: "https://example.test/wfs",
  format: "WFS",
  reference: "fixture:resource:wfs",
};

function provider(): DataProvider {
  return {
    descriptor: { id: providerId("fixture"), name: "fixture", capabilities: [] },
    search: vi.fn(),
    getDataset: vi.fn(),
    listDatasetResources: vi.fn(),
    getResource: vi.fn(async () => resource),
    resolveResource: vi.fn(async () => ({ resource, kind: "service", url: resource.url })),
  };
}

describe("secure WFS service", () => {
  it("caches metadata, validates fields, and performs bounded read-only requests", async () => {
    const download = vi.fn(async ({ url, destination }: { url: string; destination: string }) => {
      const query = new URL(url).searchParams;
      const request = query.get("request");
      let body: string;
      let mediaType = "application/xml";
      if (request === "GetCapabilities")
        body = `<wfs:WFS_Capabilities xmlns:wfs="http://www.opengis.net/wfs/2.0" version="2.0.0"><ows:OperationsMetadata xmlns:ows="x"><ows:Operation name="GetFeature"/></ows:OperationsMetadata><wfs:FeatureTypeList><wfs:FeatureType><wfs:Name>si:roads</wfs:Name><wfs:Title>Roads</wfs:Title><wfs:DefaultCRS>EPSG:3794</wfs:DefaultCRS></wfs:FeatureType></wfs:FeatureTypeList></wfs:WFS_Capabilities>`;
      else if (request === "DescribeFeatureType")
        body = `<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"><xsd:complexType name="roads"><xsd:sequence><xsd:element name="id" type="xsd:long"/><xsd:element name="name" type="xsd:string"/></xsd:sequence></xsd:complexType></xsd:schema>`;
      else if (query.get("resultType") === "hits")
        body = `<wfs:FeatureCollection xmlns:wfs="x" numberMatched="2"/>`;
      else {
        body = "id,name\n1,Ljubljana\n2,Maribor\n";
        mediaType = "text/csv";
      }
      await writeFile(destination, body);
      return {
        path: destination,
        finalUrl: url,
        redirectChain: [url],
        bytes: Buffer.byteLength(body),
        sha256: "a".repeat(64),
        mediaType,
      };
    });
    const service = new WfsService({
      registry: new ProviderRegistry([provider()]),
      providerId: "fixture",
      downloader: { download } as never,
      limits: { maxBytes: 1_000_000, timeoutMs: 1000 },
    });

    await expect(service.layers("fixture:resource:wfs")).resolves.toMatchObject([
      { name: "si:roads" },
    ]);
    await expect(
      service.schema("fixture:resource:wfs", { layer: "si:roads" }),
    ).resolves.toHaveLength(2);
    await service.schema("fixture:resource:wfs", { layer: "si:roads" });
    await expect(
      service.preview("fixture:resource:wfs", {
        layer: "si:roads",
        properties: ["name"],
        limit: 1,
      }),
    ).resolves.toMatchObject({ rows: [{ id: "1", name: "Ljubljana" }], truncated: true });
    await expect(
      service.count("fixture:resource:wfs", { layer: "si:roads" }),
    ).resolves.toMatchObject({ count: 2 });
    expect(
      download.mock.calls.filter(
        ([request]) =>
          new URL((request as { url: string }).url).searchParams.get("request") ===
          "GetCapabilities",
      ),
    ).toHaveLength(1);
    expect(
      download.mock.calls.filter(
        ([request]) =>
          new URL((request as { url: string }).url).searchParams.get("request") ===
          "DescribeFeatureType",
      ),
    ).toHaveLength(1);
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ allowedOrigins: ["https://example.test"], force: false }),
    );
  });

  it("rejects unknown fields before GetFeature", async () => {
    const download = vi.fn(async ({ url, destination }: { url: string; destination: string }) => {
      const request = new URL(url).searchParams.get("request");
      const body =
        request === "GetCapabilities"
          ? `<wfs:WFS_Capabilities xmlns:wfs="x" version="2.0.0"><wfs:FeatureTypeList><wfs:FeatureType><wfs:Name>roads</wfs:Name></wfs:FeatureType></wfs:FeatureTypeList></wfs:WFS_Capabilities>`
          : `<xsd:schema xmlns:xsd="x"><xsd:complexType><xsd:sequence><xsd:element name="id" type="xsd:long"/></xsd:sequence></xsd:complexType></xsd:schema>`;
      await writeFile(destination, body);
      return {
        path: destination,
        finalUrl: url,
        redirectChain: [url],
        bytes: body.length,
        sha256: "a".repeat(64),
      };
    });
    const service = new WfsService({
      registry: new ProviderRegistry([provider()]),
      providerId: "fixture",
      downloader: { download } as never,
      limits: { maxBytes: 1_000_000, timeoutMs: 1000 },
    });
    await expect(
      service.preview("wfs", { layer: "roads", properties: ["missing"] }),
    ).rejects.toMatchObject({ code: "WFS_FIELD_NOT_FOUND", exitCode: 2 });
    expect(download).toHaveBeenCalledTimes(2);
  });
});
