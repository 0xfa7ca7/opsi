# Transparent DuckDB Query Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse immutable, content-addressed DuckDB staging databases so repeated `opsi query` invocations over unchanged content skip import while preserving OPSI's security and cleanup guarantees.

**Architecture:** The storage package owns a DuckDB-agnostic `DerivedArtifactCache`; the data engine exposes prepared-database execution and structural verification; the core package coordinates source hashing, cache identity, staging, locking, publication, fallback, and query metadata. Cached objects are materialized into each query invocation directory and opened read-only by the existing isolated worker.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 11.11, Vitest 4, Zod 4, `@duckdb/node-api` 1.5.4-r.1, Commander 15.

## Global Constraints

- Keep `opsi query <input> --sql <statement>` backward compatible and automatic by default.
- Default derived-cache policy is enabled, 30-day sliding TTL, and a derived-only `10GB` budget.
- `maxBytes = "0B"` disables retention without disabling query execution.
- Never evict raw downloads, provider metadata, catalogue snapshots, or provenance to satisfy the derived budget.
- Never persist source paths, URLs, credentials, SQL, or result rows in derived metadata.
- User SQL never reaches the writable staging connection.
- Query workers continue to use read-only access, disabled external access/extensions, bounded resources, and invocation-local spill directories.
- Cache failures are optimization warnings; explicit cache-command failures and query cleanup failures remain typed failures.
- Do not add runtime dependencies or change the optional DuckDB packaging contract.

---

## File structure

- Create `packages/config/src/byte-size.ts`: parse nonnegative storage byte-size strings independently of the 1 GB DuckDB memory cap.
- Create `packages/storage/src/derived-artifact-cache.ts`: strict derived metadata, link-first materialization, locking, TTL/LRU policy, statistics, and verification.
- Create `packages/core/src/query-database-cache.ts`: source digest, staging identity, cache hit/miss/bypass orchestration, and warnings.
- Modify `packages/storage/src/cache.ts`: expose safe metadata enumeration and link-first object materialization primitives without adding DuckDB knowledge.
- Modify `packages/data-engine/src/query.ts`: split prepared-database execution from temporary staging.
- Modify `packages/data-engine/src/tabular-stage.ts`: accept an already detected format and export structural verification.
- Modify `packages/core/src/data.ts`: propagate verified download SHA-256 in internal `DataSource` values.
- Modify `packages/core/src/queries.ts`: delegate database preparation to the coordinator and return cache metadata/warnings.
- Modify configuration, client composition, CLI query/cache commands, public declarations, docs, and their existing tests to expose the feature coherently.

---

### Task 1: Configuration contract and byte-size parsing

**Files:**
- Create: `packages/config/src/byte-size.ts`
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/load.ts`
- Modify: `packages/config/src/index.ts`
- Test: `packages/config/test/config.test.ts`

**Interfaces:**
- Produces: `parseStorageBytes(value: string): number | undefined`
- Produces: `DuckDbCacheConfiguration = { enabled: boolean; maxBytes: string; ttlDays: number }` through `OpsiConfiguration["duckdb"]["cache"]`
- Environment: `OPSI_DUCKDB_CACHE_ENABLED`, `OPSI_DUCKDB_CACHE_MAX_BYTES`, `OPSI_DUCKDB_CACHE_TTL_DAYS`

- [ ] **Step 1: Write failing parser and configuration tests**

Add assertions that `0B`, `10GB`, and `2GiB` parse exactly; negative, fractional, unitless, unsafe, and unknown-unit values fail. Add configuration assertions for the default object and all three environment overrides:

```ts
expect(parseStorageBytes("0B")).toBe(0);
expect(parseStorageBytes("10GB")).toBe(10_000_000_000);
expect(parseStorageBytes("2GiB")).toBe(2_147_483_648);
expect(parseStorageBytes("-1GB")).toBeUndefined();
expect(parseStorageBytes("1.5GB")).toBeUndefined();

