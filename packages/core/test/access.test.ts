import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpsiClient } from "../src/client.js";
import { ProviderRegistry } from "../src/registry.js";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

async function fixture(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opsi-access-"));
  temporary.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

describe("resource access guidance", () => {
  it("describes local data with OPSI-only next actions", async () => {
    const path = await fixture("rows.csv", "id,name\n1,Ljubljana\n");
    const client = new OpsiClient({ registry: new ProviderRegistry(), providerId: "opsi" });
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
    const client = new OpsiClient({ registry: new ProviderRegistry(), providerId: "opsi" });
    await expect(client.access.inspect(path)).resolves.toMatchObject({
      detectedFormat: "xml",
      selections: { recordPaths: ["/root/a", "/root/b"] },
      nextActions: [
        { argv: expect.arrayContaining(["--record-path", "/root/a"]) },
        { argv: expect.arrayContaining(["--record-path", "/root/b"]) },
      ],
    });
  });
});
