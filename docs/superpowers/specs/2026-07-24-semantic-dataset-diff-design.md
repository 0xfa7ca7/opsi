# Semantic Dataset Diff Experiment

**Status:** Experimental design for `klopsi diff`

**Date:** 2026-07-24

## Problem

KLOPSI can hash, validate, query, and inspect refreshed public-data files, but a changed
hash only answers whether the bytes changed. It does not answer the operational
questions a data user asks next:

- Did the schema change?
- Which keyed records were added or removed?
- Which fields changed on an existing record?
- How large is each class of change?
- Can I inspect a small, repeatable set of examples without loading the dataset into
  application memory?

The experiment adds a local, read-only semantic comparison:

```console
klopsi diff before.csv after.parquet --key id
klopsi diff old.csv new.csv --key municipality --key year --limit 5 --json
```

Both arguments use KLOPSI's existing data-input resolution, including local paths,
canonical provider resources, archives selected with side-specific entry options,
and the supported CSV, TSV, JSON, NDJSON, XLSX, Parquet, and XML tabular formats.

## Research and translated patterns

Current official and primary references were reviewed on 2026-07-24:

- [DVC `diff`](https://doc.dvc.org/command-reference/diff) reports added, deleted,
  modified, and renamed files, includes counts, and supports human and JSON output.
  Its documentation explicitly says it does not compare file contents line by line.
  KLOPSI should preserve the useful status/count vocabulary while filling that
  content-level gap for tables.
- [DVC `data status`](https://doc.dvc.org/command-reference/data/status) is read-only
  and can expose more granular changes on request. KLOPSI's comparison is likewise
  observational and bounded, but row granularity is the command's purpose rather
  than an optional repository mode.
- [qsv `diff`](https://qsv.dathere.com/web/diff) accepts explicit composite key
  columns, keeps the delete/add halves of a modification together, permits
  deterministic result sorting, and can omit equal fields. KLOPSI uses column names
  instead of numeric indices, emits one `changed` sample with before/after values,
  and reports the exact changed column names.
- [Datafold's data-diff architecture](https://docs.datafold.com/data-diff/how-datafold-diffs-data)
  requires one or more primary-key columns, uses SQL joins and aggregates for
  in-database comparison, and co-locates cross-source data before comparison.
  KLOPSI applies that relational shape to two locally staged inputs.
- [Datafold's data-diff API](https://docs.datafold.com/api-reference/data-diffs/get-a-data-diff)
  surfaces row counts, added/removed rows, differing keys/values, schema differences,
  duplicate keys, null keys, and sampling state. The experimental KLOPSI envelope
  uses the same important diagnostics without adding remote history, materialized
  results, tolerances, or key inference.
- [DuckDB outer joins](https://duckdb.org/docs/stable/sql/query_syntax/from) preserve
  unmatched rows from both relations; `IS DISTINCT FROM` provides null-safe value
  comparison; `duckdb_columns()` exposes type metadata; and the
  [LIMIT documentation](https://duckdb.org/docs/stable/sql/query_syntax/limit)
  recommends pairing a bound with `ORDER BY` for deterministic results.

## Scope and assumptions

This is a first-class CLI and SDK experiment, not a data version-control system.
It does not create commits, retain diff history, infer keys, mutate inputs, write
result tables, compare unordered bags without keys, or decide whether a change is
acceptable.

The following choices are explicit:

1. At least one key column is required. Repeated `--key` options and comma-separated
   key values form a composite key in the supplied order.
2. Key names must occur exactly, including case, in both schemas. This avoids
   silently mapping two distinct source columns through DuckDB's case-insensitive
   identifier lookup.
3. Key types must match exactly after DuckDB inference. A numeric key and a textual
   key are not implicitly coerced.
4. Every key component must be non-null, and the composite key must be unique on
   each side. Null or duplicate keys abort the comparison with stable diagnostics.
   Pairing duplicate rows heuristically would make added/removed/changed counts
   dependent on join multiplication and therefore misleading.
5. Matched rows compare columns present on both sides, excluding keys. Added,
   removed, and type-changed columns are reported as schema changes. An added or
   removed column alone does not mark every matched row changed. A shared column
   whose type changed is value-compared through DuckDB JSON normalization and may
   also produce row changes.
6. Samples are ordered lexicographically by the typed composite key with explicit
   null placement, although null keys have already been rejected. The sample bound
   applies independently to added, removed, and changed rows.

## Alternatives

### Recommended: co-located DuckDB stages and relational diff

Stage both resolved inputs into one invocation-local DuckDB database as
`before_data` and `after_data`, close writable staging, then run trusted generated
SQL through the existing read-only query worker. This reuses format handling,
staging, time/memory/thread/cell/output limits, external-access denial, and cleanup.
It supports inputs larger than JavaScript memory and produces exact aggregate
counts.

The cost is a temporary second import even when each input already has a cached
single-table query stage. DuckDB's sandbox intentionally prevents attaching
arbitrary database files, and relaxing it for cache reuse would weaken the clearer
security boundary. Cross-stage cache optimization can be explored later.

### Rejected: stream both inputs through JavaScript maps

This is simple for small CSV fixtures but is unbounded, format-specific, and
duplicates DuckDB's type and null semantics. External sorting could bound memory,
but would add a second tabular engine and temporary-file protocol.

### Deferred: hashes and recursive key-range bisection

Hash/bisection algorithms reduce work for remote or billion-row tables. They add
canonical serialization, collision, range, retry, and cross-engine semantics that
are unnecessary for a local first experiment. The SQL join is easier to explain
and verify.

## Architecture and data flow

`DiffService` in core resolves `before` and `after` through nested
`DataService.withResolvedInput` leases. This preserves temporary downloads and
archive extraction until comparison completes. It passes two `DataInput` values to
`DatasetDiffEngine`.

`DatasetDiffEngine` creates an invocation-local directory and calls the existing
`stageTabularInput` twice, extended with a closed set of trusted table names.
Staging returns ordered `{name, type}` column metadata. Each stage is checkpointed
and closed before any comparison.

The existing `DuckDbQueryRunner.executePrepared` opens the combined database
read-only with external access, extension installation/loading, and configuration
changes disabled. Two trusted SQL statements run:

1. A key-quality query returns total rows, null-key rows, duplicate-key groups, and
   rows participating in duplicate groups for both sides.
2. After validation, a `FULL OUTER JOIN` classifies rows. Window counts calculate
   exact added, removed, changed, and unchanged totals. `row_number()` partitions
   differing rows by class and retains only the first `limit` keys from each class.
   Only those rows cross the worker boundary as JSON-encoded row objects.

Schema changes are calculated from the bounded column metadata in JavaScript.
Sample changed-column names are calculated from the already bounded before/after
objects with null-safe structural equality via their DuckDB JSON representation.
No complete table or unbounded result set is held in JavaScript.

## SQL construction and identifier safety

All table names are internal literals. User-provided column names are never
interpolated raw. `sqlIdentifier(value)` wraps identifiers in double quotes and
doubles embedded quote characters:

```text
county"id  ->  "county""id"
```

SQL string values use the existing `sqlString` literal helper. The generated
statement is not user SQL, but it still runs through the prepared read-only worker
and inherits maximum SQL bytes, output bytes, cell bytes, columns, memory, threads,
and deadline enforcement.

The join predicate is the conjunction of escaped key equalities. Null validation
occurs before the join. Value predicates use `to_json(before.column) IS DISTINCT
FROM to_json(after.column)` so heterogeneous inferred types do not trigger unsafe
implicit casts.

## Result contract

The public result is:

```ts
interface DataDiffResult {
  before: string;
  after: string;
  key: readonly string[];
  summary: {
    beforeRows: number;
    afterRows: number;
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    schemaChanges: number;
  };
  schema: readonly DataDiffSchemaChange[];
  samples: {
    added: readonly DataDiffRowSample[];
    removed: readonly DataDiffRowSample[];
    changed: readonly DataDiffRowSample[];
  };
  sampleLimit: number;
  truncated: { added: boolean; removed: boolean; changed: boolean };
  durationMs: number;
  warnings: readonly ValidationIssue[];
}
```

A schema entry is `added`, `removed`, or `type-changed` and carries the relevant
before/after type. A row sample always has a `key` object. Added samples have
`after`, removed samples have `before`, and changed samples have both plus
`changedColumns`.

JSON uses KLOPSI's versioned envelope unchanged. Human output is a compact summary
followed by schema changes and labelled bounded sample tables. CSV/TSV/NDJSON use a
flat, deterministic event projection so pipeline output remains composable rather
than serializing one deeply nested cell.

## Errors

All failures use `KlopsiError` and existing exit categories:

- `DIFF_KEY_REQUIRED` (2): no non-empty key supplied.
- `DIFF_KEY_NOT_FOUND` (2): side-specific missing key columns in context.
- `DIFF_KEY_TYPE_MISMATCH` (2): side-specific inferred key types differ.
- `DIFF_NULL_KEY` (6): one or both inputs contain null composite keys.
- `DIFF_DUPLICATE_KEY` (6): one or both inputs contain duplicate composite keys.
- `DIFF_LIMIT_INVALID` (2): sample limit is not an integer from 1 through 100.
- `DIFF_COLUMN_LIMIT` (7): either relation exceeds the existing 256-column query
  result safety ceiling.

Input resolution, format, archive, network, DuckDB availability, timeout, memory,
cell, and output errors retain their existing stable codes.

## Safety and bounds

- Inputs are read-only; only a fresh temporary database and normalization files are
  written, then removed.
- Remote sources retain HTTPS, redirect, DNS/IP, timeout, and maximum download
  controls independently on both sides.
- Comparison runs in the existing child-process deadline and read-only DuckDB
  configuration.
- The sample limit defaults to 10 and is capped at 100 per change class.
- At most 256 source columns are compared, matching the existing default query
  column limit.
- A sample cell remains limited to 1 MiB and total worker output to 16 MiB.
- Exact counts stay inside DuckDB; only schema metadata and bounded samples enter
  JavaScript memory.
- Every `LIMIT` is paired with explicit composite-key ordering.

## Acceptance criteria

1. `klopsi diff before after --key id` works for two supported local tabular
   formats and for canonical/archive inputs through existing resolution.
2. Human output shows exact row/schema counts and bounded examples; JSON returns the
   documented envelope and public result shape.
3. Composite keys, embedded-quote identifiers, reordered input rows, null values in
   non-key columns, added/removed columns, and inferred type changes behave
   deterministically.
4. Missing keys, key type mismatches, null keys, and duplicate keys fail with the
   specified stable codes and contextual counts/names.
5. Samples remain stable across repeated runs and are independently truncated by
   class.
6. Tests demonstrate RED before implementation and cover SQL generation, real
   DuckDB comparison, core resolution, CLI manifest/help, public declarations,
   human/JSON output, and end-to-end behavior.
7. Format, lint, build/typecheck, targeted suites, full tests, and pack validation
   pass apart from clearly identified pre-existing load-sensitive timing failures.

## Experimental questions

- Is an explicit unique key acceptable for most Slovenian open-data refreshes, or
  should a later command help users assess candidate keys without inferring one?
- Should added/removed schema columns mark all matched rows changed, or remain an
  orthogonal schema signal as designed here?
- Is a single per-class limit the right UX, or should summary-only and export modes
  be separate?
- Should future work reuse two cached stages through a narrowly audited attachment
  mechanism, or is predictable temporary co-location preferable?
- Which numeric/datetime tolerance semantics, if any, can be introduced without
  obscuring exact comparison?
