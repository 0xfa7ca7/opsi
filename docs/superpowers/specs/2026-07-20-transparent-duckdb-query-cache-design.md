# Transparent DuckDB Query Cache Design

- **Status:** Approved
- **Date:** 2026-07-20

## Summary

OPSI currently imports every query input into a fresh DuckDB database, runs one read-only query, and deletes the database. This design adds an automatic, content-addressed cache of immutable staged DuckDB databases. A repeated query over unchanged content reuses the staged database while preserving the existing CLI, query sandbox, output bounds, and temporary spill isolation.

The cache is an optimization, not the source of truth. Raw downloads and local input files remain authoritative. A cache failure falls back to the existing temporary staging path, while an ordinary query failure retains its current typed error behavior.

## Goals

- Avoid repeated parsing and staging for unchanged CSV, TSV, JSON, NDJSON, XLSX, and Parquet query inputs.
- Keep `opsi query <input> --sql <statement>` backward compatible and automatic by default.
- Preserve read-only query execution, disabled external access, disabled extension loading, and current resource limits.
- Reuse OPSI's content-addressed storage, atomic publication, cache locking, verification, and cache commands.
- Support concurrent CLI processes without duplicate imports or mutable shared DuckDB state.
- Bound derived-cache growth with a sliding TTL and a derived-only LRU size budget.
- Keep raw downloads, catalogue snapshots, and other offline content outside the derived-cache eviction budget.

## Non-goals

- A user-managed DuckDB warehouse or workspace.
- Cross-resource joins or persistent user-created tables.
- Caching query result rows.
- Replacing OPSI's existing content cache or JSON metadata with a monolithic DuckDB database.
- Sidecar databases beside user files.
- Enabling DuckDB external access or extensions.
- Accelerating one-off preview, validation, or conversion operations in this change.

## Chosen architecture

Each staged database is an immutable derived artifact. A strict metadata record maps a logical staging identity to the content digest of the cached `.duckdb` object.

The logical identity contains:

- source content SHA-256;
- detected input format;
- selected XLSX sheet, or an explicit no-sheet marker;
- staging contract version;
- DuckDB storage-compatibility version.

It intentionally excludes local paths, resource URLs, query SQL, output format, row limits, and timestamps. Two paths with identical content and the same staging options therefore share one database, while different sheets or staging contracts cannot collide.

The cache object remains immutable. Query workers never open the cache's canonical object path directly. A hit is materialized into the invocation directory under the cache's existing publication/materialization synchronization, preferably as a hard link. The worker opens that invocation-local path read-only. Eviction may then remove the canonical cache reference without invalidating a running query; the invocation-local file is removed with the existing query cleanup.

## Query data flow

### Source identity

Provider downloads already produce a verified SHA-256. Internal resolved-input metadata will carry that digest into the query service so the file is not hashed again. Local inputs are streamed through SHA-256 on each invocation. Hashing is less expensive than reparsing and avoids incorrect reuse when a file changes without a reliable path-based fingerprint.

### Cache hit

1. Resolve and validate the input using the existing data-resolution path.
2. Obtain the source SHA-256 and detect the input format.
3. Derive the staging identity and metadata key.
4. Read and strictly validate the derived-cache metadata.
5. Materialize the immutable database into the invocation directory.
6. Refresh `lastUsedAt` and `expiresAt` when the previous touch is at least 24 hours old.
7. Start the existing isolated worker against the materialized database.
8. Return the existing query result with `cache.status = "hit"` in structured metadata.

### Cache miss

1. Acquire a per-staging-identity cache lock and recheck the metadata after acquiring it.
2. Stage the input into an invocation-local temporary database using only OPSI-owned SQL.
3. Run `CHECKPOINT`, close the writable connection, and structurally validate that the database contains the expected `data` table.
4. If the database does not exceed the derived-cache budget, attempt to publish it atomically into the content-addressed cache with strict metadata.
5. Release the cache lock and execute the query against the invocation-local database.
6. Return `cache.status = "miss"` only after successful publication; return `bypass` when publication is skipped or fails.

Concurrent processes requesting the same staging identity coalesce behind the per-key lock. After the first process publishes, waiting processes recheck and take the hit path instead of importing again.