await expect(loadConfiguration({ paths, env: {} })).resolves.toMatchObject({
  duckdb: {
    cache: { enabled: true, maxBytes: "10GB", ttlDays: 30 },
  },
});
```

- [ ] **Step 2: Run tests and confirm the missing API/configuration failure**

Run: `pnpm exec vitest run --project unit packages/config/test/config.test.ts`

Expected: FAIL because `parseStorageBytes` is not exported and `duckdb.cache` is absent.

- [ ] **Step 3: Implement strict nonnegative byte parsing and nested schema**

Implement integer parsing without floating-point multiplication:

```ts
const MULTIPLIERS = {
  B: 1n,
  KB: 1_000n,
  MB: 1_000_000n,
  GB: 1_000_000_000n,
  KiB: 1_024n,
  MiB: 1_048_576n,
  GiB: 1_073_741_824n,
} as const;

export function parseStorageBytes(value: string): number | undefined {
  const match = /^(0|[1-9]\d*)(B|KB|MB|GB|KiB|MiB|GiB)$/u.exec(value);
  if (match === null) return undefined;
  const bytes = BigInt(match[1] as string) * MULTIPLIERS[match[2] as keyof typeof MULTIPLIERS];
  return bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : undefined;
}
```

Extend `duckdbSchema`, defaults, and environment parsing. `maxBytes` refinement must accept zero; `ttlDays` remains a positive safe integer.

- [ ] **Step 4: Run config tests and typecheck**

Run: `pnpm exec vitest run --project unit packages/config/test/config.test.ts && pnpm --filter @opsi/config typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the configuration contract**

```bash
git add packages/config
git commit -m "feat(config): add DuckDB cache policy"
```

---

### Task 2: Safe content-cache primitives

**Files:**
- Modify: `packages/storage/src/cache.ts`
- Modify: `packages/storage/src/index.ts`
- Test: `packages/storage/test/cache.test.ts`

**Interfaces:**
- Produces: `ContentCache.metadataRecords(): Promise<readonly MetadataRecord[]>`
- Produces: `ContentCache.materializeLink(sha256: string, destination: string): Promise<CacheObject>`
- Produces: `ContentCache.deleteMetadata(key: string): Promise<void>` while keeping `delete()` as a compatibility alias
- Consumes: existing `getObject`, `layout`, `CacheLock`, `syncDirectory`, and `MetadataRecord`

- [ ] **Step 1: Add failing storage tests**

Cover strict metadata enumeration, a hard-link materialization with identical inode where supported, copy fallback on `EXDEV`, destination collision, digest verification, owner-only destination mode, and cleanup after injected failure:

```ts
const linked = await cache.materializeLink(object.sha256, join(root, "query.duckdb"));
expect(await readFile(linked.path, "utf8")).toBe("database");
expect(linked.sha256).toBe(object.sha256);
expect((await stat(linked.path)).mode & 0o077).toBe(0);
```

- [ ] **Step 2: Verify the tests fail for missing methods**

Run: `pnpm exec vitest run --project integration packages/storage/test/cache.test.ts`

Expected: FAIL because the new methods do not exist.

- [ ] **Step 3: Implement metadata enumeration and link-first materialization**

`metadataRecords()` must use the existing strict parser and reject malformed files. `materializeLink()` must call `getObject()` before publication, acquire the destination lock, create the destination with `link(object.path, destination)`, and fall back to the existing copy path only for `EXDEV`, `EPERM`, or `ENOTSUP`. It must reject symlink/non-regular destinations and synchronize the destination directory.

Use this result contract:

```ts
async materializeLink(sha256: string, destination: string): Promise<CacheObject> {
  const object = await this.getObject(sha256);
  const resolved = resolve(destination);
  const lock = await CacheLock.acquire(dirname(resolved), `materialize:${resolved}`);
  try {
    try {
      await link(object.path, resolved);
    } catch (error) {
      if (!["EXDEV", "EPERM", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
      await copyFile(object.path, resolved, constants.COPYFILE_EXCL);
    }
    await chmod(resolved, 0o600);
    await syncDirectory(dirname(resolved));
    return { ...object, path: resolved };
  } finally {
    await lock.release();
  }
}
```

- [ ] **Step 4: Run storage tests and typecheck**

