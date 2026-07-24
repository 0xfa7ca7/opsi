import { createHash } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PCAXIS_LIMITS, stageTabularInput, type QueryResult } from "@klopsi/data-engine";
import { ContentCache, DerivedArtifactCache } from "@klopsi/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUERY_STAGE_VERSION, QueryDatabaseCache } from "../src/query-database-cache.js";
import { QueryService } from "../src/queries.js";

let directory: string;
let input: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "klopsi-core-query-cache-"));
  input = join(directory, "source.csv");
  await writeFile(input, "name,value\na,1\nb,2\n");
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

function result(sql: string): QueryResult {
  return {
    columns: ["count"],
    rows: [{ count: 2 }],
    returnedCount: 1,
    truncated: false,
    sql,
  };
}

async function symbolBearingPcAxis(name = "symbols.px"): Promise<string> {
  const path = join(directory, name);
  await writeFile(
    path,
    `AXIS-VERSION="2024";
CODEPAGE="utf-8";
MATRIX="query symbols";
STUB="Place";
VALUES("Place")="A","B";
DATA=1 ".";`,
  );
  return path;
}

function setup(policy = { enabled: true, maxBytes: 100_000_000, ttlMs: 30 * 86_400_000 }) {
  const content = new ContentCache(join(directory, "cache"));
  const derived = new DerivedArtifactCache(content, policy);
  const executePrepared = vi.fn(async (options: { readonly sql: string }) => result(options.sql));
  let stages = 0;
  const coordinator = new QueryDatabaseCache({
    derived,
    runner: { executePrepared } as never,
    stage: async (options) => {
      stages += 1;
      return await stageTabularInput(options);
    },
  });
  return { coordinator, derived, executePrepared, stageCount: () => stages };
}

function coordinatorWith(derived: DerivedArtifactCache, overrides: Partial<DerivedArtifactCache>) {
  let stages = 0;
  const cache = new QueryDatabaseCache({
    derived: {
      policy: derived.policy,
      key: derived.key.bind(derived),
      list: derived.list.bind(derived),
      materialize: derived.materialize.bind(derived),
      publish: derived.publish.bind(derived),
      withBuildLock: derived.withBuildLock.bind(derived),
      ...overrides,
    } as never,
    runner: {
      executePrepared: async (options: { readonly sql: string }) => result(options.sql),
    } as never,
    stage: async (options) => {
      stages += 1;
      return await stageTabularInput(options);
    },
  });
  return { cache, stageCount: () => stages };
}

