import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ARCHIVE_LIMITS,
  extractArchiveEntry,
  inspectArchive,
} from "../src/index.js";

const temporary: string[] = [];

async function archive(entries: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opsi-archive-"));
  temporary.push(directory);
  const path = join(directory, "fixture.zip");
  await writeFile(
    path,
    zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)]))),
  );
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("safe ZIP data access", () => {
  it("selects and extracts the only supported data entry", async () => {
    const path = await archive({ "README.txt": "notes", "data/rows.csv": "id\n1\n" });
    const inspection = await inspectArchive(path, DEFAULT_ARCHIVE_LIMITS);
    expect(inspection).toMatchObject({ selectedEntry: "data/rows.csv" });

    const output = join(path, "..", "rows.csv");
    await extractArchiveEntry(path, "data/rows.csv", output, DEFAULT_ARCHIVE_LIMITS);
    expect(await readFile(output, "utf8")).toBe("id\n1\n");
  });

  it("requires selection when multiple data entries exist", async () => {
    const path = await archive({ "a.csv": "id\n1\n", "b.json": "[{\"id\":2}]" });
    await expect(inspectArchive(path, DEFAULT_ARCHIVE_LIMITS)).rejects.toMatchObject({
      code: "ARCHIVE_ENTRY_REQUIRED",
      exitCode: 2,
      context: { choices: ["a.csv", "b.json"] },
    });
  });

  it.each(["../escape.csv", "/absolute.csv", "C:/drive.csv", "nested.zip"])(
    "rejects unsafe entry %s",
    async (name) => {
      const path = await archive({ [name]: "id\n1\n" });
      await expect(inspectArchive(path, DEFAULT_ARCHIVE_LIMITS)).rejects.toMatchObject({
        code: "UNSAFE_ARCHIVE_ENTRY",
        exitCode: 6,
      });
    },
  );

  it("rejects entries whose declared expansion exceeds the limit", async () => {
    const path = await archive({ "large.csv": `id\n${"x".repeat(1024)}\n` });
    await expect(
      inspectArchive(path, { ...DEFAULT_ARCHIVE_LIMITS, maxSelectedBytes: 100 }),
    ).rejects.toMatchObject({ code: "ARCHIVE_LIMIT_EXCEEDED", exitCode: 6 });
  });
});