Run: `pnpm exec vitest run --project integration packages/storage/test/cache.test.ts && pnpm --filter @opsi/storage typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the primitives**

```bash
git add packages/storage
git commit -m "feat(storage): add safe cache materialization primitives"
```

---

### Task 3: Derived artifact cache policy

**Files:**
- Create: `packages/storage/src/derived-artifact-cache.ts`
- Modify: `packages/storage/src/index.ts`
- Test: `packages/storage/test/derived-artifact-cache.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DerivedArtifactIdentity {
  readonly kind: "duckdb-stage";
  readonly sourceSha256: string;
  readonly format: "csv" | "tsv" | "json" | "ndjson" | "xlsx" | "parquet";
  readonly sheet?: string;
  readonly stagingVersion: string;
  readonly duckdbVersion: string;
}

export interface DerivedArtifactPolicy {
  readonly enabled: boolean;
  readonly maxBytes: number;
  readonly ttlMs: number;
}

export interface DerivedArtifactEntry extends DerivedArtifactIdentity {
  readonly key: string;
  readonly objectSha256: string;
  readonly bytes: number;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly expiresAt: string;
}

export interface DerivedArtifactHit {
  readonly path: string;
  readonly entry: DerivedArtifactEntry;
  readonly touched: boolean;
}

export interface DerivedArtifactPublication {
  readonly retained: boolean;
  readonly entry?: DerivedArtifactEntry;
}

export interface DerivedArtifactInfo {
  readonly objects: number;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly ttlMs: number;
}

export interface DerivedArtifactPruneResult {
  readonly expiredRemoved: number;
  readonly lruRemoved: number;
  readonly objectsRemoved: number;
}

export interface DerivedArtifactVerification {
  readonly entries: readonly DerivedArtifactEntry[];
  readonly errors: readonly string[];
}

export class DerivedArtifactCache {
  key(identity: DerivedArtifactIdentity): string;
  withBuildLock<T>(identity: DerivedArtifactIdentity, operation: () => Promise<T>): Promise<T>;
  materialize(identity: DerivedArtifactIdentity, destination: string): Promise<DerivedArtifactHit | undefined>;
  publish(identity: DerivedArtifactIdentity, databasePath: string): Promise<DerivedArtifactPublication>;
  info(): Promise<DerivedArtifactInfo>;
  list(): Promise<readonly DerivedArtifactEntry[]>;
  prune(): Promise<DerivedArtifactPruneResult>;
  verify(): Promise<DerivedArtifactVerification>;
}
```

- [ ] **Step 1: Add failing identity, TTL, LRU, and concurrency tests**

Use an injected clock. Assert stable keys, sheet/version separation, no path/URL metadata fields, daily touch throttling, expired-first ordering, deterministic `lastUsedAt`/`createdAt`/key LRU ordering, raw-object preservation, oversized bypass, and one publisher under concurrent build locks.

```ts
expect(cache.key({ ...identity, sheet: "A" })).not.toBe(
  cache.key({ ...identity, sheet: "B" }),
);
expect(await derived.prune()).toMatchObject({ expiredRemoved: 1, lruRemoved: 1 });
expect(await rawCache.getObject(raw.sha256)).toMatchObject({ sha256: raw.sha256 });
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm exec vitest run --project integration packages/storage/test/derived-artifact-cache.test.ts`

Expected: FAIL because `DerivedArtifactCache` and its metadata schema are missing.

- [ ] **Step 3: Implement strict metadata and cache operations**

Use schema version `derived-duckdb-stage-v1` and key prefix `derived:duckdb-stage:` followed by SHA-256 of canonical JSON identity fields. Metadata value is exactly:

```ts
interface DerivedArtifactValue extends DerivedArtifactIdentity {
  readonly bytes: number;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}