describe("QueryDatabaseCache", () => {
  it("leases a verified staged database and removes it after the callback", async () => {
    const { coordinator, stageCount } = setup();
    let leasedPath = "";

    const leased = await coordinator.withDatabase(input, {}, async (databasePath, metadata) => {
      leasedPath = databasePath;
      await expect(access(databasePath)).resolves.toBeUndefined();
      expect(metadata).toMatchObject({
        cache: { status: "miss", kind: "duckdb-stage" },
        warnings: [],
      });
      return "opened";
    });

    expect(leased).toEqual({
      value: "opened",
      cache: { status: "miss", kind: "duckdb-stage" },
      warnings: [],
    });
    expect(stageCount()).toBe(1);
    await expect(access(leasedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes a leased database when the callback fails", async () => {
    const { coordinator } = setup();
    let leasedPath = "";
    const failure = new Error("UI process failed");

    await expect(
      coordinator.withDatabase(input, {}, async (databasePath) => {
        leasedPath = databasePath;
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(access(leasedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a miss followed by a reusable content-addressed hit", async () => {
    const { coordinator, stageCount } = setup();
    const first = await coordinator.execute(input, { sql: "SELECT count(*) AS count FROM data" });
    const second = await coordinator.execute(input, { sql: "SELECT count(*) AS count FROM data" });
    expect(first).toMatchObject({ cache: { status: "miss", kind: "duckdb-stage" } });
    expect(second).toMatchObject({ cache: { status: "hit", kind: "duckdb-stage" } });
    expect(second.rows).toEqual(first.rows);
    expect(stageCount()).toBe(1);
  });

  it("stages PC-Axis once under the current cache identity contract", async () => {
    input = join(directory, "source.px");
    await writeFile(
      input,
      `AXIS-VERSION="2024";
CODEPAGE="utf-8";
MATRIX="query cache";
STUB="Place";
HEADING="Year";
VALUES("Place")="Ljubljana";
VALUES("Year")="2023","2024";
DATA=1 2;`,
    );
    const { coordinator, derived, stageCount } = setup();

    await expect(coordinator.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "miss" },
    });
    await expect(coordinator.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "hit" },
    });

    expect(stageCount()).toBe(1);
    expect(QUERY_STAGE_VERSION).toBe("3");
    await expect(derived.list()).resolves.toEqual([
      expect.objectContaining({
        format: "pcaxis",
        stagingVersion: expect.stringMatching(
          new RegExp(`^${QUERY_STAGE_VERSION}:pcaxis:[a-f\\d]{64}$`, "u"),
        ),
      }),
    ]);
  });

  it("returns PC-Axis staging warnings on every would-be cached execution", async () => {
    input = await symbolBearingPcAxis();
    const { coordinator, derived, stageCount } = setup();

    const first = await coordinator.execute(input, { sql: "SELECT * FROM data" });
    const second = await coordinator.execute(input, { sql: "SELECT * FROM data" });

    for (const execution of [first, second]) {
      expect(execution).toMatchObject({
        cache: { status: "bypass" },
        warnings: [
          expect.objectContaining({
            code: "PCAXIS_DATA_SYMBOL",
            severity: "warning",
            context: { symbol: ".", occurrences: 1 },
          }),
        ],
      });
    }
    expect(stageCount()).toBe(2);
    await expect(derived.list()).resolves.toEqual([]);
  });

  it("does not reuse a PC-Axis stage built under different parser limits", async () => {
    input = join(directory, "limit-identity.px");
    await writeFile(
      input,
      `AXIS-VERSION="2024";
CODEPAGE="utf-8";
MATRIX="limit identity";
STUB="Place";
VALUES("Place")="A","B";
DATA=1 2;`,
    );
    const { coordinator, derived } = setup();
    await expect(coordinator.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "miss" },
    });
    const strict = new QueryDatabaseCache({
      derived,
      runner: {
        executePrepared: async (options: { readonly sql: string }) => result(options.sql),
      } as never,
      pcAxisLimits: { ...DEFAULT_PCAXIS_LIMITS, maxCells: 1 },
    });

    await expect(strict.execute(input, { sql: "SELECT * FROM data" })).rejects.toMatchObject({
      code: "PCAXIS_CELL_LIMIT",
      context: { limit: 1 },
    });
  });

  it("propagates configured PC-Axis limits into query staging", async () => {
    input = join(directory, "bounded.px");
    await writeFile(
      input,
      `AXIS-VERSION="2024";
CODEPAGE="utf-8";
MATRIX="bounded query";
STUB="Place";
VALUES("Place")="A","B";
DATA=1 2;`,
    );
    const coordinator = new QueryDatabaseCache({
      runner: {
        executePrepared: async (options: { readonly sql: string }) => result(options.sql),
      } as never,
      pcAxisLimits: { ...DEFAULT_PCAXIS_LIMITS, maxCells: 1 },
    });

    await expect(coordinator.execute(input, { sql: "SELECT * FROM data" })).rejects.toMatchObject({
      code: "PCAXIS_CELL_LIMIT",
      context: { limit: 1 },
    });
  });

  it("shares identical bytes across paths and invalidates changed content", async () => {
    const { coordinator, stageCount } = setup();
    const secondPath = join(directory, "copy.csv");
    await writeFile(secondPath, "name,value\na,1\nb,2\n");
    await coordinator.execute(input, { sql: "SELECT * FROM data" });
    await expect(
      coordinator.execute(secondPath, { sql: "SELECT * FROM data" }),
    ).resolves.toMatchObject({
      cache: { status: "hit" },
    });
    await writeFile(secondPath, "name,value\na,1\nb,3\n");
    await expect(
      coordinator.execute(secondPath, { sql: "SELECT * FROM data" }),
    ).resolves.toMatchObject({
      cache: { status: "miss" },
    });
    expect(stageCount()).toBe(2);
  });

  it("uses a trusted source digest when one is supplied", async () => {
    const { coordinator } = setup();
    const sha256 = createHash("sha256").update("name,value\na,1\nb,2\n").digest("hex");
    await coordinator.execute({ path: input, sha256 }, { sql: "SELECT * FROM data" });
    await expect(coordinator.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "hit" },
    });
  });

  it.each([
    { enabled: false, maxBytes: 100_000_000, ttlMs: 30 * 86_400_000 },
    { enabled: true, maxBytes: 0, ttlMs: 30 * 86_400_000 },
  ])("bypasses retention when policy is $enabled/$maxBytes", async (policy) => {
    const { coordinator, stageCount } = setup(policy);
    await expect(coordinator.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "bypass", kind: "duckdb-stage" },
    });
    await coordinator.execute(input, { sql: "SELECT * FROM data" });
    expect(stageCount()).toBe(2);
  });

  it("serializes concurrent cold builds", async () => {
    const { coordinator, stageCount } = setup();
    const [first, second] = await Promise.all([
      coordinator.execute(input, { sql: "SELECT * FROM data" }),
      coordinator.execute(input, { sql: "SELECT * FROM data" }),
    ]);
    expect([first.cache.status, second.cache.status].sort()).toEqual(["hit", "miss"]);
    expect(stageCount()).toBe(1);
  });

  it("falls back once with a sanitized warning when lookup fails", async () => {
    const derived = new DerivedArtifactCache(new ContentCache(join(directory, "lookup-cache")), {
      enabled: true,
      maxBytes: 100_000_000,
      ttlMs: 30 * 86_400_000,
    });
    const { cache, stageCount } = coordinatorWith(derived, {
      materialize: vi.fn(async () => Promise.reject(new Error("secret cache path"))) as never,
    });
    await expect(cache.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "bypass" },
      warnings: [
        {
          code: "QUERY_CACHE_BYPASS",
          message: expect.not.stringContaining("secret"),
        },
      ],
    });
    expect(stageCount()).toBe(1);
  });

  it("keeps cache and PC-Axis staging warnings together", async () => {
    input = await symbolBearingPcAxis("cache-warning-symbols.px");
    const derived = new DerivedArtifactCache(new ContentCache(join(directory, "warning-cache")), {
      enabled: true,
      maxBytes: 100_000_000,
      ttlMs: 30 * 86_400_000,
    });
    const { cache } = coordinatorWith(derived, {
      materialize: vi.fn(async () => Promise.reject(new Error("cache unavailable"))) as never,
    });

    await expect(cache.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "bypass" },
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: "QUERY_CACHE_BYPASS" }),
        expect.objectContaining({ code: "PCAXIS_DATA_SYMBOL", severity: "warning" }),
      ]),
    });
  });

  it("does not stage twice when publication fails", async () => {
    const derived = new DerivedArtifactCache(
      new ContentCache(join(directory, "publication-cache")),
      { enabled: true, maxBytes: 100_000_000, ttlMs: 30 * 86_400_000 },
    );
    const { cache, stageCount } = coordinatorWith(derived, {
      publish: vi.fn(async () => Promise.reject(new Error("publication failed"))) as never,
    });
    await expect(cache.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "bypass" },
      warnings: [{ code: "QUERY_CACHE_BYPASS" }],
    });
    expect(stageCount()).toBe(1);
  });

  it("preserves a miss when automatic maintenance fails after publication", async () => {
    const derived = new DerivedArtifactCache(
      new ContentCache(join(directory, "maintenance-cache")),
      { enabled: true, maxBytes: 100_000_000, ttlMs: 30 * 86_400_000 },
    );
    const { cache, stageCount } = coordinatorWith(derived, {
      publish: vi.fn(async (identity, databasePath) => {
        await derived.publish(identity, databasePath);
        throw new Error("prune failed");
      }) as never,
    });
    await expect(cache.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "miss" },
      warnings: [{ code: "QUERY_CACHE_BYPASS" }],
    });
    expect(stageCount()).toBe(1);
  });

  it("continues with a materialized hit when its touch fails", async () => {
    const content = new ContentCache(join(directory, "touch-cache"));
    const derived = new DerivedArtifactCache(content, {
      enabled: true,
      maxBytes: 100_000_000,
      ttlMs: 30 * 86_400_000,
    });
    await new QueryDatabaseCache({
      derived,
      runner: {
        executePrepared: async (options: { readonly sql: string }) => result(options.sql),
      } as never,
    }).execute(input, { sql: "SELECT * FROM data" });
    const { cache, stageCount } = coordinatorWith(derived, {
      materialize: vi.fn(async (identity, destination) => {
        await derived.materialize(identity, destination);
        throw new Error("touch failed");
      }) as never,
    });
    await expect(cache.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "hit" },
      warnings: [{ code: "QUERY_CACHE_BYPASS" }],
    });
    expect(stageCount()).toBe(0);
  });

  it("bypasses an artifact larger than the complete derived budget", async () => {
    const { coordinator, stageCount } = setup({
      enabled: true,
      maxBytes: 1,
      ttlMs: 30 * 86_400_000,
    });
    await expect(coordinator.execute(input, { sql: "SELECT * FROM data" })).resolves.toMatchObject({
      cache: { status: "bypass" },
    });
    expect(stageCount()).toBe(1);
  });
});

