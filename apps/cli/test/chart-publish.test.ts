import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProvenanceStore } from "@klopsi/storage";
import { publishChart, type ChartTransformation } from "../src/chart/publish.js";

let root: string;
let source: string;
let output: string;

const transformation: ChartTransformation = {
  rendererVersion: "1",
  type: "bar",
  x: "city",
  y: "value",
  title: "Values",
  limit: 100,
  points: 2,
  truncated: false,
  order: "source",
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "klopsi-chart-publish-"));
  source = join(root, "input.csv");
  output = join(root, "chart.html");
  await writeFile(source, "city,value\nLjubljana,1\nMaribor,2\n");
});

afterEach(async () => rm(root, { recursive: true, force: true }));

describe("chart artifact publication", () => {
  it("publishes an HTML/provenance pair that passes existing verification", async () => {
    const result = await publishChart({
      source,
      output,
      html: "<!doctype html><title>Values</title>\n",
      force: false,
      transformation,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      output: resolve(output),
      provenancePath: `${resolve(output)}.provenance.json`,
      sha256: expect.stringMatching(/^[a-f\d]{64}$/u),
      bytes: 37,
    });
    expect(await readFile(output, "utf8")).toBe("<!doctype html><title>Values</title>\n");
    await expect(new ProvenanceStore().verify(output)).resolves.toMatchObject({
      valid: true,
      sha256: result.sha256,
      bytes: result.bytes,
    });
  });

  it("records the chart transformation and input digest", async () => {
    await publishChart({
      source,
      output,
      html: "<!doctype html>\n",
      force: false,
      transformation,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    const sidecar = JSON.parse(await readFile(`${output}.provenance.json`, "utf8")) as {
      schemaVersion: string;
      retrievedAt: string;
      mediaType: string;
      localPath: string;
      transformations: Array<{
        operation: string;
        timestamp: string;
        inputSha256: string;
        details: ChartTransformation;
      }>;
    };

    expect(sidecar).toMatchObject({
      schemaVersion: "1",
      retrievedAt: "2026-07-24T12:00:00.000Z",
      mediaType: "text/html",
      localPath: resolve(output),
      transformations: [
        {
          operation: "chart",
          timestamp: "2026-07-24T12:00:00.000Z",
          inputSha256: expect.stringMatching(/^[a-f\d]{64}$/u),
          details: transformation,
        },
      ],
    });
  });

  it("accepts a resolved source digest after provider temporary input cleanup", async () => {
    const sourceSha256 = "a".repeat(64);
    await publishChart({
      sourceSha256,
      output,
      html: "<!doctype html>\n",
      force: false,
      transformation,
    });
    const sidecar = await readFile(`${output}.provenance.json`, "utf8");
    expect(sidecar).toContain(`"inputSha256": "${sourceSha256}"`);
  });

  it("refuses an existing pair without force and replaces both files with force", async () => {
    await publishChart({
      source,
      output,
      html: "first\n",
      force: false,
      transformation,
    });

    await expect(
      publishChart({
        source,
        output,
        html: "second\n",
        force: false,
        transformation: { ...transformation, title: "Second" },
      }),
    ).rejects.toMatchObject({ code: "CHART_DESTINATION_EXISTS", exitCode: 2 });
    expect(await readFile(output, "utf8")).toBe("first\n");

    const replaced = await publishChart({
      source,
      output,
      html: "second\n",
      force: true,
      transformation: { ...transformation, title: "Second" },
    });
    expect(await readFile(output, "utf8")).toBe("second\n");
    await expect(new ProvenanceStore().verify(output)).resolves.toMatchObject({
      sha256: replaced.sha256,
    });
    const sidecar = await readFile(`${output}.provenance.json`, "utf8");
    expect(sidecar).toContain('"title": "Second"');
    expect(sidecar).not.toContain('"title": "Values"');
  });

  it("requires an HTML output before creating files", async () => {
    const invalid = join(root, "chart.svg");
    await expect(
      publishChart({
        source,
        output: invalid,
        html: "<svg></svg>\n",
        force: false,
        transformation,
      }),
    ).rejects.toMatchObject({ code: "CHART_OUTPUT_FORMAT", exitCode: 2 });
    await expect(readFile(invalid, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