```

Publish through a temporary content-cache object plus metadata expiration. Recheck under `CacheLock.acquire(layout.locks, key(identity))`. `materialize()` returns `undefined` for absent/expired records and refreshes metadata only when 24 hours have elapsed. `prune()` removes expired derived metadata, then LRU metadata until unique referenced derived bytes are within budget, then delegates unreferenced-object removal to `ContentCache.prune()`.

- [ ] **Step 4: Run derived and existing cache tests**

Run: `pnpm exec vitest run --project integration packages/storage/test/derived-artifact-cache.test.ts packages/storage/test/cache.test.ts`

Expected: PASS with raw cache behavior unchanged.

- [ ] **Step 5: Commit the derived cache**

```bash
git add packages/storage
git commit -m "feat(storage): add derived artifact cache"
```

---

### Task 4: Prepared DuckDB execution and structural verification

**Files:**
- Modify: `packages/data-engine/src/query.ts`
- Modify: `packages/data-engine/src/tabular-stage.ts`
- Modify: `packages/data-engine/src/index.ts`
- Modify: `packages/data-engine/src/types.ts`
- Test: `packages/data-engine/test/query-security.test.ts`
- Test: `packages/data-engine/test/query-timeout.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PreparedQueryExecutionOptions extends Omit<QueryExecutionOptions, "input" | "sheet"> {
  readonly databasePath: string;
  readonly invocationDirectory: string;
}

export async function verifyStagedDatabase(databasePath: string): Promise<void>;

export class DuckDbQueryRunner {
  execute(options: QueryExecutionOptions): Promise<QueryResult>;
  executePrepared(options: PreparedQueryExecutionOptions): Promise<QueryResult>;
}
```

- [ ] **Step 1: Add failing prepared-execution tests**

Stage a fixture once, call `executePrepared()` twice, and assert identical results and byte-for-byte database stability. Verify forbidden SQL, timeout, cancellation, and spill containment still apply. Add malformed/no-`data` database checks for `verifyStagedDatabase()`.

- [ ] **Step 2: Run query security tests and confirm missing API failure**

Run: `pnpm exec vitest run --project integration packages/data-engine/test/query-security.test.ts packages/data-engine/test/query-timeout.test.ts`

Expected: FAIL because `executePrepared` and `verifyStagedDatabase` do not exist.

- [ ] **Step 3: Extract worker lifecycle into `executePrepared`**

Keep limit validation in one helper used by both methods. `execute()` retains existing behavior: create temp directory, stage, checkpoint, close, delegate to `executePrepared`, and clean up. `executePrepared()` starts only the worker, never writes or deletes the supplied database, and leaves invocation-directory ownership to its caller.

`verifyStagedDatabase()` opens read-only with external access/extensions disabled and requires exactly one ordinary table named `data`; close connection and instance in `finally`.

- [ ] **Step 4: Run all data-engine query tests and typecheck**

Run: `pnpm exec vitest run --project integration packages/data-engine/test/query-security.test.ts packages/data-engine/test/query-timeout.test.ts packages/data-engine/test/query-policy.test.ts && pnpm --filter @opsi/data-engine typecheck`

Expected: PASS.

- [ ] **Step 5: Commit prepared execution**

```bash
git add packages/data-engine
git commit -m "refactor(data-engine): support prepared query databases"
```

---

### Task 5: Core query cache coordinator

**Files:**
- Create: `packages/core/src/query-database-cache.ts`
- Modify: `packages/core/src/data.ts`
- Modify: `packages/core/src/queries.ts`
- Modify: `packages/core/src/client.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/query-cache.test.ts`

**Interfaces:**
- Consumes: `DerivedArtifactCache`, `stageTabularInput`, `verifyStagedDatabase`, `DuckDbQueryRunner.executePrepared`
- Produces:

```ts
export type QueryCacheStatus = "hit" | "miss" | "bypass";

export interface QueryCacheMetadata {
  readonly status: QueryCacheStatus;
  readonly kind: "duckdb-stage";
}

export interface QueryCacheWarning {
  readonly code: "QUERY_CACHE_BYPASS";
  readonly message: string;
}

export interface QueryDatabaseCacheOptions {
  readonly derived?: DerivedArtifactCache;
  readonly runner: DuckDbQueryRunner;
  readonly stage?: typeof stageTabularInput;
  readonly now?: () => Date;
  readonly makeTemporaryDirectory?: () => Promise<string>;
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
}