describe("QueryService staged database lease", () => {
  it("returns PC-Axis staging warnings to the lease callback and result", async () => {
    input = await symbolBearingPcAxis("lease-symbols.px");
    const { coordinator, stageCount } = setup();
    const withResolvedInput = vi.fn(
      async (_input: string, _options: unknown, operation: (source: string) => Promise<unknown>) =>
        operation(input),
    );
    const service = new QueryService({ withResolvedInput } as never, coordinator);
    let callbackWarnings: readonly { readonly code: string }[] = [];

    const leased = await service.withDatabase(input, {}, async (databasePath, metadata) => {
      await expect(access(databasePath)).resolves.toBeUndefined();
      callbackWarnings = metadata.warnings;
      return "opened";
    });

    expect(callbackWarnings).toEqual([
      expect.objectContaining({ code: "PCAXIS_DATA_SYMBOL", severity: "warning" }),
    ]);
    expect(leased).toMatchObject({
      value: "opened",
      source: input,
      cache: { status: "bypass" },
      warnings: [
        expect.objectContaining({
          code: "PCAXIS_DATA_SYMBOL",
          severity: "warning",
        }),
      ],
    });
    expect(stageCount()).toBe(1);
  });

  it("resolves selectors and returns source plus database metadata", async () => {
    const withResolvedInput = vi.fn(
      async (_input: string, _options: unknown, operation: (source: string) => Promise<unknown>) =>
        operation(input),
    );
    const withDatabase = vi.fn(
      async (
        _source: string,
        _options: unknown,
        operation: (
          path: string,
          metadata: {
            cache: { status: "hit"; kind: "duckdb-stage" };
            warnings: readonly [];
          },
        ) => Promise<unknown>,
      ) => {
        const metadata = {
          cache: { status: "hit" as const, kind: "duckdb-stage" as const },
          warnings: [] as const,
        };
        return {
          value: await operation("/tmp/data.duckdb", metadata),
          ...metadata,
        };
      },
    );
    const service = new QueryService({ withResolvedInput } as never, { withDatabase } as never);

    const result = await service.withDatabase(
      "archive.zip",
      {
        entry: "rows.csv",
        sheet: "Sheet1",
        recordPath: "/root/row",
        allowPrivateNetwork: true,
      },
      async (databasePath) => ({ databasePath }),
    );

    expect(result).toEqual({
      value: { databasePath: "/tmp/data.duckdb" },
      source: input,
      cache: { status: "hit", kind: "duckdb-stage" },
      warnings: [],
    });
    expect(withResolvedInput).toHaveBeenCalledWith(
      "archive.zip",
      expect.objectContaining({
        entry: "rows.csv",
        recordPath: "/root/row",
        allowPrivateNetwork: true,
      }),
      expect.any(Function),
    );
    expect(withDatabase).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ sheet: "Sheet1", recordPath: "/root/row" }),
      expect.any(Function),
    );
  });
});