### Bypass and fallback

Caching is bypassed when it is disabled, its configured budget is zero, or the staged database is larger than the complete derived-cache budget. The current temporary staging path runs normally and structured metadata reports `cache.status = "bypass"`.

A lookup or materialization failure emits a sanitized `QUERY_CACHE_BYPASS` warning and retries through temporary staging. A publication failure uses the invocation-local database that was already staged, reports `bypass`, and does not stage it again. A touch or automatic-prune failure emits a warning but continues with the already materialized database and preserves its `hit` or `miss` status. Cache fallback must not hide an input, DuckDB staging, SQL policy, timeout, cancellation, output-bound, or cleanup failure.

An explicit cache command remains authoritative: failures from `cache verify`, `cache prune`, or `cache clear` are returned as typed command failures rather than downgraded query warnings.

## Component boundaries

### Storage package

Storage gains a DuckDB-agnostic derived-artifact facility built on `ContentCache`. Its responsibilities are:

- strict metadata lookup and publication;
- per-identity build locking;
- invocation-local materialization;
- daily access-time touches;
- derived-entry enumeration and statistics;
- TTL and LRU eviction;
- object and metadata verification;
- derived-entry removal.

Storage treats the database as opaque bytes and must not import DuckDB types or execute SQL.

### Data-engine package

The data engine remains responsible for:

- format detection;
- deterministic staging identity inputs such as format and selected sheet;
- creating the `data` table from supported formats;
- checkpointing and closing staged databases;
- structural database validation used by staging and explicit cache verification;
- isolated read-only query execution.

The query runner is refactored to accept either a prepared invocation-local database or the existing staging input. It does not own cache policy.

### Core package

The core query service coordinates resolved source identity, derived-cache lookup, staging, publication, fallback, and result metadata. This keeps storage independent of DuckDB and keeps the data engine independent of OPSI cache policy.

### CLI and configuration

The existing command syntax does not change. Configuration adds:

```json
{
  "duckdb": {
    "cache": {
      "enabled": true,
      "maxBytes": "10GB",
      "ttlDays": 30
    }
  }
}
```

`maxBytes` uses the existing bounded byte-size parsing conventions and accepts zero to disable retention without disabling query execution. `ttlDays` is a positive integer. `OPSI_DUCKDB_CACHE_ENABLED`, `OPSI_DUCKDB_CACHE_MAX_BYTES`, and `OPSI_DUCKDB_CACHE_TTL_DAYS` provide environment overrides for ephemeral and automated environments. Invalid values fail strict configuration validation. Per-invocation query memory and thread limits remain independent of the on-disk derived-cache budget.

## Retention and eviction

- Entries use a 30-day sliding TTL by default.
- Successful hits refresh `lastUsedAt` and `expiresAt`, but at most once per 24 hours.
- The default derived-cache budget is 10 GB and is configurable.
- The shared content-cache object ceiling is raised to at least the configured derived budget so one valid derived database can be retained; the downloader's independent 2 GiB network limit remains unchanged.
- Only derived DuckDB objects and their metadata count toward this budget.
- Raw cached downloads, provider metadata, catalogue snapshots, and provenance are never selected by derived-cache eviction.
- Automatic eviction runs after a successful derived database publication.
- `opsi cache prune` removes expired derived entries first, then least-recently-used entries until usage is within budget.
- LRU ordering is deterministic: `lastUsedAt`, then `createdAt`, then metadata key.
- An artifact larger than the entire configured budget is used for the current query but is not retained.
- Failed or currently synchronized removals are skipped safely and may be retried by the next publication or explicit prune.

## Cache command behavior

`opsi cache info` adds separate raw and derived object counts and byte totals. Existing totals remain available for backward compatibility.

`opsi cache list` identifies derived DuckDB records and reports size, creation time, last use, expiration, source digest, format, and sheet. It does not expose original paths or URLs.

`opsi cache verify` composes storage's object-digest and strict-metadata verification with the data engine's structural verification of the `data` table. Structural verification opens the materialized database read-only with external access and extensions disabled; storage itself remains DuckDB-agnostic.

`opsi cache prune` applies expiry and derived-only LRU enforcement in addition to existing unreferenced-object pruning.

