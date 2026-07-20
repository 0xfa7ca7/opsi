import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_XML_LIMITS, DataEngine, discoverXmlRecords, previewXml } from "../src/index.js";

const temporary: string[] = [];

async function xml(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opsi-xml-"));
  temporary.push(directory);
  const path = join(directory, "fixture.xml");
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bounded XML records", () => {
  it("infers repeated namespaced records and flattens attributes", async () => {
    const path = await xml(`<?xml version="1.0"?>
      <a:root xmlns:a="urn:air">
        <a:station id="LJ"><a:pm10>12</a:pm10></a:station>
        <a:station id="MB"><a:pm10>9</a:pm10></a:station>
      </a:root>`);

    await expect(previewXml(path, { limit: 2 }, DEFAULT_XML_LIMITS)).resolves.toMatchObject({
      format: "xml",
      recordPath: "/a:root/a:station",
      rows: [
        { "@id": "LJ", "a:pm10": "12" },
        { "@id": "MB", "a:pm10": "9" },
      ],
    });
  });

  it("requires an explicit record path for equally repeated structures", async () => {
    const path = await xml(
      "<root><a><v>1</v></a><a><v>2</v></a><b><v>3</v></b><b><v>4</v></b></root>",
    );
    await expect(discoverXmlRecords(path, DEFAULT_XML_LIMITS)).rejects.toMatchObject({
      code: "XML_RECORD_PATH_REQUIRED",
      exitCode: 2,
      context: { choices: ["/root/a", "/root/b"] },
    });
    await expect(
      previewXml(path, { recordPath: "/root/b", limit: 1 }, DEFAULT_XML_LIMITS),
    ).resolves.toMatchObject({ rows: [{ v: "3" }], truncated: true });
  });

  it("rejects DTD and entity declarations", async () => {
    const path = await xml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>');
    await expect(previewXml(path, {}, DEFAULT_XML_LIMITS)).rejects.toMatchObject({
      code: "INVALID_XML_DATA",
      exitCode: 6,
    });
  });

  it("integrates XML with DataEngine preview", async () => {
    const path = await xml("<root><row><id>1</id></row><row><id>2</id></row></root>");
    await expect(new DataEngine().preview(path, { limit: 1 })).resolves.toMatchObject({
      format: "xml",
      rows: [{ id: "1" }],
      truncated: true,
    });
  });

  it("decodes UTF-16 XML before bounded record discovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opsi-xml-"));
    temporary.push(directory);
    const path = join(directory, "utf16.xml");
    await writeFile(
      path,
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(
          "<root><row><name>Črnomelj</name></row><row><name>Koper</name></row></root>",
          "utf16le",
        ),
      ]),
    );
    await expect(previewXml(path, { limit: 2 })).resolves.toMatchObject({
      rows: [{ name: "Črnomelj" }, { name: "Koper" }],
    });
  });

  it("normalizes the same XML rows for validation and conversion", async () => {
    const path = await xml(
      "<root><row><id>1</id><name>Ljubljana</name></row><row><id>2</id><name>Maribor</name></row></root>",
    );
    const output = join(path.slice(0, path.lastIndexOf("/")), "rows.json");
    const engine = new DataEngine();

    await expect(engine.validate(path)).resolves.toMatchObject({ valid: true, format: "xml" });
    await engine.convert({ input: path, output, targetFormat: "json", force: false });
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual([
      { id: "1", name: "Ljubljana" },
      { id: "2", name: "Maribor" },
    ]);
  });
});