export class QueryDatabaseCache {
  constructor(options: QueryDatabaseCacheOptions);
  execute(
    source: DataInput,
    options: QueryExecutionOptions,
  ): Promise<QueryResult & { cache: QueryCacheMetadata; warnings: readonly QueryCacheWarning[] }>;
}
```

- [ ] **Step 1: Add failing miss-hit-invalidation tests**

Inject stage and clock functions. Assert first query calls stage once and returns `miss`; second query with identical bytes calls stage zero additional times and returns `hit`; identical bytes at a second path share; changed bytes and XLSX sheets miss; disabled/zero/oversized caches bypass. Assert provider `DownloadResult.sha256` reaches the coordinator without rehashing.

- [ ] **Step 2: Add failing fallback and concurrency tests**

Inject lookup, materialize, publication, touch, and prune failures. Assert lookup/materialize falls back to one temporary stage, publication failure does not stage twice, touch/prune failure continues with the prepared database, and two concurrent cold queries perform exactly one stage.

- [ ] **Step 3: Run core tests and confirm missing coordinator failure**

Run: `pnpm exec vitest run --project unit packages/core/test/query-cache.test.ts`

Expected: FAIL because the coordinator and result metadata are missing.

- [ ] **Step 4: Implement source digest propagation and coordination**

Add optional `sha256` to internal `DataSource`; populate it from `downloads.resource()`. Hash local sources with streaming `createReadStream`. Detect format before identity construction. Use constants:

```ts
export const QUERY_STAGE_VERSION = "1";
export const QUERY_STAGE_DUCKDB_VERSION = "1.5.4-r.1";
```

The coordinator owns one invocation directory. On hit it materializes `data.duckdb`; on miss it stages, checkpoints, closes, verifies, attempts publication, and calls `executePrepared`. Its `finally` removes the entire invocation directory and preserves the current cleanup-error precedence.

- [ ] **Step 5: Extend `QueryServiceResult` and wire `OpsiClient`**

```ts
export interface QueryServiceResult extends QueryResult {
  readonly source: string;
  readonly durationMs: number;
  readonly cache: QueryCacheMetadata;
  readonly warnings: readonly QueryCacheWarning[];
  readonly output?: string;
  readonly provenancePath?: string;
}
```

Extend `OpsiClientOptions` with `duckdbCache?: DerivedArtifactPolicy`. Construct one `DerivedArtifactCache` from the supplied `ContentCache` and configured policy, pass it to the coordinator, and reuse it in `CacheService`.

- [ ] **Step 6: Run core, query integration, and typecheck**

Run: `pnpm exec vitest run --project unit packages/core/test/query-cache.test.ts && pnpm exec vitest run --project integration packages/data-engine/test/query-security.test.ts && pnpm --filter @opsi/core typecheck`

Expected: PASS.

- [ ] **Step 7: Commit query coordination**

```bash
git add packages/core packages/data-engine/src/types.ts
git commit -m "feat(core): reuse cached DuckDB query stages"
```

---

### Task 6: CLI observability and cache maintenance

**Files:**
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/src/commands/query.ts`
- Modify: `apps/cli/src/commands/cache.ts`
- Modify: `packages/core/src/cache.ts`
- Modify: `apps/cli/src/public-sdk.d.ts`
- Test: `apps/cli/test/query.e2e.test.ts`
- Test: `apps/cli/test/complete-surface.e2e.test.ts`
- Test: `apps/cli/test/runtime.test.ts`

**Interfaces:**
- Query renderer metadata adds `cache: { status, kind }` and `warnings` only when nonempty.
- `CacheService.info()` returns existing totals plus `derived` totals.
- `CacheService.list()` adds `kind: "raw" | "duckdb-stage"` and derived metadata where applicable.
- `CacheService.verify()` composes storage verification with `verifyStagedDatabase` for derived objects.
- `CacheService.prune()` reports existing `removed` plus `derivedExpiredRemoved` and `derivedLruRemoved`.

- [ ] **Step 1: Add failing query metadata E2E coverage**

Run the same local CSV query twice with an isolated cache directory. Assert first JSON metadata is `miss`, second is `hit`, results match, and a zero-byte policy override reports `bypass`. Inject a cache publication failure and assert a sanitized warning with successful rows.

- [ ] **Step 2: Add failing cache command E2E coverage**

