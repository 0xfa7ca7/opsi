import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CacheLock, ContentCache } from "@opsi/storage";

const roots: string[] = [];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "opsi-cache-"));
  roots.push(path);
  return path;
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

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

  it("uses owner tokens and only recovers genuinely stale locks", async () => {
    const directory = await root();
    const first = await CacheLock.acquire(directory, "same-key", {
      staleMs: 30,
      waitMs: 200,
      heartbeatMs: 5,
    });
    await expect(
      CacheLock.acquire(directory, "same-key", { staleMs: 30, waitMs: 20 }),
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
      CacheLock.acquire(directory, "same-key", { staleMs: 30, waitMs: 20 }),
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
});
