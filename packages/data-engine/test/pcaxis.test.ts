import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PCAXIS_LIMITS,
  parsePcAxisMetadata,
  previewPcAxis,
  writePcAxisRowsAsNdjson,
  type PcAxisLimits,
} from "../src/index.js";
import { writePcAxisBufferFully } from "../src/pcaxis.js";

const temporary: string[] = [];

function windows1250(text: string): Buffer {
  const replacements: Readonly<Record<string, number>> = {
    Č: 0xc8,
    Š: 0x8a,
    Ž: 0x8e,
    č: 0xe8,
    š: 0x9a,
    ž: 0x9e,
  };
  const bytes: number[] = [];
  for (const character of text) {
    const replacement = replacements[character];
    if (replacement !== undefined) bytes.push(replacement);
    else {
      const code = character.codePointAt(0);
      if (code === undefined || code > 0x7f)
        throw new Error(`The test encoder does not support ${character}.`);
      bytes.push(code);
    }
  }
  return Buffer.from(bytes);
}

async function fixture(
  contents: string | Buffer,
): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "klopsi-pcaxis-"));
  temporary.push(directory);
  const path = join(directory, "fixture.px");
  await writeFile(path, contents);
  return { directory, path };
}

function limits(overrides: Partial<PcAxisLimits>): PcAxisLimits {
  return { ...DEFAULT_PCAXIS_LIMITS, ...overrides };
}

