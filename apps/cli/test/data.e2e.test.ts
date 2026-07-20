import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json?: unknown;
}

let home: string;
let baseUrl: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "opsi-data-e2e-"));
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/data.csv") {
      response.writeHead(200, { "content-type": "text/csv" });
      response.end("id,mesto\n1,Ljubljana\n2,Škofja Loka\n");
      return;
    }
    if (url.pathname === "/resource_show") {
      const mediaOnly = url.searchParams.get("id") === "resource-media";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          result: {
            id: mediaOnly ? "resource-media" : "resource-data",
            package_id: mediaOnly ? "dataset-media" : "dataset-data",
            name: "Rows",
            url: `${baseUrl}/data.csv`,
            format: mediaOnly ? null : "CSV",
            mimetype: mediaOnly ? "text/csv" : null,
          },
        }),
      );
      return;
    }
    if (url.pathname === "/package_show") {
      const mediaOnly = url.searchParams.get("id") === "dataset-media";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          result: {
            id: mediaOnly ? "dataset-media" : "dataset-data",
            name: mediaOnly ? "dataset-media" : "dataset-data",
            title: "Dataset",
            notes: "Description",
            metadata_modified: "2026-07-10T12:00:00Z",
            license_id: "cc-by",
            license_title: "CC BY",
            organization: { id: "org", name: "org", title: "Org" },
            tags: [],
            resources: mediaOnly
              ? [
                  {
                    id: "resource-media",
                    name: "Rows",
                    url: `${baseUrl}/data.csv`,
                    format: null,
                    mimetype: "text/csv",
                  },
                ]
              : [
                  {
                    id: "resource-data",
                    name: "Rows",
                    url: `${baseUrl}/data.csv`,
                    format: "CSV",
                  },
                  {
                    id: "resource-other",
                    name: "Other",
                    url: `${baseUrl}/other.tsv`,
                    format: "TSV",
                  },
                ],
          },
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: false, error: { message: "missing fixture" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server failed");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
  await rm(home, { recursive: true, force: true });
});