Assert `cache info/list` separate derived bytes, `cache verify` structurally validates, `cache prune --yes` enforces TTL/LRU, and `cache clear --yes` removes derived entries. Keep non-TTY confirmation assertions unchanged.

- [ ] **Step 3: Run CLI tests and confirm metadata/command failures**

Run: `pnpm exec vitest run --project cli-e2e apps/cli/test/query.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts`

Expected: FAIL because query cache metadata and derived command fields are absent.

- [ ] **Step 4: Wire configuration and rendering**

Pass parsed `duckdb.cache` policy through `createClient()`. Add `cache` to query renderer metadata. Route warnings through the existing sanitized stderr/quiet behavior without writing diagnostics to stdout.

- [ ] **Step 5: Compose cache maintenance**

Give `CacheService` both `ContentCache` and `DerivedArtifactCache`, plus `verifyStagedDatabase`. Preserve existing output fields while adding nested derived fields. Explicit structural failures append deterministic `derived:<metadata-key>` entries to `errors` and keep `CACHE_CORRUPT` behavior.

- [ ] **Step 6: Update hand-curated public declarations**

Add only public cache configuration and query result metadata types. Do not expose `ContentCache`, `DerivedArtifactCache`, DuckDB connections, or workspace-only coordinator types from `opsi/sdk`.

- [ ] **Step 7: Run CLI, SDK, and type checks**

Run: `pnpm exec vitest run --project cli-e2e apps/cli/test/query.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit CLI behavior**

```bash
git add apps/cli packages/core/src/cache.ts packages/core/src/client.ts packages/config
git commit -m "feat(cli): expose DuckDB query cache state"
```

---

### Task 7: Documentation, packaging, and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/commands.md`
- Modify: `docs/configuration.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security.md`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `apps/cli/test/release-contract.test.ts`

**Interfaces:**
- Documentation names the cache as transparent, derived, rebuildable, TTL/LRU bounded, and separately evictable from raw offline content.
- Package contract continues to treat `@duckdb/node-api` as optional.

- [ ] **Step 1: Add packaging and optional-native regression tests**

Extend pack tests so a normal clean install produces miss-then-hit query metadata and omitted optional dependencies still compile the SDK and return `DUCKDB_UNAVAILABLE` only when a DuckDB-backed operation is invoked. Assert no workspace specifiers or cache implementation types leak into declarations.

- [ ] **Step 2: Run pack tests and verify the new expectation fails**

Run: `pnpm test:pack`

Expected: FAIL until bundled declarations and runtime wiring contain the cache feature.

- [ ] **Step 3: Update user and architecture documentation**

Document default `duckdb.cache.enabled`, `maxBytes = "10GB"`, `ttlDays = 30`, all environment variables, query cache metadata, cache-command fields, derived-only eviction, privacy contents, and the fact that DuckDB storage is a rebuildable optimization rather than a user database.

- [ ] **Step 4: Run formatting, lint, typecheck, and focused tests**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:integration && pnpm test:e2e && pnpm test:pack`

Expected: every command exits 0.

- [ ] **Step 5: Inspect final diff and security invariants**

Run: `git diff --check && git status --short && git diff --stat origin/main...HEAD`

Expected: no whitespace errors; only planned code, tests, docs, and spec/plan files are present.

- [ ] **Step 6: Commit documentation and release coverage**

```bash
git add README.md docs apps/cli/test/pack.test.ts apps/cli/test/release-contract.test.ts
git commit -m "docs: document transparent DuckDB query caching"
```

- [ ] **Step 7: Run the canonical final gate from a clean commit**

Run: `pnpm check`

Expected: formatting, lint, typecheck, unit, integration, E2E, and pack gates all pass.

- [ ] **Step 8: Push and open the pull request**

```bash
git push -u origin codex/duckdb-query-cache
gh pr create --base main --head codex/duckdb-query-cache --title "feat: cache DuckDB query stages" --body-file /tmp/opsi-duckdb-query-cache-pr.md
```

The PR body must summarize transparent miss/hit behavior, derived-only TTL/LRU retention, unchanged query sandboxing, cache observability, and the exact final verification commands.
