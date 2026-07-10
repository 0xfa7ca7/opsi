import { createHash } from "node:crypto";
import { execFile, fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CacheLock, ContentCache } from "@opsi/storage";

const roots: string[] = [];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "opsi-cache-"));
  roots.push(path);
  return path;
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);
beforeAll(async () => {
  await execFileAsync("pnpm", ["--filter", "@opsi/storage", "build"], { cwd: process.cwd() });
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
