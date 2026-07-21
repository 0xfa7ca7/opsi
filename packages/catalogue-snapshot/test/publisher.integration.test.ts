import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpsiProvider, OpsiTransport, RequestScheduler } from "@klopsi/provider-opsi";
import { afterEach, describe, expect, it } from "vitest";
import {
  CATALOGUE_SCHEMA_VERSION,
  StrictHttpsReader,
  buildPublication,
  type CatalogueIndex,
  type CatalogueSnapshot,
} from "@klopsi/catalogue-snapshot";
import { runPublisher, type PublisherRuntime } from "../src/publish-entry.js";
import { runPublicVerifier, type VerifierRuntime } from "../src/verify-entry.js";

const now = new Date("2026-07-13T12:00:00.000Z");
const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("catalogue publisher", () => {
  it("assembles only the current and retained v1 artifacts with newline-terminated JSON", async () => {
    const prior = buildPublication(snapshot("2026-07-12T12:00:00.000Z", 2));
    const previousBaseUrl = await previousSite({
      index: { schemaVersion: CATALOGUE_SCHEMA_VERSION, snapshots: [prior.manifest] },
      snapshots: new Map([[prior.manifest.snapshotPath, prior.snapshotBytes]]),
    });
    const provider = await controlledProvider(2);
    const { output, stdout, runtime } = await fixtureRuntime(provider);

    await runPublisher(["--output", output, "--previous-base-url", previousBaseUrl], runtime);

    expect(await listFiles(join(output, "v1"))).toEqual([
      "index.json",
      "latest.json",
      "snapshots/2026-07-12T12-00-00.000Z.json",
      "snapshots/2026-07-13T12-00-00.000Z.json",
    ]);
    for (const path of [
      "v1/index.json",
      "v1/latest.json",
      prior.manifest.snapshotPath,
      "v1/snapshots/2026-07-13T12-00-00.000Z.json",
      "deployment.json",
    ]) {
      expect(await readFile(join(output, path), "utf8")).toMatch(/[^\n]\n$/u);
    }

    const latest = JSON.parse(await readFile(join(output, "v1/latest.json"), "utf8")) as {
      sha256: string;
      generatedAt: string;
    };
    const deployment = JSON.parse(
      await readFile(join(output, "deployment.json"), "utf8"),
    ) as unknown;
    expect(deployment).toEqual({ sha256: latest.sha256, generatedAt: latest.generatedAt });
    expect(stdout).toEqual([`${JSON.stringify(deployment)}\n`]);
  });

  it("treats an index 404 as the first publication", async () => {
    const previousBaseUrl = await listen((_request, response) => response.writeHead(404).end());
    const provider = await controlledProvider(2);
    const { output, runtime } = await fixtureRuntime(provider);

    await runPublisher(["--output", output, "--previous-base-url", previousBaseUrl], runtime);

    expect(await listFiles(join(output, "v1"))).toEqual([
      "index.json",
      "latest.json",
      "snapshots/2026-07-13T12-00-00.000Z.json",
    ]);
  });

  it("rejects a schema-valid empty prior index instead of treating it as first publication", async () => {
    const previousBaseUrl = await previousSite({
      index: { schemaVersion: CATALOGUE_SCHEMA_VERSION, snapshots: [] },
      snapshots: new Map(),
    });
    const provider = await controlledProvider(2);
    const { output, runtime } = await fixtureRuntime(provider);

    await expect(
      runPublisher(["--output", output, "--previous-base-url", previousBaseUrl], runtime),
    ).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_INVALID",
      context: { field: "snapshots" },
    });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a same-origin index redirect to a 404 without following it", async () => {
    let redirectedRequests = 0;
    const previousBaseUrl = await listen((request, response) => {
      if (request.url === "/v1/index.json") {
        response.writeHead(302, { location: "/missing-index.json" }).end();
      } else {
        redirectedRequests += 1;
        response.writeHead(404).end();
      }
    });
    const provider = await controlledProvider(2);
    const { output, runtime } = await fixtureRuntime(provider);

    await expect(
      runPublisher(["--output", output, "--previous-base-url", previousBaseUrl], runtime),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_UNAVAILABLE" });
    expect(redirectedRequests).toBe(0);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on non-404 prior retrieval failures", async () => {
    const previousBaseUrl = await listen((_request, response) => response.writeHead(503).end());
    const provider = await controlledProvider(2);
    const { output, runtime } = await fixtureRuntime(provider);

    await expect(
      runPublisher(["--output", output, "--previous-base-url", previousBaseUrl], runtime),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_UNAVAILABLE" });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not copy an invalid retained artifact or publish a partial site", async () => {
    const prior = buildPublication(snapshot("2026-07-12T12:00:00.000Z", 2));
    const previousBaseUrl = await previousSite({
      index: { schemaVersion: CATALOGUE_SCHEMA_VERSION, snapshots: [prior.manifest] },
      snapshots: new Map([[prior.manifest.snapshotPath, new TextEncoder().encode("corrupt\n")]]),
    });
    const provider = await controlledProvider(2);
    const { output, runtime } = await fixtureRuntime(provider);

    await expect(
      runPublisher(["--output", output, "--previous-base-url", previousBaseUrl], runtime),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_INTEGRITY" });
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires the manual flag for a greater-than-ten-percent count drop", async () => {
    const prior = buildPublication(snapshot("2026-07-12T12:00:00.000Z", 100));
    const previousBaseUrl = await previousSite({
      index: { schemaVersion: CATALOGUE_SCHEMA_VERSION, snapshots: [prior.manifest] },
      snapshots: new Map([[prior.manifest.snapshotPath, prior.snapshotBytes]]),
    });
    const provider = await controlledProvider(2);
    const first = await fixtureRuntime(provider);

    await expect(
      runPublisher(
        ["--output", first.output, "--previous-base-url", previousBaseUrl],
        first.runtime,
      ),
    ).rejects.toMatchObject({ code: "CATALOGUE_COUNT_REDUCTION" });
    await expect(access(first.output)).rejects.toMatchObject({ code: "ENOENT" });

    const second = await fixtureRuntime(provider);
    await expect(
      runPublisher(
        [
          "--output",
          second.output,
          "--previous-base-url",
          previousBaseUrl,
          "--allow-large-reduction",
        ],
        second.runtime,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts an expired nonempty prior index while retaining its newest count guard", async () => {
    const expired = buildPublication(snapshot("2026-07-11T11:59:59.999Z", 100));
    const previousBaseUrl = await previousSite({
      index: { schemaVersion: CATALOGUE_SCHEMA_VERSION, snapshots: [expired.manifest] },
      snapshots: new Map(),
    });
    const provider = await controlledProvider(2);
    const rejected = await fixtureRuntime(provider);

    await expect(
      runPublisher(
        ["--output", rejected.output, "--previous-base-url", previousBaseUrl],
        rejected.runtime,
      ),
    ).rejects.toMatchObject({ code: "CATALOGUE_COUNT_REDUCTION" });
    await expect(access(rejected.output)).rejects.toMatchObject({ code: "ENOENT" });

    const accepted = await fixtureRuntime(provider);
    await runPublisher(
      [
        "--output",
        accepted.output,
        "--previous-base-url",
        previousBaseUrl,
        "--allow-large-reduction",
      ],
      accepted.runtime,
    );
    expect(await listFiles(join(accepted.output, "v1"))).toEqual([
      "index.json",
      "latest.json",
      "snapshots/2026-07-13T12-00-00.000Z.json",
    ]);
  });
});

describe("public verifier", () => {
  it("cache-busts only latest.json and validates the expected deployment", async () => {
    const publication = buildPublication(snapshot(now.toISOString(), 2));
    const requests: string[] = [];
    const baseUrl = await listen((request, response) => {
      requests.push(request.url ?? "");
      if (request.url?.startsWith("/v1/latest.json?") === true) {
        response.end(jsonBytes(publication.manifest));
      } else if (request.url === `/${publication.manifest.snapshotPath}`) {
        response.end(publication.snapshotBytes);
      } else {
        response.writeHead(404).end();
      }
    });
    const runtime: VerifierRuntime = { createReader: localReader };

    await runPublicVerifier(
      [
        "--base-url",
        baseUrl,
        "--expected-sha256",
        publication.manifest.sha256,
        "--expected-generated-at",
        publication.manifest.generatedAt,
      ],
      runtime,
    );

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatch(/^\/v1\/latest\.json\?cacheBust=/u);
    expect(requests[1]).toBe(`/${publication.manifest.snapshotPath}`);
  });

  it("rejects a public deployment that does not exactly match expectations", async () => {
    const publication = buildPublication(snapshot(now.toISOString(), 2));
    const baseUrl = await listen((request, response) => {
      if (request.url?.startsWith("/v1/latest.json?") === true)
        response.end(jsonBytes(publication.manifest));
      else response.end(publication.snapshotBytes);
    });

    await expect(
      runPublicVerifier(
        [
          "--base-url",
          baseUrl,
          "--expected-sha256",
          "0".repeat(64),
          "--expected-generated-at",
          publication.manifest.generatedAt,
        ],
        { createReader: localReader },
      ),
    ).rejects.toMatchObject({ code: "CATALOGUE_DEPLOYMENT_MISMATCH" });
  });
});

async function fixtureRuntime(provider: OpsiProvider): Promise<{
  readonly output: string;
  readonly stdout: string[];
  readonly runtime: PublisherRuntime;
}> {
  const root = await mkdtemp(join(tmpdir(), "klopsi-publisher-test-"));
  roots.push(root);
  const stdout: string[] = [];
  return {
    output: join(root, "site"),
    stdout,
    runtime: {
      now: () => now,
      createProvider: () => provider,
      createReader: localReader,
      writeStdout: (value) => stdout.push(value),
    },
  };
}

async function controlledProvider(count: number): Promise<OpsiProvider> {
  const baseUrl = await listen(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/package_search") {
      response.writeHead(404).end();
      return;
    }
    request.resume();
    const results = Array.from({ length: count }, (_, index) => ({
      id: `dataset-${String(index).padStart(3, "0")}`,
      name: `name-${String(index).padStart(3, "0")}`,
      title: `Dataset ${String(index)}`,
    }));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ success: true, result: { count, results } }));
  });
  const transport = new OpsiTransport({
    baseUrl,
    scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
  });
  return new OpsiProvider(transport);
}

