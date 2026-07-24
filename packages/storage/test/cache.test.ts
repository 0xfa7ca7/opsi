import { createHash } from "node:crypto";
import { execFile, fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import {
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CacheLock, ContentCache } from "@klopsi/storage";

const roots: string[] = [];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "klopsi-cache-"));
  roots.push(path);
  return path;
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);
beforeAll(async () => {
  await execFileAsync("pnpm", ["--filter", "@klopsi/storage", "build"], { cwd: process.cwd() });
});

async function childMessage(child: ChildProcess, type: string): Promise<Record<string, unknown>> {
  while (true) {
    const [message] = (await once(child, "message")) as [Record<string, unknown>];
    if (message.type === "error") throw new Error(String(message.message));
    if (message.type === type) return message;
  }
}

describe("ContentCache", () => {
  it("publishes immutable content-addressed objects and rejects corrupt metadata", async () => {
    const cache = new ContentCache(await root());
    const object = await cache.putObject(Readable.from(["hello"]));
    expect(object.sha256).toBe(sha256("hello"));
    expect(await readFile((await cache.getObject(object.sha256)).path, "utf8")).toBe("hello");
    await cache.putMetadata("safe/../../key", "v1", { ok: true }, object.sha256);
    await writeFile((await cache.layout()).metadataPath("corrupt"), "not-json");
    await expect(cache.getMetadata("corrupt", "v1")).rejects.toMatchObject({
      code: "CACHE_CORRUPT",
      exitCode: 6,
    });
    expect(await cache.verify()).toMatchObject({ errors: [expect.stringContaining("metadata:")] });
    expect((await cache.getMetadata<{ ok: boolean }>("safe/../../key", "v1"))?.ok).toBe(true);
  });

  it("enumerates strict metadata records and deletes them by key", async () => {
    const cache = new ContentCache(await root());
    await cache.putMetadata("first", "v1", { value: 1 });
    await cache.putMetadata("second", "v1", { value: 2 });

    await expect(cache.metadataRecords()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "first", schemaVersion: "v1", value: { value: 1 } }),
        expect.objectContaining({ key: "second", schemaVersion: "v1", value: { value: 2 } }),
      ]),
    );
    await cache.deleteMetadata("first");
    await expect(cache.getMetadata("first", "v1", true)).resolves.toBeUndefined();
  });

  it("materializes a verified object with a link-first owner-only destination", async () => {
    const cache = new ContentCache(await root());
    const object = await cache.putObject(Readable.from(["database"]));
    const destination = join(await root(), "query.duckdb");

    const linked = await cache.materializeLink(object.sha256, destination);

    expect(await readFile(linked.path, "utf8")).toBe("database");
    expect(linked.sha256).toBe(object.sha256);
    const [sourceDetails, destinationDetails] = await Promise.all([
      lstat(object.path),
      lstat(destination),
    ]);
    expect(destinationDetails.mode & 0o077).toBe(0);
    if (process.platform !== "win32") expect(destinationDetails.ino).toBe(sourceDetails.ino);
    await expect(cache.materializeLink(object.sha256, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  it("copies a verified object when links are unavailable", async () => {
    let copied = false;
    const cache = new ContentCache(await root(), {
      linkObject: async () => {
        throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      },
      copyObject: async (source, destination) => {
        copied = true;
        await copyFile(source, destination);
      },
    });
    const object = await cache.putObject(Readable.from(["database"]));
    const destination = join(await root(), "copied.duckdb");

    await expect(cache.materializeLink(object.sha256, destination)).resolves.toMatchObject({
      path: destination,
    });
    expect(copied).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("database");
  });

  it("rejects materializing a verified object above the invocation byte limit", async () => {
    const cache = new ContentCache(await root());
    const object = await cache.putObject(Readable.from(["cached"]));
    const destination = join(await root(), "bounded-download");

    await expect(cache.materialize(object.sha256, destination, false, 5)).rejects.toMatchObject({
      code: "DOWNLOAD_TOO_LARGE",
      exitCode: 2,
    });
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans a partial copy and releases locks when link materialization fails", async () => {
    const cache = new ContentCache(await root(), {
      linkObject: async () => {
        throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      },
      copyObject: async (_source, destination) => {
        await writeFile(destination, "partial");
        throw new Error("copy failed");
      },
    });
    const object = await cache.putObject(Readable.from(["database"]));
    const destination = join(await root(), "partial.duckdb");

    await expect(cache.materializeLink(object.sha256, destination)).rejects.toThrow("copy failed");
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir((await cache.layout()).locks)).toEqual([]);
  });

  it("never publishes metadata when failure is injected after object publication", async () => {
    const cache = new ContentCache(await root(), {
      fault: (point) => {
        if (point === "after-object-rename") throw new Error("crash");
      },
    });
    await expect(
      cache.putObjectWithMetadata("key", "v1", Readable.from(["hello"]), { ok: true }),
    ).rejects.toThrow("crash");
    expect(await cache.getMetadata("key", "v1")).toBeUndefined();
    expect(await cache.getObject(sha256("hello"))).toMatchObject({ sha256: sha256("hello") });
  });

  it("prunes expired metadata and only orphaned objects while preserving live references", async () => {
    const cache = new ContentCache(await root());
    const live = await cache.putObject(Readable.from(["live"]));
    const orphan = await cache.putObject(Readable.from(["orphan"]));
    await cache.putMetadata("live", "v1", { ok: true }, live.sha256);
    await cache.putMetadata("expired", "v1", { old: true }, undefined, -1);
    await expect(cache.prune()).resolves.toEqual({ removed: 2 });
    await expect(cache.getObject(live.sha256)).resolves.toMatchObject({ sha256: live.sha256 });
    await expect(cache.getObject(orphan.sha256)).rejects.toMatchObject({ code: "CACHE_MISS" });
  });

  it("stores conditional metadata validators and retrieval source without exposing them as value", async () => {
    const cache = new ContentCache(await root());
    await cache.putMetadata("conditional", "v1", { data: 1 }, undefined, 1000, {
      etag: '"abc"',
      lastModified: "Sat, 11 Jul 2026 10:00:00 GMT",
      source: "https://example.test/data",
    });
    await expect(cache.getMetadataRecord("conditional", "v1", true)).resolves.toMatchObject({
      value: { data: 1 },
      etag: '"abc"',
      lastModified: "Sat, 11 Jul 2026 10:00:00 GMT",
      source: "https://example.test/data",
    });
    await expect(cache.getMetadata("conditional", "v1")).resolves.toEqual({ data: 1 });
  });

  it("publishes object metadata with an exact absolute expiry", async () => {
    const cache = new ContentCache(await root());
    const expiresAt = "2026-07-14T12:00:00.000Z";

    const object = await cache.putObjectWithMetadataExpiresAt(
      "absolute-expiry",
      "v1",
      Readable.from(["hello"]),
      { ok: true },
      expiresAt,
    );

    await expect(cache.getMetadataRecord("absolute-expiry", "v1", true)).resolves.toMatchObject({
      objectSha256: object.sha256,
      expiresAt,
      value: { ok: true },
    });
  });

  it("lets two child processes race the same object and metadata key without partial state", async () => {
    const directory = await root();
    const helper = join(process.cwd(), "packages/storage/test/fixtures/cache-publisher.mjs");
    const children = [1, 2].map(() =>
      fork(helper, [directory, "shared-key", "shared-content"], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }),
    );
    const exits = children.map((child) => once(child, "exit"));
    await Promise.all(children.map((child) => childMessage(child, "ready")));
    for (const child of children) child.send("publish");
    const results = await Promise.all(children.map((child) => childMessage(child, "result")));
    await Promise.all(exits);

    const cache = new ContentCache(directory);
    const verification = await cache.verify();
    expect(verification).toEqual({ objects: 1, metadata: 1, errors: [] });
    expect(new Set(results.map((result) => (result.object as { sha256: string }).sha256))).toEqual(
      new Set([sha256("shared-content")]),
    );
    expect(await cache.getMetadata<{ publisher: number }>("shared-key", "race-v1")).toEqual({
      publisher: expect.any(Number),
    });
    const layout = await cache.layout();
    expect(await readdir(layout.locks)).toEqual([]);
    expect((await readdir(layout.objects)).some((name) => name.includes(".tmp-"))).toBe(false);
    expect((await readdir(layout.metadata)).some((name) => name.includes(".tmp-"))).toBe(false);
  }, 15_000);

  it("uses owner tokens and only recovers genuinely stale locks", async () => {
    const directory = await root();
    const first = await CacheLock.acquire(directory, "same-key", {
      staleMs: 5_000,
      waitMs: 200,
      heartbeatMs: 50,
    });
    await expect(
      CacheLock.acquire(directory, "same-key", { staleMs: 5_000, waitMs: 100 }),
    ).rejects.toMatchObject({ code: "CACHE_LOCK_TIMEOUT" });
    await first.release();
    const second = await CacheLock.acquire(directory, "same-key", { staleMs: 30, waitMs: 100 });
    await writeFile(
      join(second.path, "owner.json"),
      JSON.stringify({
        token: "someone-else",
        createdAt: Date.now(),
        heartbeatAt: Date.now(),
        pid: process.pid,
        hostname: "x",
        processStartedAt: 0,
      }),
    );
    await second.release();
    await expect(
      CacheLock.acquire(directory, "same-key", { staleMs: 5_000, waitMs: 100 }),
    ).rejects.toMatchObject({ code: "CACHE_LOCK_TIMEOUT" });
    await writeFile(
      join(second.path, "owner.json"),
      JSON.stringify({
        token: "stale-owner",
        createdAt: 0,
        heartbeatAt: 0,
        pid: 999_999,
        hostname: hostname(),
        processStartedAt: 0,
      }),
    );
    const recovered = await CacheLock.acquire(directory, "same-key", {
      staleMs: 30,
      waitMs: 100,
    });
    await recovered.release();
  });

  it("publishes initialized lock ownership atomically and treats PID start mismatch as stale", async () => {
    const directory = await root();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = CacheLock.acquire(directory, "publish", {
      beforePublish: () => barrier,
      waitMs: 500,
    });
    const winner = await CacheLock.acquire(directory, "publish", { waitMs: 100 });
    await winner.release();
    release();
    const acquired = await delayed;
    await acquired.release();
    const stale = await CacheLock.acquire(directory, "identity", { waitMs: 100 });
    await writeFile(
      join(stale.path, "owner.json"),
      JSON.stringify({
        token: "reused",
        createdAt: 0,
        heartbeatAt: 0,
        pid: process.pid,
        hostname: hostname(),
        processStartedAt: 0,
      }),
    );
    await stale.release();
    const replacement = await CacheLock.acquire(directory, "identity", { staleMs: 1, waitMs: 100 });
    await replacement.release();
  });

  it("does not trust a stale registry when a live reused PID has a different OS start identity", async () => {
    const directory = await root();
    const lock = await CacheLock.acquire(directory, "third-process", {
      processStartIdentity: async () => "actual-start",
      staleMs: 50,
    });
    await writeFile(
      join(lock.path, "owner.json"),
      JSON.stringify({
        token: "third",
        createdAt: Date.now(),
        heartbeatAt: Date.now(),
        pid: process.pid,
        hostname: hostname(),
        processStartedAt: 0,
        processStartIdentity: "old-reused-start",
      }),
    );
    await lock.release();
    await expect(
      CacheLock.acquire(directory, "third-process", {
        processStartIdentity: async () => "actual-start",
        staleMs: 5_000,
        waitMs: 100,
      }),
    ).rejects.toMatchObject({ code: "CACHE_LOCK_TIMEOUT" });
    const ownerPath = join(lock.path, "owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8")) as Record<string, unknown>;
    owner.heartbeatAt = 0;
    await writeFile(ownerPath, JSON.stringify(owner));
    const recovered = await CacheLock.acquire(directory, "third-process", {
      processStartIdentity: async () => "actual-start",
      staleMs: 1,
      waitMs: 100,
    });
    await recovered.release();
  });

  it("rejects digest-named symlink objects before hashing or EEXIST publication", async () => {
    const cache = new ContentCache(await root());
    const layout = await cache.layout();
    const digest = sha256("hello");
    const victim = join(await root(), "victim");
    await writeFile(victim, "hello");
    await symlink(victim, layout.objectPath(digest));
    await expect(cache.getObject(digest)).rejects.toMatchObject({ code: "CACHE_CORRUPT" });
    await expect(cache.putObject(Readable.from(["hello"]))).rejects.toMatchObject({
      code: "CACHE_CORRUPT",
    });
    expect(await cache.verify()).toMatchObject({ errors: [`object:${digest}`] });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a digest-named FIFO without opening it",
    async () => {
      const cache = new ContentCache(await root());
      const layout = await cache.layout();
      const digest = sha256("fifo");
      await execFileAsync("mkfifo", [layout.objectPath(digest)]);
      await expect(cache.getObject(digest)).rejects.toMatchObject({ code: "CACHE_CORRUPT" });
      expect(await cache.verify()).toMatchObject({ errors: [`object:${digest}`] });
    },
  );

  it("detects corrupted objects before reads or materialization and uses exclusive temps", async () => {
    const cache = new ContentCache(await root());
    const object = await cache.putObject(Readable.from(["hello"]));
    await writeFile(object.path, "evil");
    await expect(cache.getObject(object.sha256)).rejects.toMatchObject({ code: "CACHE_CORRUPT" });
    const target = join(await root(), "out");
    await expect(cache.materialize(object.sha256, target)).rejects.toMatchObject({
      code: "CACHE_CORRUPT",
    });
    const safe = new ContentCache(await root(), {
      materializeTempPath: (destination) => `${destination}.fixed`,
    });
    const good = await safe.putObject(Readable.from(["good"]));
    const destination = join(await root(), "materialized");
    const victim = join(await root(), "victim");
    await writeFile(victim, "victim");
    await symlink(victim, `${destination}.fixed`);
    await expect(safe.materialize(good.sha256, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(victim, "utf8")).toBe("victim");
    expect((await lstat(`${destination}.fixed`)).isSymbolicLink()).toBe(true);
  });

  it("enforces the object byte limit before publication and preserves an existing winner", async () => {
    const directory = await root();
    const limited = new ContentCache(directory, { maxObjectBytes: 5 });
    await expect(limited.putObject(Readable.from(["123", "456"]))).rejects.toMatchObject({
      code: "CACHE_OBJECT_TOO_LARGE",
    });
    const layout = await limited.layout();
    expect(await readdir(layout.objects)).toEqual([]);
    expect(await readdir(layout.metadata)).toEqual([]);
    expect(await readdir(layout.locks)).toEqual([]);
    const exact = await limited.putObject(Readable.from(["12", "345"]));
    expect(exact).toMatchObject({ bytes: 5, sha256: sha256("12345") });
    const stricter = new ContentCache(directory, { maxObjectBytes: 4 });
    await expect(stricter.getObject(exact.sha256)).rejects.toMatchObject({
      code: "CACHE_CORRUPT",
    });
    await expect(stricter.putObject(Readable.from(["12345"]))).rejects.toMatchObject({
      code: "CACHE_OBJECT_TOO_LARGE",
    });
    expect(await readFile(exact.path, "utf8")).toBe("12345");
    expect((await readdir(layout.objects)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});