async function cli(argv: readonly string[]): Promise<CliResult> {
  const child = spawn(process.execPath, [resolve("apps/cli/dist/main.js"), ...argv], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPSI_CACHE_DIR: join(home, "cache"),
      OPSI_DOWNLOAD_DIR: join(home, "downloads"),
      OPSI_BASE_URL: baseUrl,
      OPSI_OFFLINE: "0",
      OPSI_REQUEST_INTERVAL_MS: "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const [exitCode] = (await once(child, "exit")) as [number];
  let json: unknown;
  try {
    json = JSON.parse(stdout) as unknown;
  } catch {
    json = undefined;
  }
  return { exitCode, stdout, stderr, ...(json === undefined ? {} : { json }) };
}

describe("data CLI", () => {
  it("previews an explicitly selected entry from a local ZIP archive", async () => {
    const archive = join(home, "multiple.zip");
    await writeFile(
      archive,
      zipSync({ "a.csv": strToU8("id,name\n1,Ljubljana\n"), "b.csv": strToU8("id,name\n2,Maribor\n") }),
    );
    await expect(cli(["resource", "preview", archive, "--json"])).resolves.toMatchObject({
      exitCode: 2,
      json: { error: { code: "ARCHIVE_ENTRY_REQUIRED", nextActions: expect.any(Array) } },
    });
    await expect(
      cli(["resource", "preview", archive, "--entry", "b.csv", "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: { data: [{ id: "2", name: "Maribor" }] },
    });
  });

  it("uses an explicit XML record path when discovery is ambiguous", async () => {
    const source = join(home, "ambiguous.xml");
    await writeFile(source, "<root><a><id>1</id></a><a><id>2</id></a><b><id>3</id></b><b><id>4</id></b></root>");
    await expect(cli(["resource", "preview", source, "--json"])).resolves.toMatchObject({
      exitCode: 2,
      json: { error: { code: "XML_RECORD_PATH_REQUIRED", context: { choices: ["/root/a", "/root/b"] } } },
    });
    await expect(
      cli(["resource", "preview", source, "--record-path", "/root/b", "--json"]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: [{ id: "3" }, { id: "4" }] } });
  });

  it("previews local paths and canonical resources with bounded rows", async () => {
    const local = resolve("packages/testing/fixtures/data/valid.csv");
    await expect(
      cli(["resource", "preview", local, "--json", "--limit", "2"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stderr: "",
      json: {
        data: [
          { id: "1", mesto: "Ljubljana" },
          { id: "2", mesto: "Škofja Loka" },
        ],
        meta: { returnedCount: 2, truncated: true },
      },
    });
    await expect(
      cli([
        "resource",
        "preview",
        "opsi:resource:resource-data",
        "--json",
        "--allow-private-network",
        "--allow-insecure-http",
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: {
        data: [
          { id: "1", mesto: "Ljubljana" },
          { id: "2", mesto: "Škofja Loka" },
        ],
      },
    });
  });

  it("requires explicit XLSX sheets and supports structured JSON and NDJSON inputs", async () => {
    const xlsx = resolve("packages/testing/fixtures/data/data.xlsx");
    await expect(cli(["resource", "preview", xlsx, "--json"])).resolves.toMatchObject({
      exitCode: 2,
      json: { error: { code: "SHEET_REQUIRED" } },
    });
    await expect(
      cli(["resource", "preview", xlsx, "--sheet", "Cities", "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: { data: expect.arrayContaining([expect.objectContaining({ double_id: "=A2*2" })]) },
    });
    await expect(
      cli(["resource", "preview", resolve("packages/testing/fixtures/data/data.ndjson"), "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: {
        data: [
          { id: 1, mesto: "Ljubljana" },
          { id: 2, mesto: "Škofja Loka" },
        ],
      },
    });
  });

  it("uses integrity exit 6 only for validation errors", async () => {
    await expect(
      cli(["validate", resolve("packages/testing/fixtures/data/valid.csv"), "--json"]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: { valid: true } } });
    await expect(
      cli(["validate", resolve("packages/testing/fixtures/data/malformed.csv"), "--json"]),
    ).resolves.toMatchObject({
      exitCode: 6,
      json: { data: { valid: false }, error: { code: "VALIDATION_FAILED" } },
    });
  });

  it("rejects malformed ZIP data and reports explicit dataset ambiguity", async () => {
    const zip = join(home, "archive.zip");
    await writeFile(zip, Buffer.from("PK\u0003\u0004fixture"));
    await expect(cli(["resource", "preview", zip, "--json"])).resolves.toMatchObject({
      exitCode: 6,
      json: {
        error: { code: "INVALID_ARCHIVE_DATA" },
      },
    });
    await expect(cli(["dataset", "schema", "dataset-data", "--json"])).resolves.toMatchObject({
      exitCode: 2,
      json: {
        error: {
          code: "AMBIGUOUS_RESOURCE",
          context: { choices: expect.arrayContaining(["resource-data", "resource-other"]) },
        },
      },
    });
    const human = await cli(["validate", resolve("packages/testing/fixtures/data/malformed.csv")]);
    expect(human).toMatchObject({ exitCode: 6 });
    expect(human.stdout).toContain("INCONSISTENT_COLUMN_COUNT");
  });

  it("validates typed metadata without fetching resource content", async () => {
    await expect(
      cli(["validate", "opsi:dataset:dataset-data", "--metadata", "--json"]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: { valid: true } } });
  });

  it("selects a sole tabular dataset resource by definitive media type", async () => {
    await expect(
      cli([
        "dataset",
        "schema",
        "dataset-media",
        "--json",
        "--allow-private-network",
        "--allow-insecure-http",
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { format: "csv", fields: expect.any(Array) } },
    });
  });

  it("rejects a canonical --resource from another provider", async () => {
    await expect(
      cli([
        "dataset",
        "schema",
        "dataset-data",
        "--resource",
        "other:resource:resource-data",
        "--json",
      ]),
    ).resolves.toMatchObject({
      exitCode: 2,
      json: { error: { code: "RESOURCE_PROVIDER_MISMATCH" } },
    });
  });
});
