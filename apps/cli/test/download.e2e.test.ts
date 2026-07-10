import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let home: string;
let apiUrl: string;
let fileUrl: string;
let requests = 0;
let api: ReturnType<typeof createServer>;
let files: ReturnType<typeof createServer>;
const json = (response: ServerResponse, value: unknown) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "opsi-download-e2e-"));
  files = createServer((request, response) => {
    requests++;
    if (request.method === "HEAD") {
      response.writeHead(200, { "content-type": "text/plain", "content-length": "5" });
      response.end();
    } else {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("hello");
    }
  });
  files.listen(0, "127.0.0.1");
  await once(files, "listening");
  const fileAddress = files.address();
  if (fileAddress === null || typeof fileAddress === "string")
    throw new Error("file listen failed");
  fileUrl = `http://127.0.0.1:${fileAddress.port}/download.txt`;
  api = createServer((request, response) => {
    requests++;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/resource_show" && url.searchParams.get("id") === "missing") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, error: { message: "not found" } }));
    } else if (url.pathname === "/resource_show")
      json(response, {
        success: true,
        result: {
          id: "resource-1",
          package_id: "dataset-abc",
          name: "Download",
          url: fileUrl,
          format: "TXT",
        },
      });
    else if (url.pathname === "/package_search")
      json(response, {
        success: true,
        result: {
          count: 1,
          results: [
            {
              id: "dataset-abc",
              title: "Dataset",
              resources: [{ id: "resource-1", url: fileUrl, format: "TXT" }],
            },
          ],
          facets: {},
          search_facets: {},
        },
      });
    else response.writeHead(404).end();
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiAddress = api.address();
  if (apiAddress === null || typeof apiAddress === "string") throw new Error("api listen failed");
  apiUrl = `http://127.0.0.1:${apiAddress.port}`;
});
afterAll(async () => {
  api.close();
  files.close();
  await Promise.all([once(api, "close"), once(files, "close")]);
  await rm(home, { recursive: true, force: true });
});
async function cli(
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string; json?: unknown }> {
  const child = spawn(process.execPath, [resolve("apps/cli/dist/main.js"), ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPSI_CACHE_DIR: join(home, "cache"),
      OPSI_DOWNLOAD_DIR: join(home, "downloads"),
      OPSI_BASE_URL: apiUrl,
      OPSI_REQUEST_INTERVAL_MS: "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value: string) => (stdout += value));
  child.stderr.on("data", (value: string) => (stderr += value));
  const [exitCode] = (await once(child, "exit")) as [number];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    parsed = undefined;
  }
  return { exitCode, stdout, stderr, ...(parsed === undefined ? {} : { json: parsed }) };
}

describe("download, cache, offline, and provenance CLI", () => {
  it("downloads securely, probes headers, verifies provenance, and reuses metadata offline", async () => {
    const target = join(home, "artifact.txt");
    await expect(
      cli([
        "resource",
        "headers",
        "resource-1",
        "--allow-insecure-http",
        "--allow-private-network",
        "--json",
      ]),
    ).resolves.toMatchObject({ exitCode: 0, stderr: "", json: { data: { status: 200 } } });
    const afterOnlineHeaders = requests;
    await expect(
      cli(["resource", "headers", "resource-1", "--offline", "--json"]),
    ).resolves.toMatchObject({ exitCode: 3, stderr: "" });
    expect(requests).toBe(afterOnlineHeaders);
    const download = await cli([
      "download",
      "resource-1",
      "--destination",
      target,
      "--allow-insecure-http",
      "--allow-private-network",
      "--json",
    ]);
    expect(download).toMatchObject({
      exitCode: 0,
      stderr: "",
      json: { data: { bytes: 5, path: target } },
    });
    expect(await readFile(target, "utf8")).toBe("hello");
    await expect(cli(["provenance", "verify", target, "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { valid: true } },
    });
    const offlineTarget = join(home, "artifact-offline.txt");
    const beforeOfflineDownload = requests;
    await expect(
      cli(["download", "resource-1", "--destination", offlineTarget, "--offline", "--json"]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: { bytes: 5, path: offlineTarget } } });
    expect(await readFile(offlineTarget, "utf8")).toBe("hello");
    expect(requests).toBe(beforeOfflineDownload);
    const blockedTarget = join(home, "blocked.txt");
    await writeFile(blockedTarget, "existing-different-content");
    await expect(
      cli([
        "download",
        "resource-1",
        "--destination",
        blockedTarget,
        "--allow-insecure-http",
        "--allow-private-network",
        "--json",
      ]),
    ).resolves.toMatchObject({ exitCode: 2 });
    expect(await readFile(blockedTarget, "utf8")).toBe("existing-different-content");
    await expect(lstat(`${blockedTarget}.provenance.json`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(cli(["search", "dataset", "--json"])).resolves.toMatchObject({ exitCode: 0 });
    const onlineRequests = requests;
    await expect(cli(["search", "dataset", "--offline", "--json"])).resolves.toMatchObject({
      exitCode: 0,
    });
    expect(requests).toBe(onlineRequests);
    await expect(cli(["cache", "info", "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { metadata: expect.any(Number) } },
    });
    const partial = await cli([
      "download",
      "resource-1",
      "missing",
      "--allow-insecure-http",
      "--allow-private-network",
      "--json",
    ]);
    expect(partial.exitCode).toBe(8);
    expect(partial.stderr).toBe("");
    expect(() => JSON.parse(partial.stdout)).not.toThrow();
    expect(JSON.parse(partial.stdout)).toMatchObject({
      data: [expect.objectContaining({ bytes: 5 })],
      error: { code: "PARTIAL_DOWNLOAD" },
      meta: { failures: [expect.anything()] },
    });
  }, 30_000);
});
