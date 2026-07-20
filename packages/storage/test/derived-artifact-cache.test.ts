import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ContentCache, DerivedArtifactCache, type DerivedArtifactIdentity } from "@opsi/storage";

const roots: string[] = [];
const DAY = 24 * 60 * 60 * 1_000;

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "opsi-derived-cache-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

function identity(sourceSha256 = "a".repeat(64)): DerivedArtifactIdentity {
  return {
    kind: "duckdb-stage",
    sourceSha256,
    format: "csv",
    stagingVersion: "1",
    duckdbVersion: "1.5.4-r.1",
  };
}

describe("DerivedArtifactCache", () => {
  it("derives stable keys and separates every staging identity field", async () => {
    const cache = new DerivedArtifactCache(new ContentCache(await root()), {
      enabled: true,
      maxBytes: 1_000,
      ttlMs: 30 * DAY,
    });
    expect(cache.key(identity())).toBe(cache.key(identity()));
    expect(cache.key(identity("b".repeat(64)))).not.toBe(cache.key(identity()));
    expect(cache.key({ ...identity(), sheet: "A" })).not.toBe(
      cache.key({ ...identity(), sheet: "B" }),
    );
    expect(cache.key({ ...identity(), format: "json" })).not.toBe(cache.key(identity()));
    expect(cache.key({ ...identity(), stagingVersion: "2" })).not.toBe(cache.key(identity()));
    expect(cache.key({ ...identity(), duckdbVersion: "2" })).not.toBe(cache.key(identity()));
  });

  it("publishes, materializes, and throttles sliding-expiry touches", async () => {
    let now = new Date("2026-07-20T00:00:00.000Z");
    const content = new ContentCache(await root());
    const cache = new DerivedArtifactCache(
      content,
      { enabled: true, maxBytes: 1_000, ttlMs: 30 * DAY },
      { now: () => now },
    );
    const database = join(await root(), "source.duckdb");
    await writeFile(database, "database");

    await expect(cache.publish(identity(), database)).resolves.toMatchObject({ retained: true });
    const firstDestination = join(await root(), "first.duckdb");
    await expect(cache.materialize(identity(), firstDestination)).resolves.toMatchObject({
      path: firstDestination,
      touched: false,
    });
    const first = (await cache.list())[0];
    expect(first).toMatchObject({
      sourceSha256: "a".repeat(64),
      bytes: 8,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
    });
    expect(JSON.stringify(first)).not.toMatch(/path|url/iu);

    now = new Date(now.getTime() + DAY + 1);
    const secondDestination = join(await root(), "second.duckdb");
    await expect(cache.materialize(identity(), secondDestination)).resolves.toMatchObject({
      touched: true,
    });
    expect((await cache.list())[0]?.lastUsedAt).toBe(now.toISOString());
    expect(await readFile(secondDestination, "utf8")).toBe("database");
  });

  it("evicts derived entries by LRU without removing raw cache content", async () => {
    let now = new Date("2026-07-20T00:00:00.000Z");
    const content = new ContentCache(await root());
    const raw = await content.putObject(Readable.from(["raw"]));
    await content.putMetadata("raw-resource", "raw-v1", { retained: true }, raw.sha256);
    const cache = new DerivedArtifactCache(
      content,
      { enabled: true, maxBytes: 10, ttlMs: 30 * DAY },
      { now: () => now },
    );
    const first = join(await root(), "first.duckdb");
    const second = join(await root(), "second.duckdb");
    await writeFile(first, "123456");
    await writeFile(second, "abcdef");

    await cache.publish(identity("1".repeat(64)), first);
    now = new Date(now.getTime() + 1_000);
    await cache.publish(identity("2".repeat(64)), second);

    await expect(cache.list()).resolves.toEqual([
      expect.objectContaining({ sourceSha256: "2".repeat(64), bytes: 6 }),
    ]);
    await expect(content.getObject(raw.sha256)).resolves.toMatchObject({ sha256: raw.sha256 });
  });

  it("removes expired entries and bypasses artifacts larger than the budget", async () => {
    let now = new Date("2026-07-20T00:00:00.000Z");
    const cache = new DerivedArtifactCache(
      new ContentCache(await root()),
      { enabled: true, maxBytes: 5, ttlMs: DAY },
      { now: () => now },
    );
    const exact = join(await root(), "exact.duckdb");
    const large = join(await root(), "large.duckdb");
    await writeFile(exact, "12345");
    await writeFile(large, "123456");

    await expect(cache.publish(identity(), exact)).resolves.toMatchObject({ retained: true });
    await expect(cache.publish(identity("b".repeat(64)), large)).resolves.toEqual({
      retained: false,
    });
    now = new Date(now.getTime() + DAY + 1);
    await expect(cache.prune()).resolves.toMatchObject({ expiredRemoved: 1 });
    await expect(cache.list()).resolves.toEqual([]);
  });

  it("serializes builders for one staging identity", async () => {
    const cache = new DerivedArtifactCache(new ContentCache(await root()), {
      enabled: true,
      maxBytes: 1_000,
      ttlMs: DAY,
    });
    let active = 0;
    let maximum = 0;
    const build = () =>
      cache.withBuildLock(identity(), async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      });

    await Promise.all([build(), build()]);
    expect(maximum).toBe(1);
  });

  it("uses a SHA-256 metadata key", async () => {
    const cache = new DerivedArtifactCache(new ContentCache(await root()), {
      enabled: true,
      maxBytes: 1_000,
      ttlMs: DAY,
    });
    const key = cache.key(identity());
    const digest = key.slice("derived:duckdb-stage:".length);
    expect(digest).toMatch(/^[a-f\d]{64}$/u);
    expect(createHash("sha256").update("x").digest("hex")).toHaveLength(digest.length);
  });
});
