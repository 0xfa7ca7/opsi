import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectFormat } from "../src/index.js";

const temporary: string[] = [];

async function fileNamed(name: string, contents: string | Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "klopsi-detect-"));
  temporary.push(directory);
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("format detection", () => {
  it("lets a Parquet signature outrank a misleading extension", async () => {
    const path = await fileNamed("wrong.csv", Buffer.from("PAR1fixturePAR1"));

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "parquet",
      confidence: "signature",
    });
  });

  it("requires matching leading and trailing Parquet magic", async () => {
    const path = await fileNamed("leading-only.csv", Buffer.from("PAR1not-parquet"));

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "csv",
      confidence: "extension",
    });
  });

  it("lets bounded JSON content outrank a misleading extension", async () => {
    const path = await fileNamed("wrong.csv", '[{"mesto":"Ljubljana"}]');

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "json",
      confidence: "content",
    });
  });

  it("honors an explicit media type before content or extension", async () => {
    const path = await fileNamed("wrong.tsv", "a,b\n1,2\n");

    await expect(detectFormat({ path, mediaType: "text/csv" })).resolves.toMatchObject({
      format: "csv",
      confidence: "media-type",
    });
  });

  it("detects generic ZIP content as unsupported instead of assuming XLSX", async () => {
    const path = await fileNamed("archive.xlsx", Buffer.from("PK\u0003\u0004not-an-xlsx"));

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "zip",
      confidence: "signature",
    });
  });

  it("does not alter source bytes while detecting", async () => {
    const path = await fileNamed("unicode.csv", "mesto\nŠkofja Loka\n");
    const before = await readFile(path);

    await detectFormat(path);

    expect(await readFile(path)).toEqual(before);
  });

  it("does not mistake ordinary text beginning with PK for a ZIP signature", async () => {
    const path = await fileNamed("prefix.csv", "PK,value\n1,open\n");

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "csv",
      confidence: "content",
    });
  });

  it("uses declared provider format before an extension fallback", async () => {
    const path = await fileNamed("cache-object", "header\nvalue\n");

    await expect(
      detectFormat({
        path,
        mediaType: "application/octet-stream",
        declaredFormat: "CSV",
      }),
    ).resolves.toMatchObject({ format: "csv", confidence: "declared-format" });
  });

  it("recognizes the .px extension as PC-Axis", async () => {
    const path = await fileNamed("table.px", "metadata without delimiters");

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "pcaxis",
      confidence: "extension",
    });
  });

  it.each(["PCAXIS", "PC-Axis", "PX"])(
    "accepts %s as a declared PC-Axis format",
    async (declaredFormat) => {
      const path = await fileNamed("cache-object", "metadata without delimiters");

      await expect(detectFormat({ path, declaredFormat })).resolves.toMatchObject({
        format: "pcaxis",
        confidence: "declared-format",
      });
    },
  );

  it("recognizes the PC-Axis media type", async () => {
    const path = await fileNamed("cache-object", "metadata without delimiters");

    await expect(detectFormat({ path, mediaType: "text/x-pcaxis" })).resolves.toMatchObject({
      format: "pcaxis",
      confidence: "media-type",
    });
  });

  it("detects a Windows-1250 PC-Axis signature before comma-delimited content", async () => {
    const path = await fileNamed(
      "misleading.csv",
      Buffer.from(
        'CHARSET="ANSI";\nAXIS-VERSION="2010";\nCODEPAGE="windows-1250";\nDATA="one,two,three";',
        "latin1",
      ),
    );

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "pcaxis",
      confidence: "content",
      encoding: "windows-1250",
    });
  });

  it("detects a UTF-8 PC-Axis signature before comma-delimited content", async () => {
    const path = await fileNamed(
      "misleading.csv",
      'CHARSET="UTF-8";\nAXIS-VERSION="2010";\nCODEPAGE="UTF-8";\nDATA="one,two,three";',
    );

    await expect(detectFormat(path)).resolves.toMatchObject({
      format: "pcaxis",
      confidence: "content",
      encoding: "utf-8",
    });
  });
});