function minimal(data = "1 2"): string {
  return `CODEPAGE="utf-8";
MATRIX="minimal";
STUB="Place";
HEADING="Year";
VALUES("Place")="Ljubljana";
VALUES("Year")="2023","2024";
DATA=
${data};`;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bounded dense PC-Axis parsing", () => {
  it("parses NIJZ-style Windows-1250 labels, zero-padded codes, numbers, and symbols", async () => {
    const { path } = await fixture(
      windows1250(`CHARSET="ANSI";
CODEPAGE="windows-1250";
MATRIX="KME";
STUB="Občina";
HEADING="Leto";
VALUES("Občina")="Črnomelj","Škofja Loka";
CODES("Občina")="001","002";
VALUES("Leto")="2023","2024";
CODES("Leto")="23","24";
DATASYMBOLNIL="Ni podatka";
DATASYMBOL1="Manjka";
DATA=
0, "-"; 1.5\t".";`),
    );

    const metadata = await parsePcAxisMetadata(path);
    expect(metadata).toMatchObject({
      encoding: "windows-1250",
      expectedCellCount: 4,
      matrix: "KME",
      dimensions: [
        {
          name: "Občina",
          role: "stub",
          values: ["Črnomelj", "Škofja Loka"],
          codes: ["001", "002"],
        },
        { name: "Leto", role: "heading", values: ["2023", "2024"], codes: ["23", "24"] },
      ],
    });
    expect(metadata.dataSymbols).toMatchObject({ "-": "Ni podatka", ".": "Manjka" });

    await expect(previewPcAxis(path, { limit: 4 })).resolves.toMatchObject({
      format: "pcaxis",
      encoding: "windows-1250",
      columns: ["Občina", "Občina__code", "Leto", "Leto__code", "value", "value__symbol"],
      returnedCount: 4,
      truncated: false,
      rows: [
        {
          Občina: "Črnomelj",
          Občina__code: "001",
          Leto: "2023",
          Leto__code: "23",
          value: 0,
        },
        {
          Občina: "Črnomelj",
          Občina__code: "001",
          Leto: "2024",
          Leto__code: "24",
          value: null,
          value__symbol: "-",
        },
        {
          Občina: "Škofja Loka",
          Občina__code: "002",
          Leto: "2023",
          Leto__code: "23",
          value: 1.5,
        },
        {
          Občina: "Škofja Loka",
          Občina__code: "002",
          Leto: "2024",
          Leto__code: "24",
          value: null,
          value__symbol: ".",
        },
      ],
      warnings: [
        expect.objectContaining({
          code: "PCAXIS_DATA_SYMBOL",
          severity: "warning",
          context: { symbol: "-", occurrences: 1 },
        }),
        expect.objectContaining({
          code: "PCAXIS_DATA_SYMBOL",
          severity: "warning",
          context: { symbol: ".", occurrences: 1 },
        }),
      ],
    });
  });

  it("parses Banka-style UTF-8 multiline assignments and doubled quote escapes", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="bank";
STUB="Postavka";
HEADING="Obdobje";
VALUES("Postavka")=
  "Čiste obresti",
  "Donos ""bruto""";
CODES("Postavka")="001","002";
VALUES("Obdobje")="2023";
DATA=
-12.25
0;`);

    await expect(previewPcAxis(path, { limit: 2 })).resolves.toMatchObject({
      encoding: "utf-8",
      rows: [
        {
          Postavka: "Čiste obresti",
          Postavka__code: "001",
          Obdobje: "2023",
          value: -12.25,
        },
        {
          Postavka: 'Donos "bruto"',
          Postavka__code: "002",
          Obdobje: "2023",
          value: 0,
        },
      ],
    });
  });

  it("concatenates adjacent quoted NOTEX scalar segments into one logical note value", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="notes";
STUB="Place";
VALUES("Place")="A";
NOTEX="First ""quoted"" line "
  "continues here";
DATA=1;`);

    await expect(parsePcAxisMetadata(path)).resolves.toMatchObject({
      notes: [
        {
          keyword: "NOTEX",
          subkeys: [],
          values: ['First "quoted" line continues here'],
        },
      ],
    });
  });

  it("concatenates adjacent quoted language-qualified NOTEX scalar segments", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="notes";
STUB="Place";
VALUES("Place")="A";
NOTEX[en]="First line "
  "continues here";
DATA=1;`);

    const metadata = await parsePcAxisMetadata(path);
    expect(metadata.notes).toContainEqual({
      keyword: "NOTEX",
      language: "en",
      subkeys: [],
      values: ["First line continues here"],
    });
    expect(metadata.languageVariants).toContainEqual({
      keyword: "NOTEX",
      language: "en",
      subkeys: [],
      values: ["First line continues here"],
    });
  });

  it.each([
    {
      keyword: "CELLNOTEX",
      assignment: 'CELLNOTEX("Place","A")',
      subkeys: ["Place", "A"],
    },
    {
      keyword: "VALUENOTEX",
      assignment: 'VALUENOTEX("Place","A")',
      subkeys: ["Place", "A"],
    },
  ])(
    "concatenates adjacent quoted $keyword scalar segments",
    async ({ assignment, keyword, subkeys }) => {
      const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="notes";
STUB="Place";
VALUES("Place")="A";
${assignment}="First "
  "second";
DATA=1;`);

      await expect(parsePcAxisMetadata(path)).resolves.toMatchObject({
        notes: [
          {
            keyword,
            subkeys,
            values: ["First second"],
          },
        ],
      });
    },
  );

  it("uses unqualified SURS-style 4D values and codes instead of language variants", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="tourism";
TITLE="Prenočitve";
TITLE[en]="Overnight stays";
STUB="Regija","Nastanitev";
STUB[en]="Region","Accommodation";
HEADING="Mesec","Kazalnik";
HEADING[en]="Month","Measure";
VALUES("Regija")="Vzhod","Zahod";
VALUES[en]("Regija")="East","West";
CODES("Regija")="01","02";
CODES[en]("Regija")="E","W";
VALUES("Nastanitev")="Hoteli","Kampi";
VALUES[en]("Nastanitev")="Hotels","Camps";
VALUES("Mesec")="Januar","Februar";
VALUES[en]("Mesec")="January","February";
VALUES("Kazalnik")="Prihodi","Prenočitve";
VALUES[en]("Kazalnik")="Arrivals","Stays";
DATA=
1,2 3;4
5\t6,7;8
9 10 11 12
13;14,15\t16;`);

    const metadata = await parsePcAxisMetadata(path);
    expect(metadata.languageVariants.length).toBeGreaterThan(0);
    expect(metadata.title).toBe("Prenočitve");
    expect(metadata.dimensions.map((dimension) => dimension.name)).toEqual([
      "Regija",
      "Nastanitev",
      "Mesec",
      "Kazalnik",
    ]);
    expect(metadata.dimensions[0]).toMatchObject({
      values: ["Vzhod", "Zahod"],
      codes: ["01", "02"],
    });

    await expect(previewPcAxis(path, { limit: 16 })).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          Regija: "Vzhod",
          Nastanitev: "Hoteli",
          Mesec: "Januar",
          Kazalnik: "Prihodi",
          value: 1,
        }),
        expect.objectContaining({ Kazalnik: "Prenočitve", value: 2 }),
        expect.objectContaining({ Mesec: "Februar", Kazalnik: "Prihodi", value: 3 }),
        expect.objectContaining({ Mesec: "Februar", Kazalnik: "Prenočitve", value: 4 }),
        expect.objectContaining({ Nastanitev: "Kampi", Mesec: "Januar", value: 5 }),
        expect.objectContaining({ value: 6 }),
        expect.objectContaining({ value: 7 }),
        expect.objectContaining({ value: 8 }),
        expect.objectContaining({ Regija: "Zahod", Nastanitev: "Hoteli", value: 9 }),
        expect.objectContaining({ value: 10 }),
        expect.objectContaining({ value: 11 }),
        expect.objectContaining({ value: 12 }),
        expect.objectContaining({ Nastanitev: "Kampi", value: 13 }),
        expect.objectContaining({ value: 14 }),
        expect.objectContaining({ value: 15 }),
        expect.objectContaining({
          Regija: "Zahod",
          Nastanitev: "Kampi",
          Mesec: "Februar",
          Kazalnik: "Prenočitve",
          value: 16,
        }),
      ],
      truncated: false,
    });
  });

  it("accepts SURS-style TIMEVAL lists in default and language-qualified metadata", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="tourism";
STUB="DAN";
STUB[en]="DAY";
VALUES("DAN")="20230101","20230102";
TIMEVAL("DAN")=TLIST(D1),"20230101","20230102";
TIMEVAL[en]("DAY")=TLIST(D1),"20230101","20230102";
DATA=1 2;`);

    const metadata = await parsePcAxisMetadata(path);
    expect(metadata.languageVariants).toContainEqual({
      keyword: "TIMEVAL",
      language: "en",
      subkeys: ["DAY"],
      values: ["TLIST(D1)", "20230101", "20230102"],
    });
    await expect(previewPcAxis(path, { limit: 2 })).resolves.toMatchObject({
      rows: [
        { DAN: "20230101", value: 1 },
        { DAN: "20230102", value: 2 },
      ],
      truncated: false,
    });
  });

  it("accepts the compact official TIMEVAL range syntax", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="annual";
STUB="Year";
VALUES("Year")="2023","2024";
TIMEVAL("Year")=TLIST(A1, "2023"-"2024");
DATA=1 2;`);

    await expect(parsePcAxisMetadata(path)).resolves.toMatchObject({
      expectedCellCount: 2,
    });
  });

  it("allocates deterministic collision-safe label and code columns", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="collisions";
STUB="value";
HEADING="value__symbol";
VALUES("value")="A";
CODES("value")="001";
VALUES("value__symbol")="B";
DATA=7;`);

    await expect(previewPcAxis(path, { limit: 1 })).resolves.toMatchObject({
      columns: ["value__2", "value__2__code", "value__symbol__2", "value"],
      rows: [
        {
          value__2: "A",
          value__2__code: "001",
          value__symbol__2: "B",
          value: 7,
        },
      ],
    });
  });

  it("allocates columns with DuckDB's ASCII case-insensitive identifier semantics", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="case collisions";
STUB="Region","region","VALUE","VALUE__SYMBOL","Region__CODE";
VALUES("Region")="North";
CODES("Region")="R1";
VALUES("region")="South";
CODES("region")="r1";
VALUES("VALUE")="Measure";
VALUES("VALUE__SYMBOL")="Status";
VALUES("Region__CODE")="Generated collision";
CODES("Region__CODE")="RC";
DATA=7;`);

    await expect(previewPcAxis(path, { limit: 1 })).resolves.toMatchObject({
      columns: [
        "Region",
        "Region__code",
        "region__2",
        "region__2__code",
        "VALUE__2",
        "VALUE__SYMBOL__2",
        "Region__CODE__2",
        "Region__CODE__2__code",
        "value",
      ],
      codeColumns: ["Region__code", "region__2__code", "Region__CODE__2__code"],
      rows: [
        {
          Region: "North",
          Region__code: "R1",
          region__2: "South",
          region__2__code: "r1",
          VALUE__2: "Measure",
          VALUE__SYMBOL__2: "Status",
          Region__CODE__2: "Generated collision",
          Region__CODE__2__code: "RC",
          value: 7,
        },
      ],
    });
  });

  it("bounds preview rows without expanding or requiring the remaining Cartesian product", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="large";
STUB="A";
HEADING="B";
VALUES("A")="a1","a2","a3";
VALUES("B")="b1","b2","b3";
DATA=1 2`);

    await expect(
      previewPcAxis(path, { limit: 2 }, limits({ maxEmittedRecords: 2 })),
    ).resolves.toMatchObject({
      rows: [
        { A: "a1", B: "b1", value: 1 },
        { A: "a1", B: "b2", value: 2 },
      ],
      returnedCount: 2,
      truncated: true,
    });
  });

  it("requires the final DATA semicolon when a preview or stage scans the complete cube", async () => {
    const { directory, path } = await fixture(`CODEPAGE="utf-8";
MATRIX="unterminated";
STUB="Place";
VALUES("Place")="A","B";
DATA=1 2
   `);
    const output = join(directory, "rows.ndjson");

    await expect(previewPcAxis(path, { limit: 2 })).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
      exitCode: 6,
    });
    await expect(writePcAxisRowsAsNdjson(path, output)).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
      exitCode: 6,
    });
    await expect(access(output)).rejects.toThrow();
  });

  it("accepts a final DATA semicolon followed only by whitespace", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="terminated";
STUB="Place";
VALUES("Place")="A","B";
DATA=1 2;

\t`);

    await expect(previewPcAxis(path, { limit: 2 })).resolves.toMatchObject({
      rows: [
        { Place: "A", value: 1 },
        { Place: "B", value: 2 },
      ],
      truncated: false,
    });
  });

  it("streams all dense rows to NDJSON in coordinate order", async () => {
    const { directory, path } = await fixture(minimal());
    const output = join(directory, "rows.ndjson");

    await expect(writePcAxisRowsAsNdjson(path, output)).resolves.toMatchObject({
      rows: 2,
      columns: ["Place", "Year", "value"],
      encoding: "utf-8",
      warnings: [],
    });
    expect(
      (await readFile(output, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { Place: "Ljubljana", Year: "2023", value: 1 },
      { Place: "Ljubljana", Year: "2024", value: 2 },
    ]);
  });

  it("retries partial file writes until the complete NDJSON buffer is written", async () => {
    const written: Buffer[] = [];
    const target = {
      async write(
        buffer: Uint8Array,
        offset: number,
        length: number,
      ): Promise<{ readonly bytesWritten: number }> {
        const bytesWritten = Math.min(2, length);
        written.push(Buffer.from(buffer).subarray(offset, offset + bytesWritten));
        return { bytesWritten };
      },
    };

    await writePcAxisBufferFully(target, Buffer.from("abcdef"));
    expect(Buffer.concat(written).toString("utf8")).toBe("abcdef");
    expect(written).toHaveLength(3);
  });

  it.each([
    {
      name: "a missing unqualified VALUES assignment",
      contents: `CODEPAGE="utf-8";MATRIX="x";STUB="Place";DATA=1;`,
    },
    {
      name: "a duplicate mandatory assignment",
      contents: `CODEPAGE="utf-8";MATRIX="x";STUB="Place";STUB="Other";VALUES("Place")="A";DATA=1;`,
    },
    {
      name: "an unterminated quoted assignment",
      contents: `CODEPAGE="utf-8";MATRIX="x";STUB="Place";VALUES("Place")="A;DATA=1;`,
    },
    {
      name: "a missing metadata semicolon",
      contents: `CODEPAGE="utf-8";MATRIX="x";STUB="Place"\nVALUES("Place")="A";DATA=1;`,
    },
  ])("rejects $name", async ({ contents }) => {
    const { path } = await fixture(contents);
    await expect(parsePcAxisMetadata(path)).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
      exitCode: 6,
    });
  });

  it("rejects mismatched VALUES and CODES cardinalities", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="x";
STUB="Place";
VALUES("Place")="A","B";
CODES("Place")="01";
DATA=1 2;`);
    await expect(parsePcAxisMetadata(path)).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
      context: expect.objectContaining({ dimension: "Place" }),
    });
  });

  it.each([
    {
      name: "qualified VALUES for an unknown dimension",
      variant: 'VALUES[en]("Other")="English";',
    },
    {
      name: "qualified CODES for an unknown dimension",
      variant: 'CODES[en]("Other")="E";',
    },
    {
      name: "qualified VALUES with the wrong cardinality",
      variant: 'VALUES[en]("Place")="One";',
    },
    {
      name: "qualified CODES with the wrong cardinality",
      variant: 'CODES[en]("Place")="01";',
    },
  ])("rejects $name", async ({ variant }) => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="language variants";
STUB="Place";
VALUES("Place")="A","B";
${variant}
DATA=1 2;`);

    await expect(parsePcAxisMetadata(path)).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
      exitCode: 6,
    });
  });

  it("applies dimension, per-dimension value, and overflow-safe cell bounds", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="x";
STUB="A";
HEADING="B";
VALUES("A")="a1","a2";
VALUES("B")="b1","b2";
DATA=1 2 3 4;`);

    await expect(parsePcAxisMetadata(path, limits({ maxDimensions: 1 }))).rejects.toMatchObject({
      code: "PCAXIS_DIMENSION_LIMIT",
    });
    await expect(
      parsePcAxisMetadata(path, limits({ maxValuesPerDimension: 1 })),
    ).rejects.toMatchObject({ code: "PCAXIS_DIMENSION_LIMIT" });
    await expect(parsePcAxisMetadata(path, limits({ maxCells: 3 }))).rejects.toMatchObject({
      code: "PCAXIS_CELL_LIMIT",
    });
  });

  it.each([
    { name: "short", data: "1", actual: 1 },
    { name: "excess", data: "1 2 3", actual: 3 },
  ])("rejects $name dense DATA and removes partial staging output", async ({ data, actual }) => {
    const { directory, path } = await fixture(minimal(data));
    const output = join(directory, "rows.ndjson");

    await expect(writePcAxisRowsAsNdjson(path, output)).rejects.toMatchObject({
      code: "PCAXIS_CELL_COUNT_MISMATCH",
      context: { expected: 2, actual },
    });
    await expect(access(output)).rejects.toThrow();
  });

  it("rejects unsupported code pages and KEYS with stable typed errors", async () => {
    const unsupported = await fixture(
      `CODEPAGE="iso-8859-2";MATRIX="x";STUB="A";VALUES("A")="a";DATA=1;`,
    );
    await expect(parsePcAxisMetadata(unsupported.path)).rejects.toMatchObject({
      code: "PCAXIS_ENCODING_UNSUPPORTED",
      exitCode: 5,
      context: { codepage: "iso-8859-2" },
    });

    const keyed = await fixture(
      `CODEPAGE="utf-8";MATRIX="x";STUB="A";VALUES("A")="a";KEYS("A")=VALUES;DATA=1;`,
    );
    await expect(parsePcAxisMetadata(keyed.path)).rejects.toMatchObject({
      code: "PCAXIS_KEYS_UNSUPPORTED",
      exitCode: 5,
    });
  });

  it.each(['"1"', '"1.5"', '"1e2"'])("rejects quoted numeric DATA token %s", async (token) => {
    const { path } = await fixture(minimal(`${token} 2`));
    await expect(previewPcAxis(path, { limit: 2 })).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
    });
  });

  it("rejects unquoted multi-value metadata lists", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="x";
STUB=A,B;
VALUES("A")="a";
VALUES("B")="b";
DATA=1;`);
    await expect(parsePcAxisMetadata(path)).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
    });
  });

  it.each([
    {
      name: "an adjacent quoted VALUES list without a comma",
      statement: 'VALUES("A")="a" "b";',
    },
    {
      name: "junk after a quoted NOTEX scalar",
      statement: 'VALUES("A")="a";NOTEX="note"junk;',
    },
    {
      name: "junk after a continued NOTEX scalar",
      statement: 'VALUES("A")="a";NOTEX="first " "second"junk;',
    },
    {
      name: "an unterminated NOTEX continuation",
      statement: 'VALUES("A")="a";NOTEX="first " "second;',
    },
    {
      name: "a mixed quoted and unquoted VALUES list",
      statement: 'VALUES("A")="a",b;',
    },
  ])("rejects $name", async ({ statement }) => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="controls";
STUB="A";
${statement}
DATA=1;`);

    await expect(parsePcAxisMetadata(path)).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
      exitCode: 6,
    });
  });

  it("applies the decoded-string bound to the concatenated NOTEX scalar", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="notes";
STUB="A";
VALUES("A")="a";
NOTEX="12345678"
  "90123456";
DATA=1;`);

    await expect(
      parsePcAxisMetadata(path, limits({ maxDecodedStringBytes: 12 })),
    ).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
      exitCode: 6,
    });
  });

  it("applies source, metadata, statement, and decoded-string byte bounds", async () => {
    const { path } = await fixture(minimal());
    const sourceBytes = Buffer.byteLength(minimal());

    await expect(
      parsePcAxisMetadata(path, limits({ maxSourceBytes: sourceBytes - 1 })),
    ).rejects.toMatchObject({ code: "INVALID_PCAXIS_DATA" });
    await expect(parsePcAxisMetadata(path, limits({ maxMetadataBytes: 20 }))).rejects.toMatchObject(
      { code: "INVALID_PCAXIS_DATA" },
    );
    await expect(
      parsePcAxisMetadata(path, limits({ maxStatementBytes: 10 })),
    ).rejects.toMatchObject({ code: "INVALID_PCAXIS_DATA" });
    await expect(
      parsePcAxisMetadata(path, limits({ maxDecodedStringBytes: 4 })),
    ).rejects.toMatchObject({ code: "INVALID_PCAXIS_DATA" });
    await expect(
      parsePcAxisMetadata(path, limits({ maxMetadataStatements: 5 })),
    ).rejects.toMatchObject({ code: "INVALID_PCAXIS_DATA" });
  });

  it("bounds notes and language-qualified metadata variants", async () => {
    const notes = await fixture(`CODEPAGE="utf-8";
MATRIX="x";
STUB="A";
VALUES("A")="a";
NOTE="one";
NOTE="two";
DATA=1;`);
    await expect(parsePcAxisMetadata(notes.path, limits({ maxNotes: 1 }))).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
    });

    const languages = await fixture(`CODEPAGE="utf-8";
MATRIX="x";
TITLE[en]="English";
TITLE[de]="Deutsch";
STUB="A";
VALUES("A")="a";
DATA=1;`);
    await expect(
      parsePcAxisMetadata(languages.path, limits({ maxLanguageVariants: 1 })),
    ).rejects.toMatchObject({ code: "INVALID_PCAXIS_DATA" });
  });

  it("applies the per-dimension value bound to language-qualified VALUES", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="x";
STUB="A";
VALUES("A")="a";
VALUES[en]("A")="one","two";
DATA=1;`);

    await expect(
      parsePcAxisMetadata(path, limits({ maxValuesPerDimension: 1 })),
    ).rejects.toMatchObject({ code: "PCAXIS_DIMENSION_LIMIT" });
  });

  it("preserves special dimension names as own output columns", async () => {
    const { path } = await fixture(`CODEPAGE="utf-8";
MATRIX="special";
STUB="__proto__";
VALUES("__proto__")="safe";
DATA=1;`);

    const preview = await previewPcAxis(path, { limit: 1 });
    expect(preview.columns).toEqual(["__proto__", "value"]);
    expect(Object.hasOwn(preview.rows[0] ?? {}, "__proto__")).toBe(true);
    expect(JSON.stringify(preview.rows[0])).toBe('{"__proto__":"safe","value":1}');
  });

  it("does not remove a pre-existing staging target when exclusive creation fails", async () => {
    const { directory, path } = await fixture(minimal());
    const output = join(directory, "existing.ndjson");
    await writeFile(output, "keep me");

    await expect(writePcAxisRowsAsNdjson(path, output)).rejects.toMatchObject({
      code: "INVALID_PCAXIS_DATA",
    });
    await expect(readFile(output, "utf8")).resolves.toBe("keep me");
  });

  it("bounds per-cell tokens, emitted records, and staging bytes with cleanup", async () => {
    const { directory, path } = await fixture(minimal("12345 2"));
    const output = join(directory, "rows.ndjson");

    await expect(
      writePcAxisRowsAsNdjson(path, output, {}, limits({ maxCellTokenBytes: 4 })),
    ).rejects.toMatchObject({ code: "INVALID_PCAXIS_DATA" });
    await expect(access(output)).rejects.toThrow();

    await expect(
      writePcAxisRowsAsNdjson(path, output, {}, limits({ maxEmittedRecords: 1 })),
    ).rejects.toMatchObject({ code: "PCAXIS_CELL_LIMIT" });
    await expect(access(output)).rejects.toThrow();

    await expect(
      writePcAxisRowsAsNdjson(path, output, {}, limits({ maxStagingBytes: 1 })),
    ).rejects.toMatchObject({ code: "PCAXIS_CELL_LIMIT" });
    await expect(access(output)).rejects.toThrow();
  });

  it("honors abort signals without leaving staging output", async () => {
    const { directory, path } = await fixture(minimal());
    const output = join(directory, "rows.ndjson");
    const controller = new AbortController();
    controller.abort(new Error("stop"));

    await expect(
      writePcAxisRowsAsNdjson(path, output, { signal: controller.signal }),
    ).rejects.toThrow("stop");
    await expect(access(output)).rejects.toThrow();
  });

  it("removes partial staging output after a mid-stream abort", async () => {
    const { directory, path } = await fixture(minimal());
    const output = join(directory, "rows.ndjson");
    const reason = new Error("mid-stream stop");
    let checks = 0;
    let aborted = false;
    const signal = {
      get aborted(): boolean {
        return aborted;
      },
      get reason(): unknown {
        return reason;
      },
      throwIfAborted(): void {
        checks += 1;
        if (checks === 8) {
          aborted = true;
          throw reason;
        }
      },
    } as unknown as AbortSignal;

    await expect(writePcAxisRowsAsNdjson(path, output, { signal })).rejects.toThrow(
      "mid-stream stop",
    );
    await expect(access(output)).rejects.toThrow();
  });
});
