import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json?: unknown;
}

let baseUrl: string;
let temporaryHome: string;
let fixtureServer: ReturnType<typeof createServer>;
const requests: Array<{ readonly method: string; readonly path: string; readonly body?: unknown }> =
  [];

async function jsonFixture(name: string): Promise<unknown> {
  const path = resolve(process.cwd(), `packages/testing/fixtures/opsi/${name}.json`);
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return chunks.length === 0
    ? undefined
    : (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
}

function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

beforeAll(async () => {
  temporaryHome = await mkdtemp(join(tmpdir(), "opsi-cli-e2e-"));
  fixtureServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const requestBody = await body(request);
    requests.push({
      method: request.method ?? "GET",
      path: url.pathname,
      ...(requestBody === undefined ? {} : { body: requestBody }),
    });
    if (url.pathname === "/package_search") {
      respond(response, 200, await jsonFixture("package-search"));
      return;
    }
    if (url.pathname === "/package_show" && url.searchParams.get("id") === "missing") {
      respond(response, 404, await jsonFixture("error"));
      return;
    }
    if (url.pathname === "/package_show") {
      respond(response, 200, await jsonFixture("package-show"));
      return;
    }
    if (url.pathname === "/resource_show") {
      respond(response, 200, await jsonFixture("resource-show"));
      return;
    }
    respond(response, 404, { success: false, error: { message: "fixture route missing" } });
  });
  fixtureServer.listen(0, "127.0.0.1");
  await once(fixtureServer, "listening");
  const address = fixtureServer.address();
  if (address === null || typeof address === "string") throw new Error("fixture server failed");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  fixtureServer.close();
  await once(fixtureServer, "close");
  await rm(temporaryHome, { recursive: true, force: true });
});

async function cli(argv: readonly string[]): Promise<CliResult> {
  const child = spawn(
    process.execPath,
    [resolve(process.cwd(), "apps/cli/dist/main.js"), ...argv],
    {
      cwd: temporaryHome,
      env: {
        ...process.env,
        HOME: temporaryHome,
        OPSI_CACHE_DIR: join(temporaryHome, "cache"),
        OPSI_DOWNLOAD_DIR: join(temporaryHome, "downloads"),
        OPSI_BASE_URL: baseUrl,
        OPSI_REQUEST_INTERVAL_MS: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const [exitCode] = (await once(child, "exit")) as [number];
  let json: unknown;
  if (stdout.trim().length > 0) {
    try {
      json = JSON.parse(stdout) as unknown;
    } catch {
      json = undefined;
    }
  }
  return { exitCode, stdout, stderr, ...(json === undefined ? {} : { json }) };
}

describe("catalogue CLI", () => {
  it("searches OPSI through the controlled fixture server", async () => {
    const result = await cli(["search", "promet", "--json", "--limit", "2"]);

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      json: {
        schemaVersion: "1",
        data: [
          {
            id: "dataset-abc",
            providerId: "opsi",
            reference: "opsi:dataset:dataset-abc",
          },
        ],
      },
    });
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "POST",
        path: "/package_search",
        body: expect.objectContaining({ q: "promet", rows: 2 }),
      }),
    );
  });

  it("returns stable not-found status and structured error", async () => {
    const result = await cli(["dataset", "show", "missing", "--json"]);

    expect(result).toMatchObject({
      exitCode: 3,
      stderr: "",
      json: {
        schemaVersion: "1",
        data: null,
        error: { code: "DATASET_NOT_FOUND", exitCode: 3 },
      },
    });
  });

  it("shows datasets, embedded resources, resources, and providers", async () => {
    await expect(cli(["dataset", "show", "dataset-abc", "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { reference: "opsi:dataset:dataset-abc" } },
    });
    await expect(cli(["dataset", "resources", "dataset-abc", "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: [{ reference: "opsi:resource:resource-1" }] },
    });
    await expect(cli(["resource", "show", "resource-1", "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { reference: "opsi:resource:resource-1" } },
    });
    await expect(cli(["providers", "list", "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: {
        data: [
          { id: "local", name: "Local files", capabilities: ["resolve-resource"] },
          { id: "opsi", name: "OPSI" },
        ],
      },
    });
  });
});
