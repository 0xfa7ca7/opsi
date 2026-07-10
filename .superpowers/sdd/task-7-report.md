# Task 7 report: sandboxed DuckDB queries

## Status

Implemented `QueryPolicy.validate`, the import-then-read-only `DuckDbQueryRunner`,
`OpsiClient.query.execute`, and `opsi query`. The CLI builds a separate
`dist/query-worker.js`; no TypeScript loader is required in the published runtime.

The writable staging connection and instance are checkpointed and fully closed
before a new read-only child instance opens the database. That instance disables
external access and extension auto-install/auto-load/community extensions, caps
threads, memory, expression depth, and spill bytes, then locks configuration before
parsing user SQL. The worker requires exactly one real DuckDB extracted statement
and `StatementType.SELECT`, streams only `limit + 1`, and caps columns, cells, and
serialized output. Prepared statements, connections, instances, IPC handles, WAL,
spill data, and the unique invocation directory are closed or removed on success,
error, cancellation, timeout, and forced termination.

Query results support human tables, JSON, NDJSON, CSV, and TSV. Bounded exports to
CSV/TSV/JSON/NDJSON include derived provenance with executed SQL and the immediate
input checksum.

## TDD evidence

The first policy/security run failed because `query-policy.ts` and `query.ts` did
not exist (three failed suites). The first CLI run failed all six tests because
`query` and `--sql` were unknown. After implementation:

```text
pnpm vitest run --project integration \
  packages/data-engine/test/query-policy.test.ts \
  packages/data-engine/test/query-security.test.ts \
  packages/data-engine/test/query-timeout.test.ts
# 3 files passed, 42 tests passed

pnpm build
pnpm vitest run --project cli-e2e apps/cli/test/query.e2e.test.ts
# 1 file passed, 6 tests passed
```

The regression suite covers parser/type rejection, PRAGMA's unexpected SELECT
classification, external table functions and URLs, locked configuration,
read-only database byte/mtime stability, row/column/cell/output caps, cooperative
interrupt, a worker that ignores signals and must be killed, pre-aborted cleanup,
and prompt successful IPC/process shutdown.

## DuckDB 1.5 pinned-version deviation

With the full security option set, DuckDB Node Neo `1.5.4-r.1` rejects an explicit
`temp_directory` during read-only open with `Failed to set config`; setting it after
open fails because read-only configuration disables the modification. A regression
documents this pinned behavior. The approved security-equivalent path places the
database in a unique invocation directory, checks `current_setting('temp_directory')`
before parsing and fails unless the DB-adjacent default spill path is contained in
that directory, retains explicit `max_temp_directory_size = 1GB`, and recursively
removes the entire directory.

DuckDB 1.5 also classifies `PRAGMA version` as `StatementType.SELECT`. The real
statement-count/type gate remains the security boundary, while a mandatory
leading-keyword diagnostic denylist rejects PRAGMA and all named administrative or
mutating forms before execution.

## Final verification

```text
pnpm check
# format passed
# lint passed
# typecheck passed
# 35 test files passed, 363 tests passed
# build passed, including dist/query-worker.js
```

No known Task 7 blocker remains. The explicit temp-directory incompatibility is
contained and regression-tested as described above.
