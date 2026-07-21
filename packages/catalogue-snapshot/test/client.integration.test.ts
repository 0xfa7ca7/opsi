import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MAX_AGE_MS,
  CatalogueSnapshotClient,
  ContentCacheCatalogueSnapshotStore,
  StrictHttpsReader,
  serializeSnapshot,
  type CatalogueManifest,
  type CatalogueSnapshot,
} from "@klopsi/catalogue-snapshot";
import { ContentCache, canonicalCacheKey, type MetadataValidators } from "@klopsi/storage";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([
    ...roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    ...servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeAllConnections();
        }),
    ),
  ]);
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("listen failed");
  return `http://127.0.0.1:${address.port}/`;
}

async function cacheRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "klopsi-catalogue-client-"));
  roots.push(root);
  return root;
}

async function cache(): Promise<ContentCache> {
  return new ContentCache(await cacheRoot());
}

function snapshot(generatedAt = NOW.toISOString()): CatalogueSnapshot {
  return {
    schemaVersion: "1",
    generatedAt,
    count: 2,
    datasets: [
      { id: "b", name: "alpha", title: "Alpha" },
      { id: "a", name: "beta", title: "Beta" },
    ],
  };
}

function fixture(value: CatalogueSnapshot = snapshot()): {
  readonly bytes: Uint8Array;
  readonly manifest: CatalogueManifest;
} {
  const bytes = serializeSnapshot(value);
  return {
    bytes,
    manifest: {
      schemaVersion: "1",
      generatedAt: value.generatedAt,
      snapshotPath: "v1/snapshots/catalogue.json",
      count: value.count,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

function expiryFor(generatedAt: string): string {
  return new Date(Date.parse(generatedAt) + CATALOGUE_MAX_AGE_MS).toISOString();
}

type ReadResponse = Uint8Array | Error | (() => Promise<Uint8Array>);

class FakeReader {
  readonly calls: {
    readonly path: string;
    readonly maxBytes: number;
    readonly timeoutMs?: number;
  }[] = [];

  constructor(private readonly responses: ReadonlyMap<string, ReadResponse>) {}

  async read(path: string, maxBytes: number, timeoutMs?: number): Promise<Uint8Array> {
    this.calls.push({ path, maxBytes, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    const response = this.responses.get(path);
    if (response === undefined) throw new Error(`Unexpected remote path: ${path}`);
    if (response instanceof Error) throw response;
    return typeof response === "function" ? response() : response;
  }
}

function client(
  store: ContentCacheCatalogueSnapshotStore,
  reader: FakeReader,
  offline = false,
  now: () => Date = () => NOW,
): CatalogueSnapshotClient {
  return new CatalogueSnapshotClient({ store, reader, offline, now });
}

class MetadataBarrierCache extends ContentCache {
  private armed = false;
  private releaseMetadata!: () => void;
  private metadataReachedResolve!: () => void;
  private metadataBarrier = Promise.resolve();
  metadataReached = Promise.resolve();
  private pruneStartedResolve!: () => void;
  private pruneCompletedResolve!: () => void;
  readonly pruneStarted = new Promise<void>((resolve) => {
    this.pruneStartedResolve = resolve;
  });
  readonly pruneCompleted = new Promise<void>((resolve) => {
    this.pruneCompletedResolve = resolve;
  });

  armMetadataBarrier(): void {
    this.armed = true;
    this.metadataReached = new Promise<void>((resolve) => {
      this.metadataReachedResolve = resolve;
    });
    this.metadataBarrier = new Promise<void>((resolve) => {
      this.releaseMetadata = resolve;
    });
  }

  release(): void {
    this.releaseMetadata();
  }

  override async prune(): Promise<{ readonly removed: number }> {
    this.pruneStartedResolve();
    try {
      return await super.prune();
    } finally {
      this.pruneCompletedResolve();
    }
  }

  override async putMetadata<T>(
    key: string,
    schemaVersion: string,
    value: T,
    objectSha256?: string,
    ttlMs?: number,
    validators: MetadataValidators = {},
  ): Promise<void> {
    await this.waitAtMetadataBarrier();
    await super.putMetadata(key, schemaVersion, value, objectSha256, ttlMs, validators);
  }

  override async putMetadataWithExpiresAt<T>(
    key: string,
    schemaVersion: string,
    value: T,
    objectSha256: string | undefined,
    expiresAt: string,
    validators: MetadataValidators = {},
  ): Promise<void> {
    await this.waitAtMetadataBarrier();
    await super.putMetadataWithExpiresAt(
      key,
      schemaVersion,
      value,
      objectSha256,
      expiresAt,
      validators,
    );
  }

  private async waitAtMetadataBarrier(): Promise<void> {
    if (this.armed) {
      this.armed = false;
      this.metadataReachedResolve();
      await this.metadataBarrier;
    }
  }
}

describe("CatalogueSnapshotClient", () => {
  it("returns a fresh validated cache entry even when its metadata TTL is expired", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const expected = fixture();
    await store.write(expected.manifest, expected.bytes, new Date(NOW.getTime() - 1).toISOString());
    const reader = new FakeReader(new Map());

    await expect(client(store, reader).list()).resolves.toEqual({
      datasets: snapshot().datasets,
      generatedAt: NOW.toISOString(),
      source: "snapshot-cache",
    });
    expect(reader.calls).toEqual([]);
  });

  it("downloads one manifest and its one referenced snapshot, then publishes exact bytes", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const remote = fixture();
    const reader = new FakeReader(
      new Map([
        ["v1/latest.json", jsonBytes(remote.manifest)],
        [remote.manifest.snapshotPath, remote.bytes],
      ]),
    );

    await expect(client(store, reader).list({ refresh: false })).resolves.toEqual({
      datasets: snapshot().datasets,
      generatedAt: NOW.toISOString(),
      source: "snapshot-remote",
    });
    expect(reader.calls.map(({ path }) => path)).toEqual([
      "v1/latest.json",
      remote.manifest.snapshotPath,
    ]);
    const manifestTimeout = reader.calls[0]?.timeoutMs;
    const snapshotTimeout = reader.calls[1]?.timeoutMs;
    expect(manifestTimeout).toBeTypeOf("number");
    expect(manifestTimeout).toBeLessThanOrEqual(8_500);
    expect(snapshotTimeout).toBeTypeOf("number");
    expect(snapshotTimeout).toBeLessThanOrEqual(manifestTimeout ?? 0);

    const record = await contentCache.getMetadataRecord<{
      readonly manifest: CatalogueManifest;
    }>("catalogue-snapshot:v1", "catalogue-snapshot-cache-v1", true);
    expect(record).toMatchObject({
      value: { manifest: remote.manifest },
      objectSha256: remote.manifest.sha256,
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + CATALOGUE_MAX_AGE_MS).toISOString(),
    });
    expect(await readFile((await contentCache.getObject(remote.manifest.sha256)).path)).toEqual(
      Buffer.from(remote.bytes),
    );
  });

  it("shares one under-ten-second deadline across delayed manifest and hanging snapshot reads", async () => {
    const remote = fixture();
    const requests: string[] = [];
    const origin = await listen((request, response) => {
      requests.push(request.url ?? "");
      if (request.url === "/v1/latest.json") {
        setTimeout(() => response.end(jsonBytes(remote.manifest)), 1_500);
      } else if (request.url !== `/${remote.manifest.snapshotPath}`) {
        response.writeHead(404).end();
      }
    });
    const catalogueClient = new CatalogueSnapshotClient({
      store: new ContentCacheCatalogueSnapshotStore(await cache()),
      reader: new StrictHttpsReader({
        baseUrl: origin,
        testOnlyDownloaderOptions: { allowInsecureHttp: true, allowPrivateNetwork: true },
      }),
      now: () => NOW,
    });
    const started = performance.now();

    await expect(catalogueClient.list()).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_UNAVAILABLE",
      exitCode: 4,
    });
    const elapsed = performance.now() - started;

    expect(requests).toEqual(["/v1/latest.json", `/${remote.manifest.snapshotPath}`]);
    expect(elapsed).toBeLessThan(10_000);
  }, 12_500);

  it("sets cache TTL to only the freshness remaining from generatedAt", async () => {
    vi.useFakeTimers({ now: NOW });
    const generatedAt = new Date(NOW.getTime() - 6 * 60 * 60 * 1_000).toISOString();
    const remote = fixture(snapshot(generatedAt));
    const contentCache = await cache();
    const reader = new FakeReader(
      new Map([
        ["v1/latest.json", jsonBytes(remote.manifest)],
        [remote.manifest.snapshotPath, remote.bytes],
      ]),
    );

    await client(new ContentCacheCatalogueSnapshotStore(contentCache), reader).list();

    const record = await contentCache.getMetadataRecord(
      "catalogue-snapshot:v1",
      "catalogue-snapshot-cache-v1",
      true,
    );
    expect(record?.expiresAt).toBe(
      new Date(Date.parse(generatedAt) + CATALOGUE_MAX_AGE_MS).toISOString(),
    );
  });

  it("rechecks freshness after snapshot download and rejects a boundary crossing", async () => {
    vi.useFakeTimers({ now: NOW });
    const generatedAt = new Date(NOW.getTime() - CATALOGUE_MAX_AGE_MS + 1_000).toISOString();
    const remote = fixture(snapshot(generatedAt));
    let currentNow = NOW;
    const reader = new FakeReader(
      new Map([
        ["v1/latest.json", jsonBytes(remote.manifest)],
        [
          remote.manifest.snapshotPath,
          async () => {
            currentNow = new Date(NOW.getTime() + 1_001);
            vi.setSystemTime(currentNow);
            return remote.bytes;
          },
        ],
      ]),
    );

    await expect(
      client(
        new ContentCacheCatalogueSnapshotStore(await cache()),
        reader,
        false,
        () => currentNow,
      ).list(),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_STALE", exitCode: 4 });
  });

  it("uses the post-download clock when calculating the remaining cache TTL", async () => {
    vi.useFakeTimers({ now: NOW });
    const remote = fixture();
    const later = new Date(NOW.getTime() + 6 * 60 * 60 * 1_000);
    let currentNow = NOW;
    const contentCache = await cache();
    const reader = new FakeReader(
      new Map([
        ["v1/latest.json", jsonBytes(remote.manifest)],
        [
          remote.manifest.snapshotPath,
          async () => {
            currentNow = later;
            vi.setSystemTime(later);
            return remote.bytes;
          },
        ],
      ]),
    );

    await client(
      new ContentCacheCatalogueSnapshotStore(contentCache),
      reader,
      false,
      () => currentNow,
    ).list();

    const record = await contentCache.getMetadataRecord(
      "catalogue-snapshot:v1",
      "catalogue-snapshot-cache-v1",
      true,
    );
    expect(record?.expiresAt).toBe(
      new Date(Date.parse(remote.manifest.generatedAt) + CATALOGUE_MAX_AGE_MS).toISOString(),
    );
  });

  it("fails stale after downloaded-snapshot publication crosses the boundary", async () => {
    vi.useFakeTimers({ now: NOW });
    const generatedAt = new Date(NOW.getTime() - CATALOGUE_MAX_AGE_MS + 1_000).toISOString();
    const expiresAt = new Date(Date.parse(generatedAt) + CATALOGUE_MAX_AGE_MS).toISOString();
    const remote = fixture(snapshot(generatedAt));
    let currentNow = NOW;
    const contentCache = new ContentCache(await cacheRoot(), {
      fault: (point) => {
        if (point !== "after-object-rename") return;
        currentNow = new Date(NOW.getTime() + 1_001);
        vi.setSystemTime(currentNow);
      },
    });
    const reader = new FakeReader(
      new Map([
        ["v1/latest.json", jsonBytes(remote.manifest)],
        [remote.manifest.snapshotPath, remote.bytes],
      ]),
    );

    await expect(
      client(
        new ContentCacheCatalogueSnapshotStore(contentCache),
        reader,
        false,
        () => currentNow,
      ).list(),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_STALE", exitCode: 4 });
    await expect(
      contentCache.getMetadataRecord("catalogue-snapshot:v1", "catalogue-snapshot-cache-v1", true),
    ).resolves.toMatchObject({ expiresAt });
  });

  it("refreshes the manifest but revalidates and reuses bytes when its digest is unchanged", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const remote = fixture();
    await store.write(remote.manifest, remote.bytes, expiryFor(remote.manifest.generatedAt));
    const reader = new FakeReader(new Map([["v1/latest.json", jsonBytes(remote.manifest)]]));

    await expect(client(store, reader).list({ refresh: true })).resolves.toMatchObject({
      source: "snapshot-remote",
      generatedAt: remote.manifest.generatedAt,
    });
    expect(reader.calls.map(({ path }) => path)).toEqual(["v1/latest.json"]);
    await expect(contentCache.info()).resolves.toMatchObject({ objects: 1, metadata: 1 });
  });

  it("fails stale after unchanged-digest publication crosses the boundary", async () => {
    vi.useFakeTimers({ now: NOW });
    const generatedAt = new Date(NOW.getTime() - CATALOGUE_MAX_AGE_MS + 1_000).toISOString();
    const expiresAt = new Date(Date.parse(generatedAt) + CATALOGUE_MAX_AGE_MS).toISOString();
    const remote = fixture(snapshot(generatedAt));
    let currentNow = NOW;
    let publicationArmed = false;
    const contentCache = new ContentCache(await cacheRoot(), {
      fault: (point) => {
        if (!publicationArmed || point !== "after-object-rename") return;
        currentNow = new Date(NOW.getTime() + 1_001);
        vi.setSystemTime(currentNow);
      },
    });
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    await store.write(remote.manifest, remote.bytes, expiryFor(remote.manifest.generatedAt));
    publicationArmed = true;
    const reader = new FakeReader(new Map([["v1/latest.json", jsonBytes(remote.manifest)]]));

    await expect(
      client(store, reader, false, () => currentNow).list({ refresh: true }),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_STALE", exitCode: 4 });
    await expect(
      contentCache.getMetadataRecord("catalogue-snapshot:v1", "catalogue-snapshot-cache-v1", true),
    ).resolves.toMatchObject({ expiresAt });
  });

  it("coalesces concurrent cold calls behind the catalogue cache lock", async () => {
    const remote = fixture();
    let releaseManifest!: () => void;
    const manifestBarrier = new Promise<void>((resolve) => {
      releaseManifest = resolve;
    });
    const reader = new FakeReader(
      new Map([
        [
          "v1/latest.json",
          async () => {
            await manifestBarrier;
            return jsonBytes(remote.manifest);
          },
        ],
        [remote.manifest.snapshotPath, remote.bytes],
      ]),
    );
    const contentCache = await cache();
    const catalogueClient = client(new ContentCacheCatalogueSnapshotStore(contentCache), reader);

    const first = catalogueClient.list();
    const second = catalogueClient.list();
    await vi.waitFor(() => expect(reader.calls).toHaveLength(1));
    releaseManifest();

    const results = await Promise.all([first, second]);
    expect(results.map(({ source }) => source).sort()).toEqual([
      "snapshot-cache",
      "snapshot-remote",
    ]);
    expect(reader.calls.map(({ path }) => path)).toEqual([
      "v1/latest.json",
      remote.manifest.snapshotPath,
    ]);
  });

  it("always releases its catalogue lock when the operation fails", async () => {
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);

    await expect(
      store.withLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await readdir((await contentCache.layout()).locks)).toEqual([]);
    await expect(store.withLock(async () => "recovered")).resolves.toBe("recovered");
  });

  it("keeps object reuse and metadata publication atomic against pruning", async () => {
    const contentCache = new MetadataBarrierCache(await cacheRoot());
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const remote = fixture();
    const expiresAt = new Date(Date.now() + CATALOGUE_MAX_AGE_MS).toISOString();
    await contentCache.putObject(Readable.from([remote.bytes]));
    contentCache.armMetadataBarrier();

    const publication = store.write(remote.manifest, remote.bytes, expiresAt);
    await contentCache.metadataReached;
    const locksDuringMetadata = await readdir((await contentCache.layout()).locks);
    const pruning = contentCache.prune();
    await contentCache.pruneStarted;
    const pruneCompletedBeforeRelease = await Promise.race([
      contentCache.pruneCompleted.then(() => true),
      Promise.resolve(false),
    ]);
    contentCache.release();
    const [publicationResult] = await Promise.allSettled([publication, pruning]);
    await contentCache.pruneCompleted;

    expect(locksDuringMetadata).toContain(`${canonicalCacheKey("cache-publication")}.lock`);
    expect(pruneCompletedBeforeRelease).toBe(false);
    expect(publicationResult).toMatchObject({ status: "fulfilled" });
    await expect(
      contentCache.getMetadata("catalogue-snapshot:v1", "catalogue-snapshot-cache-v1"),
    ).resolves.toBeDefined();
    await expect(contentCache.getObject(remote.manifest.sha256)).resolves.toMatchObject({
      sha256: remote.manifest.sha256,
    });
  });

  it("returns only a valid fresh cache in offline mode", async () => {
    vi.useFakeTimers({ now: NOW });
    const freshCache = await cache();
    const freshStore = new ContentCacheCatalogueSnapshotStore(freshCache);
    const fresh = fixture();
    await freshStore.write(fresh.manifest, fresh.bytes, expiryFor(fresh.manifest.generatedAt));
    await expect(client(freshStore, new FakeReader(new Map()), true).list()).resolves.toMatchObject(
      {
        source: "snapshot-cache",
      },
    );

    const staleCache = await cache();
    const staleStore = new ContentCacheCatalogueSnapshotStore(staleCache);
    const stale = fixture(
      snapshot(new Date(NOW.getTime() - CATALOGUE_MAX_AGE_MS - 1).toISOString()),
    );
    await staleStore.write(stale.manifest, stale.bytes, expiryFor(stale.manifest.generatedAt));
    await expect(client(staleStore, new FakeReader(new Map()), true).list()).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_STALE",
      exitCode: 4,
    });

    await expect(
      client(
        new ContentCacheCatalogueSnapshotStore(await cache()),
        new FakeReader(new Map()),
        true,
      ).list(),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_UNAVAILABLE", exitCode: 4 });
  });

  it("does not let cache creation time extend snapshot freshness", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const stale = fixture(
      snapshot(new Date(NOW.getTime() - CATALOGUE_MAX_AGE_MS - 1).toISOString()),
    );
    await store.write(stale.manifest, stale.bytes, expiryFor(stale.manifest.generatedAt));

    await expect(client(store, new FakeReader(new Map()), true).list()).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_STALE",
    });
  });

  it("replaces a corrupt cached object from remote while online", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const remote = fixture();
    await store.write(remote.manifest, remote.bytes, expiryFor(remote.manifest.generatedAt));
    const object = await contentCache.getObject(remote.manifest.sha256);
    await writeFile(object.path, "corrupt");
    const reader = new FakeReader(
      new Map([
        ["v1/latest.json", jsonBytes(remote.manifest)],
        [remote.manifest.snapshotPath, remote.bytes],
      ]),
    );

    await expect(client(store, reader).list()).resolves.toMatchObject({
      source: "snapshot-remote",
    });
    expect(await readFile((await contentCache.getObject(remote.manifest.sha256)).path)).toEqual(
      Buffer.from(remote.bytes),
    );
  });

  it("maps an invalid offline cache to unavailable without network access", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const remote = fixture();
    await store.write(remote.manifest, remote.bytes, expiryFor(remote.manifest.generatedAt));
    await writeFile(
      (await contentCache.layout()).metadataPath("catalogue-snapshot:v1"),
      "bad-json",
    );
    const reader = new FakeReader(new Map());

    await expect(client(store, reader, true).list()).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_UNAVAILABLE",
      exitCode: 4,
    });
    expect(reader.calls).toEqual([]);
  });

  it("rejects a stale remote manifest before downloading snapshot bytes", async () => {
    const remote = fixture(
      snapshot(new Date(NOW.getTime() - CATALOGUE_MAX_AGE_MS - 1).toISOString()),
    );
    const reader = new FakeReader(new Map([["v1/latest.json", jsonBytes(remote.manifest)]]));

    await expect(
      client(new ContentCacheCatalogueSnapshotStore(await cache()), reader).list(),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_STALE", exitCode: 4 });
    expect(reader.calls.map(({ path }) => path)).toEqual(["v1/latest.json"]);
  });

  it.each([
    [
      "digest mismatch",
      (remote: ReturnType<typeof fixture>) => ({
        manifest: { ...remote.manifest, sha256: "0".repeat(64) },
        bytes: remote.bytes,
        code: "CATALOGUE_SNAPSHOT_INTEGRITY",
      }),
    ],
    [
      "count mismatch",
      (remote: ReturnType<typeof fixture>) => ({
        manifest: { ...remote.manifest, count: remote.manifest.count + 1 },
        bytes: remote.bytes,
        code: "CATALOGUE_SNAPSHOT_INVALID",
      }),
    ],
    [
      "timestamp mismatch",
      (remote: ReturnType<typeof fixture>) => ({
        manifest: {
          ...remote.manifest,
          generatedAt: new Date(NOW.getTime() - 1_000).toISOString(),
        },
        bytes: remote.bytes,
        code: "CATALOGUE_SNAPSHOT_INVALID",
      }),
    ],
    [
      "duplicate IDs",
      (remote: ReturnType<typeof fixture>) => {
        const bytes = jsonBytes({
          ...snapshot(),
          datasets: [snapshot().datasets[0], { ...snapshot().datasets[1], id: "b" }],
        });
        return {
          manifest: {
            ...remote.manifest,
            bytes: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
          bytes,
          code: "CATALOGUE_SNAPSHOT_INVALID",
        };
      },
    ],
    [
      "incorrect ordering",
      (remote: ReturnType<typeof fixture>) => {
        const bytes = jsonBytes({ ...snapshot(), datasets: [...snapshot().datasets].reverse() });
        return {
          manifest: {
            ...remote.manifest,
            bytes: bytes.byteLength,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
          bytes,
          code: "CATALOGUE_SNAPSHOT_INVALID",
        };
      },
    ],
  ])("rejects remote %s with the approved typed error", async (_name, mutate) => {
    const changed = mutate(fixture());
    const reader = new FakeReader(
      new Map([
        ["v1/latest.json", jsonBytes(changed.manifest)],
        [changed.manifest.snapshotPath, changed.bytes],
      ]),
    );

    await expect(
      client(new ContentCacheCatalogueSnapshotStore(await cache()), reader).list(),
    ).rejects.toMatchObject({ code: changed.code, exitCode: 4 });
  });

  it("rejects malformed manifest content before requesting snapshot bytes", async () => {
    const reader = new FakeReader(
      new Map([["v1/latest.json", new TextEncoder().encode('{"schemaVersion":')]]),
    );

    await expect(
      client(new ContentCacheCatalogueSnapshotStore(await cache()), reader).list(),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_INVALID", exitCode: 4 });
    expect(reader.calls.map(({ path }) => path)).toEqual(["v1/latest.json"]);
  });
});