async function previousSite(options: {
  readonly index: CatalogueIndex;
  readonly snapshots: ReadonlyMap<string, Uint8Array>;
}): Promise<string> {
  return listen((request, response) => {
    const relativePath = request.url?.replace(/^\//u, "");
    if (relativePath === "v1/index.json") response.end(jsonBytes(options.index));
    else {
      const bytes = relativePath === undefined ? undefined : options.snapshots.get(relativePath);
      if (bytes === undefined) response.writeHead(404).end();
      else response.end(bytes);
    }
  });
}

function localReader(baseUrl: string): StrictHttpsReader {
  return new StrictHttpsReader({
    baseUrl,
    timeoutMs: 1_000,
    testOnlyDownloaderOptions: { allowInsecureHttp: true, allowPrivateNetwork: true },
  });
}

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("listen failed");
  return `http://127.0.0.1:${address.port}/`;
}

function snapshot(generatedAt: string, count: number): CatalogueSnapshot {
  return {
    schemaVersion: CATALOGUE_SCHEMA_VERSION,
    generatedAt,
    count,
    datasets: Array.from({ length: count }, (_, index) => ({
      id: `dataset-${String(index).padStart(3, "0")}`,
      name: `name-${String(index).padStart(3, "0")}`,
      title: `Dataset ${String(index)}`,
    })),
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(root, path) : [path];
    }),
  );
  return paths.flat().toSorted();
}
