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

async function fixture(name: string, contents: string | Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "klopsi-access-"));
  temporary.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

function providerArchiveClient(): KlopsiClient {
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
  return new KlopsiClient({
    registry: new ProviderRegistry([provider]),
    providerId: "fixture",
  });
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

  it("advertises all direct operations for local PC-Axis input", async () => {
    const path = await fixture(
      "rows.px",
      `AXIS-VERSION="2024";
CODEPAGE="utf-8";
MATRIX="access";
STUB="Place";
VALUES("Place")="Ljubljana";
DATA=1;`,
    );
    const client = new KlopsiClient({ registry: new ProviderRegistry(), providerId: "opsi" });

    await expect(client.access.inspect(path)).resolves.toMatchObject({
      kind: "local",
      detectedFormat: "pcaxis",
      operations: ["inspect", "preview", "schema", "validate", "query", "convert"],
      nextActions: [{ action: "resource.preview", argv: expect.any(Array) }],
    });
  });

  it("does not advertise data operations or preview guidance for an unknown local file", async () => {
    const path = await fixture("unknown.bin", "\0\u0001\u0002\u0003");
    const client = new KlopsiClient({ registry: new ProviderRegistry(), providerId: "opsi" });

    await expect(client.access.inspect(path)).resolves.toMatchObject({
      kind: "local",
      detectedFormat: "unknown",
      operations: ["inspect"],
      nextActions: [],
    });
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
    const client = providerArchiveClient();
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
      operations: ["inspect", "download"],
      limitations: expect.arrayContaining([
        "The selected entry must still pass format parsing or validation.",
      ]),
      nextActions: [],
    });
  });

  it("offers entry-specific actions without claiming unresolved archive operations", async () => {
    const client = providerArchiveClient();
    client.data.preview = async () => {
      throw new KlopsiError({
        code: "ARCHIVE_ENTRY_REQUIRED",
        message: "select an entry",
        exitCode: 2,
        context: { choices: ["a.csv", "b.csv"] },
      });
    };

    await expect(client.access.inspect("fixture:resource:archive")).resolves.toMatchObject({
      kind: "archive",
      detectedFormat: "zip",
      operations: ["inspect", "download"],
      selections: { entries: ["a.csv", "b.csv"] },
      nextActions: [
        { action: "resource.preview", argv: expect.arrayContaining(["--entry", "a.csv"]) },
        { action: "resource.preview", argv: expect.arrayContaining(["--entry", "b.csv"]) },
      ],
    });
  });

  it.each([
    "INVALID_PCAXIS_DATA",
    "PCAXIS_CELL_COUNT_MISMATCH",
    "INVALID_ARCHIVE_DATA",
    "ARCHIVE_NO_SUPPORTED_ENTRY",
  ])("keeps provider archive guidance truthful after %s", async (code) => {
    const client = providerArchiveClient();
    client.data.preview = async () => {
      throw new KlopsiError({
        code,
        message: "selected archive content is unavailable",
        exitCode: 6,
      });
    };

    await expect(client.access.inspect("fixture:resource:archive")).resolves.toMatchObject({
      kind: "archive",
      detectedFormat: "zip",
      operations: ["inspect", "download"],
      nextActions: [],
    });
  });

  it.each([
    {
      name: "broken.zip",
      contents: Buffer.from("PK\u0003\u0004not-a-zip"),
    },
    {
      name: "unsupported.zip",
      contents: Buffer.from(
        "UEsDBBQAAAAIAGEb+FyGphA2BwAAAAUAAAAKAAAAcmVhZG1lLnR4dMtIzcnJBwBQSwECFAAUAAAACABhG/hchqYQNgcAAAAFAAAACgAAAAAAAAAAAAAAAAAAAAAAcmVhZG1lLnR4dFBLBQYAAAAAAQABADgAAAAvAAAAAAA=",
        "base64",
      ),
    },
  ])("keeps local archive inspection truthful for $name", async ({ name, contents }) => {
    const path = await fixture(name, contents);
    const client = new KlopsiClient({ registry: new ProviderRegistry(), providerId: "opsi" });

    await expect(client.access.inspect(path)).resolves.toMatchObject({
      kind: "archive",
      detectedFormat: "zip",
      operations: ["inspect"],
      nextActions: [],
    });
  });

  it("does not swallow unrelated provider archive failures", async () => {
    const client = providerArchiveClient();
    const failure = new KlopsiError({
      code: "DOWNLOAD_FAILED",
      message: "network unavailable",
      exitCode: 4,
    });
    client.data.preview = async () => {
      throw failure;
    };

    await expect(client.access.inspect("fixture:resource:archive")).rejects.toBe(failure);
  });
});
