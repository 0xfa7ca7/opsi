import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DataEngine, DEFAULT_PCAXIS_LIMITS } from "../src/index.js";

const engine = new DataEngine();
const temporary: string[] = [];

async function temporaryFile(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "klopsi-preview-"));
  temporary.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

async function temporaryBytes(name: string, contents: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "klopsi-preview-"));
  temporary.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bounded previews and schema inference", () => {
  it("previews PC-Axis rows and infers their long-form schema with configured limits", async () => {
    const path = await temporaryFile(
      "tourism.px",
      `AXIS-VERSION="2024";
CODEPAGE="utf-8";
MATRIX="tourism";
STUB="Place";
HEADING="Year";
VALUES("Place")="Ljubljana";
CODES("Place")="001";
VALUES("Year")="2023","2024";
DATA=1.5 ".";`,
    );
    const adapters: string[] = [];
    const pcAxisEngine = new DataEngine({
      onAdapter: (name) => adapters.push(name),
      pcAxisLimits: {
        maxSourceBytes: 4_096,
        maxMetadataBytes: 2_048,
        maxMetadataStatements: 20,
        maxStatementBytes: 512,
        maxDimensions: 4,
        maxValuesPerDimension: 10,
        maxCells: 10,
        maxDecodedStringBytes: 128,
        maxNotes: 10,
        maxLanguageVariants: 10,
        maxCellTokenBytes: 32,
        maxEmittedRecords: 10,
        maxStagingBytes: 4_096,
      },
    });

    await expect(pcAxisEngine.preview(path, { limit: 2 })).resolves.toMatchObject({
      format: "pcaxis",
      encoding: "utf-8",
      columns: ["Place", "Place__code", "Year", "value", "value__symbol"],
      codeColumns: ["Place__code"],
      rows: [
        { Place: "Ljubljana", Place__code: "001", Year: "2023", value: 1.5 },
        {
          Place: "Ljubljana",
          Place__code: "001",
          Year: "2024",
          value: null,
          value__symbol: ".",
        },
      ],
      returnedCount: 2,
      truncated: false,
      warnings: [expect.objectContaining({ code: "PCAXIS_DATA_SYMBOL" })],
    });
    await expect(pcAxisEngine.inferSchema(path)).resolves.toMatchObject({
      format: "pcaxis",
      sampledRows: 2,
      fields: expect.arrayContaining([
        expect.objectContaining({
          name: "Place__code",
          type: "string",
          nullable: false,
          evidence: ["001"],
        }),
        expect.objectContaining({ name: "value", type: "double", nullable: true }),
        expect.objectContaining({ name: "value__symbol", type: "string", nullable: true }),
      ]),
    });
    expect(adapters).toEqual(["pcaxis", "pcaxis"]);
  });

  it("uses explicit PC-Axis code-column identity after collision-safe allocation", async () => {
    const path = await temporaryFile(
      "code-collision.px",
      `AXIS-VERSION="2024";
CODEPAGE="utf-8";
MATRIX="code collision";
STUB="A__code";
HEADING="A";
VALUES("A__code")="123";
VALUES("A")="label";
CODES("A")="001";
DATA=1;`,
    );

    await expect(engine.inferSchema(path)).resolves.toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({
          name: "A__code",
          type: "integer",
          evidence: ["123"],
        }),
        expect.objectContaining({
          name: "A__code__2",
          type: "string",
          evidence: ["001"],
        }),
      ]),
    });
  });

  it("clamps PC-Axis schema sampling to the effective default emission limit", async () => {
    const path = await temporaryFile(
      "default-limits.px",
      `AXIS-VERSION="2024";CODEPAGE="utf-8";MATRIX="limits";STUB="Row";VALUES("Row")="A";DATA=1;`,
    );
    const oversized = DEFAULT_PCAXIS_LIMITS.maxEmittedRecords + 1;
    await expect(engine.preview(path, { limit: oversized })).rejects.toMatchObject({
      code: "PCAXIS_CELL_LIMIT",
      context: { limit: DEFAULT_PCAXIS_LIMITS.maxEmittedRecords, requested: oversized },
    });
    await expect(engine.inferSchema(path, { limit: oversized })).resolves.toMatchObject({
      format: "pcaxis",
      sampledRows: 1,
    });
  });

  it("previews UTF-16LE tab-separated data declared as CSV", async () => {
    const path = await temporaryBytes(
      "budget.csv",
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("id\tname\r\n1\tLjubljana\r\n", "utf16le"),
      ]),
    );

    await expect(engine.preview({ path, declaredFormat: "CSV" })).resolves.toMatchObject({
      format: "tsv",
      encoding: "utf-16le",
      delimiter: "\t",
      rows: [{ id: "1", name: "Ljubljana" }],
    });
  });

  it("previews UTF-16BE semicolon-separated data", async () => {
    const littleEndian = Buffer.from("id;name\r\n1;Maribor\r\n", "utf16le");
    const bigEndian = Buffer.from(littleEndian);
    for (let index = 0; index < bigEndian.length; index += 2) {
      const first = bigEndian[index] as number;
      bigEndian[index] = bigEndian[index + 1] as number;
      bigEndian[index + 1] = first;
    }
    const path = await temporaryBytes(
      "budget.csv",
      Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]),
    );

    await expect(engine.preview(path)).resolves.toMatchObject({
      encoding: "utf-16be",
      delimiter: ";",
      rows: [{ id: "1", name: "Maribor" }],
    });
  });

  it.each([";", "|"] as const)("previews consistently %s-delimited data", async (delimiter) => {
    const path = await temporaryFile("sample.csv", `id${delimiter}name\n1${delimiter}Ljubljana\n`);

    await expect(engine.preview(path)).resolves.toMatchObject({
      delimiter,
      rows: [{ id: "1", name: "Ljubljana" }],
    });
  });

  it("normalizes malformed delimited user input to a stable typed error", async () => {
    const path = await temporaryFile("broken.csv", 'a,b\n"unterminated,2\n');
    await expect(engine.preview(path)).rejects.toMatchObject({
      code: "INVALID_TABULAR_DATA",
      exitCode: 6,
    });
  });

  it("returns twenty rows by default without losing Unicode", async () => {
    const path = await temporaryFile(
      "rows.csv",
      `id,mesto\n${Array.from({ length: 100 }, (_, index) => `${index + 1},${index === 0 ? "Škofja Loka" : "Ljubljana"}`).join("\n")}\n`,
    );

    const preview = await engine.preview(path);

    expect(preview.rows).toHaveLength(20);
    expect(preview.rows[0]).toEqual({ id: "1", mesto: "Škofja Loka" });
    expect(preview).toMatchObject({ returnedCount: 20, truncated: true, columns: ["id", "mesto"] });
  });

  it("previews native JSON arrays under the configured byte bound", async () => {
    const path = resolve("packages/testing/fixtures/data/data.json");

    await expect(engine.preview(path, { limit: 1 })).resolves.toMatchObject({
      format: "json",
      returnedCount: 1,
      truncated: true,
      rows: [{ id: 1, mesto: "Ljubljana" }],
    });
  });

  it("routes large JSON arrays away from the bounded native parser", async () => {
    const path = await temporaryFile(
      "large.json",
      `[${Array.from({ length: 40_000 }, (_, id) => JSON.stringify({ id, payload: "x".repeat(40) })).join(",")}]`,
    );
    const decisions: string[] = [];
    const bounded = new DataEngine({
      jsonNativeByteLimit: 1024,
      onAdapter: (name) => decisions.push(name),
    });

    const preview = await bounded.preview(path, { limit: 2 });

    expect(preview.rows).toHaveLength(2);
    expect(decisions).toContain("duckdb-json");
    expect(decisions).not.toContain("native-json");
  });

  it("routes large NDJSON records through DuckDB instead of buffering lines natively", async () => {
    const path = await temporaryFile(
      "large.ndjson",
      `${JSON.stringify({ id: 1, payload: "x".repeat(200_000) })}\n${JSON.stringify({ id: 2 })}\n`,
    );
    const decisions: string[] = [];
    const bounded = new DataEngine({
      jsonNativeByteLimit: 1024,
      onAdapter: (name) => decisions.push(name),
    });

    await expect(bounded.preview(path, { limit: 1 })).resolves.toMatchObject({
      returnedCount: 1,
      truncated: true,
    });
    expect(decisions).toContain("duckdb-ndjson");
    expect(decisions).not.toContain("ndjson");
  });

  it("infers conservative nullable types and retains sample evidence", async () => {
    const path = await temporaryFile(
      "types.csv",
      "active,count,ratio,date,at,note\ntrue,1,1.5,2026-07-10,2026-07-10T09:30:00Z,ok\nfalse,2,2.0,2026-07-11,2026-07-11T09:30:00Z,\n",
    );

    const schema = await engine.inferSchema(path);

    expect(schema.fields).toEqual([
      expect.objectContaining({
        name: "active",
        type: "boolean",
        nullable: false,
        evidence: ["true", "false"],
      }),
      expect.objectContaining({ name: "count", type: "integer", nullable: false }),
      expect.objectContaining({ name: "ratio", type: "double", nullable: false }),
      expect.objectContaining({ name: "date", type: "date", nullable: false }),
      expect.objectContaining({ name: "at", type: "timestamp", nullable: false }),
      expect.objectContaining({ name: "note", type: "string", nullable: true }),
    ]);
  });

  it("never declares sampled fields non-nullable when inference is truncated", async () => {
    const path = await temporaryFile(
      "late-null.ndjson",
      `${Array.from({ length: 550 }, (_, id) => JSON.stringify({ id, late: id === 525 ? null : "value" })).join("\n")}\n`,
    );

    const schema = await engine.inferSchema(path);

    expect(schema.sampledRows).toBe(500);
    expect(schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", nullable: true }),
        expect.objectContaining({ name: "late", nullable: true }),
      ]),
    );
  });

  it("requires explicit XLSX sheet selection and never evaluates formula cells", async () => {
    const path = resolve("packages/testing/fixtures/data/data.xlsx");

    await expect(engine.inspect(path)).resolves.toMatchObject({
      format: "xlsx",
      confidence: "signature",
      sheets: ["Cities", "Other"],
    });
    await expect(engine.preview(path)).rejects.toMatchObject({
      code: "SHEET_REQUIRED",
      exitCode: 2,
    });
    const preview = await engine.preview(path, { sheet: "Cities" });
    expect(preview.rows[0]).toMatchObject({ id: 1, mesto: "Ljubljana", double_id: "=A2*2" });
    expect(preview.rows[0]?.double_id).not.toBe(999);
    expect(preview.warnings).toContainEqual(expect.objectContaining({ code: "FORMULA_CELL" }));
  });

  it("bounds the XLSX shared-string table before streaming worksheet rows", async () => {
    const path = resolve("packages/testing/fixtures/data/data.xlsx");
    const bounded = new DataEngine({ xlsxSharedStringsByteLimit: 32 });

    await expect(bounded.preview(path, { sheet: "Cities" })).rejects.toMatchObject({
      code: "XLSX_SHARED_STRINGS_TOO_LARGE",
      exitCode: 5,
    });
  });

  it("previews Parquet through the trusted DuckDB adapter", async () => {
    const path = resolve("packages/testing/fixtures/data/data.parquet");

    await expect(engine.preview(path, { limit: 1 })).resolves.toMatchObject({
      format: "parquet",
      returnedCount: 1,
      truncated: true,
      rows: [{ id: 1, mesto: "Ljubljana" }],
    });
  });
});
