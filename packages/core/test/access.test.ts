import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KlopsiClient } from "../src/client.js";
import { ProviderRegistry } from "../src/registry.js";
import {
  KlopsiError,
  datasetId,
  providerId,
  resourceId,
  type DataProvider,
  type Resource,
} from "@klopsi/domain";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

async function fixture(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "klopsi-access-"));
  temporary.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

describe("resource access guidance", () => {
  it("describes local data with KLOPSI-only next actions", async () => {
    const path = await fixture("rows.csv", "id,name\n1,Ljubljana\n");
    const client = new KlopsiClient({ registry: new ProviderRegistry(), providerId: "opsi" });
    const descriptor = await client.access.inspect(path);
    expect(descriptor).toMatchObject({
      kind: "local",
      detectedFormat: "csv",
      operations: expect.arrayContaining(["preview", "query", "convert"]),
      nextActions: [{ action: "resource.preview", argv: expect.any(Array) }],
    });
    expect(JSON.stringify(descriptor)).not.toMatch(/curl|https?:\/\//u);
  });

  it("returns explicit record-path choices for ambiguous XML", async () => {
    const path = await fixture(
      "rows.xml",
      "<root><a><id>1</id></a><a><id>2</id></a><b><id>3</id></b><b><id>4</id></b></root>",
    );
    const client = new KlopsiClient({ registry: new ProviderRegistry(), providerId: "opsi" });
    await expect(client.access.inspect(path)).resolves.toMatchObject({
      detectedFormat: "xml",
      selections: { recordPaths: ["/root/a", "/root/b"] },
      nextActions: [
        { argv: expect.arrayContaining(["--record-path", "/root/a"]) },
        { argv: expect.arrayContaining(["--record-path", "/root/b"]) },
      ],
    });
  });

  it("keeps archive inspection available when its sole entry is malformed", async () => {
    const resource: Resource = {
      id: resourceId("archive"),
      datasetId: datasetId("dataset"),
      providerId: providerId("fixture"),
      title: "Archive",
      url: "https://example.test/archive.zip",
      format: "ZIP",
      reference: "fixture:resource:archive",
    };
    const provider: DataProvider = {
      descriptor: { id: providerId("fixture"), name: "fixture", capabilities: [] },
      search: async () => ({ items: [], total: 0, limit: 0, offset: 0 }),
      getDataset: async () => {
        throw new Error("unused");
      },
      getResource: async () => resource,
      listDatasetResources: async () => [],
      resolveResource: async () => ({ resource, kind: "archive", url: resource.url }),
    };
    const client = new KlopsiClient({
      registry: new ProviderRegistry([provider]),
      providerId: "fixture",
    });
    client.data.preview = async () => {
      throw new KlopsiError({
        code: "INVALID_TABULAR_DATA",
        message: "malformed",
        exitCode: 6,
      });
    };
    await expect(client.access.inspect("fixture:resource:archive")).resolves.toMatchObject({
      kind: "archive",
      detectedFormat: "zip",
      limitations: expect.arrayContaining([
        "The selected entry must still pass format parsing or validation.",
      ]),
    });
  });
});
