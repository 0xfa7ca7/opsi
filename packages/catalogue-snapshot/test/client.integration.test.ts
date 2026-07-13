import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOGUE_MAX_AGE_MS,
  CatalogueSnapshotClient,
  ContentCacheCatalogueSnapshotStore,
  serializeSnapshot,
  type CatalogueManifest,
  type CatalogueSnapshot,
} from "@opsi/catalogue-snapshot";
import { ContentCache } from "@opsi/storage";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function cache(): Promise<ContentCache> {
  const root = await mkdtemp(join(tmpdir(), "opsi-catalogue-client-"));
  roots.push(root);
  return new ContentCache(root);
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

type ReadResponse = Uint8Array | Error | (() => Promise<Uint8Array>);

class FakeReader {
  readonly calls: { readonly path: string; readonly maxBytes: number }[] = [];

  constructor(private readonly responses: ReadonlyMap<string, ReadResponse>) {}

  async read(path: string, maxBytes: number): Promise<Uint8Array> {
    this.calls.push({ path, maxBytes });
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
): CatalogueSnapshotClient {
  return new CatalogueSnapshotClient({ store, reader, offline, now: () => NOW });
}

describe("CatalogueSnapshotClient", () => {
  it("returns a fresh validated cache entry even when its metadata TTL is expired", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const expected = fixture();
    await store.write(expected.manifest, expected.bytes, 0);
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

  it("refreshes the manifest but revalidates and reuses bytes when its digest is unchanged", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const remote = fixture();
    await store.write(remote.manifest, remote.bytes, CATALOGUE_MAX_AGE_MS);
    const reader = new FakeReader(new Map([["v1/latest.json", jsonBytes(remote.manifest)]]));

    await expect(client(store, reader).list({ refresh: true })).resolves.toMatchObject({
      source: "snapshot-remote",
      generatedAt: remote.manifest.generatedAt,
    });
    expect(reader.calls.map(({ path }) => path)).toEqual(["v1/latest.json"]);
    await expect(contentCache.info()).resolves.toMatchObject({ objects: 1, metadata: 1 });
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

  it("returns only a valid fresh cache in offline mode", async () => {
    vi.useFakeTimers({ now: NOW });
    const freshCache = await cache();
    const freshStore = new ContentCacheCatalogueSnapshotStore(freshCache);
    const fresh = fixture();
    await freshStore.write(fresh.manifest, fresh.bytes, CATALOGUE_MAX_AGE_MS);
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
    await staleStore.write(stale.manifest, stale.bytes, 60_000);
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
    await store.write(stale.manifest, stale.bytes, CATALOGUE_MAX_AGE_MS);

    await expect(client(store, new FakeReader(new Map()), true).list()).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_STALE",
    });
  });

  it("replaces a corrupt cached object from remote while online", async () => {
    vi.useFakeTimers({ now: NOW });
    const contentCache = await cache();
    const store = new ContentCacheCatalogueSnapshotStore(contentCache);
    const remote = fixture();
    await store.write(remote.manifest, remote.bytes, CATALOGUE_MAX_AGE_MS);
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
    await store.write(remote.manifest, remote.bytes, CATALOGUE_MAX_AGE_MS);
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

  it("rejects malformed manifest content without invoking a live provider", async () => {
    const liveProvider = { list: vi.fn() };
    const reader = new FakeReader(
      new Map([["v1/latest.json", new TextEncoder().encode('{"schemaVersion":')]]),
    );

    await expect(
      client(new ContentCacheCatalogueSnapshotStore(await cache()), reader).list(),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_INVALID", exitCode: 4 });
    expect(liveProvider.list).not.toHaveBeenCalled();
    expect(reader.calls.map(({ path }) => path)).toEqual(["v1/latest.json"]);
  });
});