`opsi cache clear` keeps its existing interactive/non-interactive confirmation requirements and removes every cache category, including derived DuckDB artifacts.

## Security and privacy

- User SQL never reaches the writable staging connection.
- Cached databases are created from OPSI-owned `CREATE TABLE data AS ...` statements only.
- Published database and metadata files use owner-only permissions where the platform supports them.
- Publication occurs only after checkpoint, close, and structural validation.
- The worker opens invocation-local databases with `access_mode = READ_ONLY`, external access disabled, extension auto-install/load disabled, bounded memory/threads/temp space, and locked configuration.
- Cache metadata contains content identity and staging attributes but no source path, URL, credentials, query text, or result rows.
- Cache warnings and debug data use the existing sanitation and secret-redaction paths.
- A staging-contract version bump invalidates all older logical identities without requiring an in-place migration. Old entries become ordinary eviction candidates.
- A DuckDB compatibility-key change produces a new logical identity. No cached file is modified in place during an upgrade.

## Corruption and error handling

Malformed metadata, a missing object, a digest mismatch discovered during materialization, or structural validation failure marks the entry unusable. OPSI removes the metadata reference when possible and rebuilds once under the per-key lock. If rebuild succeeds, the query proceeds as a cache miss. If rebuild fails, the underlying typed staging/query error is returned.

Automatic optimization-cache maintenance is best-effort. Explicit cache maintenance is not. Query cleanup keeps its current strong behavior: inability to remove invocation databases, WAL files, spill trees, or other query resources remains a typed cleanup failure.

## Observability

Structured query metadata adds:

```json
{
  "cache": {
    "status": "hit",
    "kind": "duckdb-stage"
  }
}
```

The status is `hit`, `miss`, or `bypass`. Human query output remains unchanged on healthy operation. Cache fallback produces one concise warning on stderr unless quiet mode suppresses non-result diagnostics.

No telemetry or external reporting is added.

## Testing strategy

### Unit tests

- Stable identity derivation and separation by source digest, format, sheet, staging contract, and DuckDB compatibility version.
- Strict derived metadata parsing and rejection of path/URL fields.
- Daily touch throttling and sliding expiration.
- Expired-first and deterministic LRU ordering.
- Derived-only budget accounting.
- Oversized-artifact bypass.
- Configuration defaults, overrides, and invalid values.

### Integration tests

- First query imports and reports a miss; a second unchanged query reports a hit and never invokes the staging importer.
- Identical content at different paths shares one staged database.
- Changed content, XLSX sheet, staging contract, or compatibility version causes a miss.
- Concurrent cold queries perform one import and return equivalent results.
- Corrupt metadata, missing objects, invalid databases, and digest failures rebuild once.
- Read-only execution leaves cached and materialized database bytes unchanged.
- Eviction after materialization cannot invalidate an active query.
- Cache write/touch/prune failures warn and fall back without changing query results.
- SQL rejection, timeout, cancellation, memory/output bounds, worker termination, and cleanup behavior remain unchanged.

### CLI end-to-end tests

- `cache info`, `cache list`, `cache verify`, `cache prune`, and `cache clear` expose and manage derived entries in human and structured output.
- Confirmation requirements remain unchanged.
- Query JSON metadata reports hit, miss, and bypass states.
- Optional DuckDB absence still produces `DUCKDB_UNAVAILABLE` only for operations that require it.
- Package tests cover clean installation with and without optional native dependencies.

## Acceptance criteria

- The public `opsi query` invocation remains backward compatible.
- A second query over unchanged content does not invoke the staging importer.
- Concurrent cold queries for one staging identity perform exactly one import.
- Every query worker still opens an invocation-local database read-only with external access and extensions disabled.
- Derived cache usage never evicts raw offline content.
- Default retention is a 30-day sliding TTL with a 10 GB derived-only budget.
- Oversized or unavailable caches degrade to the current temporary behavior with a sanitized warning.
- All existing tests pass, and the new unit, integration, E2E, security, and packaging tests pass on supported release platforms.

## Delivery

Implementation will occur in the `codex/duckdb-query-cache` worktree branch. The completed change will be verified with the repository's full quality gates, committed intentionally, pushed, and opened as a pull request against `main`.
