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
native/E2E contention (238/242 tests passed). Vitest 4 documentation confirms
`fileParallelism: false` scopes execution to one worker; applying it only to the
CLI E2E project made the complete gate deterministic.

## Review

Independent review reported no Critical findings. All Important findings were
addressed: force rollback, relative provenance paths, scoped argv normalization,
per-cell spreadsheet counts, output fsync, and single-object JSON. Its NDJSON
target gap and quoted-empty/null observation were also covered with regressions.

No format edge is omitted and there are no known blockers. Publication of two
filesystem names cannot be one filesystem transaction; forced conversion uses
atomic per-file rename plus retained hard-link backups and tested rollback so a
reported failure does not leave the replacement output paired with stale
provenance.
