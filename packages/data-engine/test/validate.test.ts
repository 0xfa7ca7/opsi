import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DataEngine } from "../src/index.js";

const engine = new DataEngine();
const temporary: string[] = [];

async function fixture(contents: string, name = "input.csv"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opsi-validate-"));
  temporary.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("data validation", () => {
  it("reports malformed row widths with stable locations and does not mutate input", async () => {
    const path = resolve("packages/testing/fixtures/data/malformed.csv");
    const before = await readFile(path);

    const result = await engine.validate(path);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "INCONSISTENT_COLUMN_COUNT",
        severity: "error",
        row: 3,
        recommendation: expect.any(String),
      }),
    );
    expect(await readFile(path)).toEqual(before);
  });

  it("reports duplicate headers, duplicate rows, mixed types, and null-heavy columns", async () => {
    const path = await fixture(
      "id,id,value,mostly_empty\n1,a,10,\n1,a,10,\n2,b,text,\n3,c,12,present\n",
    );

    const codes = (await engine.validate(path)).issues.map((issue) => issue.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_HEADER",
        "DUPLICATE_ROW",
        "MIXED_TYPES",
        "NULL_HEAVY_COLUMN",
      ]),
    );
  });

  it("reports invalid date-like values and spreadsheet-formula-looking values", async () => {
    const path = await fixture(
      "date,value\n2026-01-01,=2+2\n2026-99-99,+cmd\n2026-02-03,-1\n2026-02-04,@SUM(A1)\n",
    );

    const result = await engine.validate(path);

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_DATE", row: 3, field: "date" }),
    );
    expect(result.issues.filter((issue) => issue.code === "FORMULA_LIKE_VALUE")).toHaveLength(4);
  });

  it("reports delimiter mismatches and invalid UTF-8 encoding", async () => {
    const delimiter = await fixture("a\tb\n1\t2\n", "wrong.csv");
    const invalid = await fixture("placeholder", "invalid.csv");
    await writeFile(invalid, Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0xff, 0x2c, 0x32]));

    await expect(engine.validate(delimiter)).resolves.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "DELIMITER_MISMATCH" })]),
    });
    await expect(engine.validate(invalid)).resolves.toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_ENCODING", severity: "error" }),
      ]),
    });
  });

  it("preserves unsupported and sheet-selection statuses during validation", async () => {
    const zip = await fixture("PK\u0003\u0004fixture", "archive.zip");

    await expect(engine.validate(zip)).rejects.toMatchObject({
      code: "DOWNLOAD_ONLY_FORMAT",
      exitCode: 5,
    });
    await expect(
      engine.validate(resolve("packages/testing/fixtures/data/data.xlsx")),
    ).rejects.toMatchObject({ code: "SHEET_REQUIRED", exitCode: 2 });
  });

  it("runs row diagnostics for structured formats", async () => {
    const path = await fixture(
      JSON.stringify([
        { date: "2026-01-01", value: "=2+2", mostly: null },
        { date: "2026-01-01", value: "=2+2", mostly: null },
        { date: "2026-99-99", value: 3, mostly: "present" },
      ]),
      "diagnostic.json",
    );

    const codes = (await engine.validate(path)).issues.map((candidate) => candidate.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ROW",
        "MIXED_TYPES",
        "NULL_HEAVY_COLUMN",
        "INVALID_DATE",
        "FORMULA_LIKE_VALUE",
      ]),
    );
  });

  it("strictly validates NDJSON beyond the schema sample boundary", async () => {
    const path = await fixture(
      `${Array.from({ length: 550 }, (_, id) => JSON.stringify({ id })).join("\n")}\n{broken\n`,
      "late-error.ndjson",
    );

    await expect(engine.validate(path)).resolves.toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: "PARSE_ERROR" })]),
    });
  });
});
