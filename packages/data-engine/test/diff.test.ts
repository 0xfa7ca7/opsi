import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatasetDiffEngine, DuckDbQueryRunner, sqlIdentifier } from "../src/index.js";

let directory: string;
let before: string;
let after: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "klopsi-diff-"));
  before = join(directory, "before.csv");
  after = join(directory, "after.csv");
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

function engine(): DatasetDiffEngine {
  return new DatasetDiffEngine({
    runner: new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    }),
  });
}

describe("semantic dataset diff", () => {
  it("escapes arbitrary SQL identifiers by doubling embedded quotes", () => {
    expect(sqlIdentifier('county"id')).toBe('"county""id"');
  });

  it("reports exact schema and keyed row changes with deterministic samples", async () => {
    await writeFile(before, "id,name,score,legacy\n2,stable,20,x\n1,old,10,y\n4,removed,40,z\n");
    await writeFile(after, "id,name,score,new_column\n3,added,30,n\n1,new,11,m\n2,stable,20,n\n");

    const result = await engine().compare({ before, after, key: ["id"], sampleLimit: 10 });

    expect(result.summary).toEqual({
      beforeRows: 3,
      afterRows: 3,
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 1,
      schemaChanges: 2,
    });
    expect(result.schema).toEqual([
      { column: "legacy", change: "removed", beforeType: "VARCHAR" },
      { column: "new_column", change: "added", afterType: "VARCHAR" },
    ]);
    expect(result.samples.added).toEqual([
      {
        key: { id: 3 },
        after: { id: 3, name: "added", score: 30, new_column: "n" },
      },
    ]);
    expect(result.samples.removed).toEqual([
      {
        key: { id: 4 },
        before: { id: 4, name: "removed", score: 40, legacy: "z" },
      },
    ]);
    expect(result.samples.changed).toEqual([
      {
        key: { id: 1 },
        before: { id: 1, name: "old", score: 10, legacy: "y" },
        after: { id: 1, name: "new", score: 11, new_column: "m" },
        changedColumns: ["name", "score"],
      },
    ]);
    expect(result.truncated).toEqual({ added: false, removed: false, changed: false });
    expect(result.warnings).toEqual([]);
  });

  it("supports quoted composite keys and bounds each sample class independently", async () => {
    await writeFile(
      before,
      '"county""id",year,value\n"b",2025,old-b\n"a",2025,old-a\n"d",2025,removed\n',
    );
    await writeFile(
      after,
      '"county""id",year,value\n"c",2025,added\n"b",2025,new-b\n"a",2025,new-a\n',
    );

    const result = await engine().compare({
      before,
      after,
      key: ['county"id', "year"],
      sampleLimit: 1,
    });

    expect(result.summary).toMatchObject({ added: 1, removed: 1, changed: 2 });
    expect(result.samples.changed).toHaveLength(1);
    expect(result.samples.changed[0]?.key).toEqual({ 'county"id': "a", year: 2025 });
    expect(result.truncated).toEqual({ added: false, removed: false, changed: true });
  });

  it("reports type changes and compares the shared values without implicit key coercion", async () => {
    await writeFile(before, "id,value\n1,42\n");
    await writeFile(after, '[{"id":1,"value":"42"}]\n');

    await expect(
      engine().compare({ before, after, key: ["id"], sampleLimit: 10 }),
    ).resolves.toMatchObject({
      summary: { changed: 1, schemaChanges: 1 },
      schema: [
        { column: "value", change: "type-changed", beforeType: "BIGINT", afterType: "VARCHAR" },
      ],
      samples: { changed: [{ changedColumns: ["value"] }] },
    });
  });

  it("rejects a missing or differently typed key with stable input errors", async () => {
    await writeFile(before, "id,value\n1,a\n");
    await writeFile(after, "other,value\n1,a\n");
    await expect(
      engine().compare({ before, after, key: ["id"], sampleLimit: 10 }),
    ).rejects.toMatchObject({
      code: "DIFF_KEY_NOT_FOUND",
      exitCode: 2,
      context: { after: ["id"] },
    });

    await writeFile(after, "id,value\ntext,a\n");
    await expect(
      engine().compare({ before, after, key: ["id"], sampleLimit: 10 }),
    ).rejects.toMatchObject({
      code: "DIFF_KEY_TYPE_MISMATCH",
      exitCode: 2,
      context: { column: "id", beforeType: "BIGINT", afterType: "VARCHAR" },
    });
  });

  it("rejects null and duplicate composite keys before joining", async () => {
    await writeFile(before, "id,year,value\n1,2025,a\n,2025,b\n");
    await writeFile(after, "id,year,value\n1,2025,a\n");
    await expect(
      engine().compare({ before, after, key: ["id", "year"], sampleLimit: 10 }),
    ).rejects.toMatchObject({
      code: "DIFF_NULL_KEY",
      exitCode: 6,
      context: { before: { nullKeyRows: 1 } },
    });

    await writeFile(before, "id,year,value\n1,2025,a\n1,2025,b\n");
    await expect(
      engine().compare({ before, after, key: ["id", "year"], sampleLimit: 10 }),
    ).rejects.toMatchObject({
      code: "DIFF_DUPLICATE_KEY",
      exitCode: 6,
      context: { before: { duplicateKeyGroups: 1, duplicateKeyRows: 2 } },
    });
  });

  it("reports an entirely null key before any inferred key type mismatch", async () => {
    await writeFile(before, "id,value\n,missing\n");
    await writeFile(after, "id,value\n1,present\n");

    await expect(
      engine().compare({ before, after, key: ["id"], sampleLimit: 10 }),
    ).rejects.toMatchObject({
      code: "DIFF_NULL_KEY",
      exitCode: 6,
      context: { before: { nullKeyRows: 1 } },
    });
  });

  it("rejects missing keys and unsafe sample bounds before staging", async () => {
    await expect(
      engine().compare({ before, after, key: [], sampleLimit: 10 }),
    ).rejects.toMatchObject({
      code: "DIFF_KEY_REQUIRED",
      exitCode: 2,
    });
    await expect(
      engine().compare({ before, after, key: ["id"], sampleLimit: 101 }),
    ).rejects.toMatchObject({
      code: "DIFF_LIMIT_INVALID",
      exitCode: 2,
    });
  });
});
