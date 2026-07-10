# Task 6 report: cross-format conversion and derived provenance

## Status

Implemented conversion among CSV, TSV, JSON, NDJSON, XLSX, and Parquet through a
temporary DuckDB `data` table. Outputs and derived provenance are published from
same-directory temporary files, never overwrite without `force`, and forced
replacement keeps hard-link backups so a failure between output and provenance
publication restores the prior pair.

The conversion path preserves column order, Unicode, booleans, numbers, nulls,
and the CSV distinction between an unquoted null and a quoted empty string.
Single-object and array JSON are accepted. XLSX uses the streaming reader and
writer; every written row and sheet is committed, the workbook is committed,
and the completed output is fsynced before hashing and publication.

Derived sidecars include output SHA-256/bytes and an ordered conversion record
with the immediate input SHA-256. `opsi provenance verify` accepts both absolute
and relative converted artifact paths. `--spreadsheet-safe` prefixes each risky
string cell and records the exact transformed-cell count; default mode preserves
values and returns a `FORMULA_LIKE_VALUE` warning.

## TDD evidence

### Primary integration RED

Command:

```text
pnpm vitest run --project integration packages/data-engine/test/convert.test.ts
```

Observed: 7/7 tests failed with `TypeError: engine.convert is not a function`.
This covered the initial matrix, CSV -> Parquet -> JSON, XLSX -> CSV -> JSON,
overwrite refusal/force, injected cleanup, checksums, and spreadsheet safety.

### Primary integration GREEN

The same command passed 7/7 after the staged conversion implementation. The
final expanded suite passes 10/10 and additionally covers NDJSON output,
single-object JSON, quoted-empty/null preservation, and forced-pair rollback.

### CLI RED/GREEN

Initial command:

```text
pnpm vitest run --project cli-e2e apps/cli/test/convert.e2e.test.ts
```

Observed RED: 2/2 failed because the missing command caused the existing global
`--output <format>` parser to consume the conversion destination. After adding
the command and command-position-aware normalization, both E2Es passed. The
final E2E also verifies a relative output path through `provenance verify`.

### Review regressions

- Spreadsheet metadata RED: expected 2 transformed cells, received 1 risky row;
  GREEN after summing per-cell predicates.
- NDJSON target RED: fixed COPY received an undefined option; GREEN after adding
  the audited `FORMAT JSON, ARRAY false` branch.
- Single-object JSON RED: DuckDB rejected forced `format='array'`; GREEN with
  trusted `format='auto'` staging.
- Force rollback RED: injected between output and provenance resolved instead of
  rejecting/restoring; GREEN with same-directory hard-link backups and rollback.
- Argv normalization RED: provider value `convert` rewrote an unrelated global
  output option; GREEN after locating the actual command while skipping global
  option values.
- Relative provenance RED: verification returned exit 6; GREEN after normalizing
  artifact paths in the provenance store.
- CSV quoted-empty RED: quoted `""` became null; GREEN with
  `allow_quoted_nulls = false`.

## Verification

Focused evidence:

```text
pnpm vitest run --project integration packages/data-engine/test/convert.test.ts
# 1 file passed, 10 tests passed

pnpm build
pnpm vitest run --project cli-e2e apps/cli/test/convert.e2e.test.ts
# build passed; 1 file passed, 2 tests passed
```

Final full gate:

```text
pnpm check
# format: passed
# lint: passed
# typecheck: passed
# tests: 28 files passed, 249 tests passed
# build: passed
```

The first parallel full-suite attempt exposed four CLI timeout failures under
native/E2E contention (238/242 tests passed). The initial response temporarily
used `fileParallelism: false`; formal review rejected serialization. The formal
fix evidence below supersedes that mitigation with isolated E2E roots, normal
parallel execution, and wider scheduler-independent test margins.

## Review

An initial independent review reported no Critical findings. The controller's
formal review subsequently found a Critical restore-failure path plus important
CLI, directory-durability, and E2E-parallelism findings. The section below
records the test-first fixes and supersedes the earlier assessment.

No format edge is omitted and there are no known blockers. Publication of two
filesystem names cannot be one filesystem transaction; forced conversion uses
atomic per-file rename plus retained hard-link backups and tested rollback so a
reported failure does not leave the replacement output paired with stale
provenance.

## Formal reviewer fixes

### RED

Rollback and directory durability:

```text
pnpm vitest run --project integration packages/data-engine/test/convert.test.ts \
  -t "restores a forced|retains actionable|directory sync"
# 4 failed, 9 skipped
```

- The after-provenance failure hook resolved instead of rejecting.
- First- and second-restore injected failures returned no typed error.
- An injected directory `EIO` was suppressed and conversion returned success.

CLI ownership and renderer semantics:

```text
pnpm vitest run --project unit apps/cli/test/runtime.test.ts
# 6 failed, 6 passed
```

Failures showed that `--output-format` was absent, direct `createProgram()` still
used the hidden destination workaround, bootstrap output selection was missing,
and `table` was not mapped to human rendering.

The first full parallel gate after removing E2E serialization reached 257/259;
two cache-lock tests used 30/50 ms “fresh owner” thresholds and falsely crossed
into stale recovery during parallel child-process/native load. Their cache paths
were unique, so this was scheduler-sensitive timing rather than shared state.

### GREEN

Critical rollback behavior now tracks each publication, retained backup, restore
link, and restore result. Forced rollback restores through separate hard links so
both original backups remain until both restores succeed. First- or
second-restore failure returns `CONVERSION_ROLLBACK_FAILED` with exit 6, original,
backup, restore-link, error code/message, and an `AggregateError` cause. Finally
cleanup never removes recovery backups.

```text
pnpm vitest run --project integration packages/data-engine/test/convert.test.ts \
  -t "restores a forced|retains actionable|directory sync"
# 4 passed, 9 skipped

pnpm vitest run --project integration packages/data-engine/test/convert.test.ts
# 13 passed
```

Directory durability uses injected filesystem operations. Output and provenance
files plus their parent directory are synced after each publication and rollback.
Only explicit unsupported-directory codes are tolerated; injected `EIO` is
propagated and the unpublished pair is removed.

The global renderer selector is now exactly
`--output-format <table|json|ndjson|csv|tsv>`; structured flags and environment
configuration remain. Convert directly owns required `--output <path>`, with no
argv normalization or hidden option. Direct program help and parsing are tested,
and literal destinations `json` and `csv` remain paths under human rendering.

```text
pnpm vitest run --project unit apps/cli/test/runtime.test.ts
# 13 passed

pnpm vitest run --project cli-e2e apps/cli/test/convert.e2e.test.ts
# 4 passed
```

CLI E2E serialization was removed. Every suite uses a unique home, cache, and
download directory; HTTP fixtures use ephemeral ports and close their servers.
The normal-parallel CLI project passed three consecutive runs:

```text
for run in 1 2 3; do pnpm vitest run --project cli-e2e || exit 1; done
# run 1: 4 files passed, 15 tests passed
# run 2: 4 files passed, 15 tests passed
# run 3: 4 files passed, 15 tests passed
```

Fresh-owner cache-lock test margins were raised to 5 seconds while explicit stale
recovery remains at `heartbeatAt = 0` with `staleMs = 1/30`; the two focused tests
pass without changing production locking behavior.

Final verification:

```text
pnpm check
# format: passed
# lint: passed
# typecheck: passed
# tests: 28 files passed, 259 tests passed
# build: passed
```

The independent formal-fix re-review returned `APPROVED`. No formal Task 6
finding remains open.
