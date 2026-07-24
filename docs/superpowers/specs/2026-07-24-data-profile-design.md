# Bounded Tabular Data Profile Design

## Status

Experimental. This design adds a first-class profile command so KLOPSI can test whether one bounded, structured orientation step is more useful than making people assemble the same checks manually with `query`.

## Goal

Add:

```text
klopsi profile <input> [--top <values>] [--timeout-ms <milliseconds>]
  [--sheet <name>] [--entry <path>] [--record-path <path>]
```

The command accepts every local path, `local:file:` reference, provider resource reference, and selected ZIP/XLSX/XML input already accepted by `query`. It returns one field record per source column with:

- the DuckDB logical type;
- total row count;
- exact null count and null rate;
- exact distinct non-null count;
- minimum, maximum, and mean where DuckDB can calculate them;
- a bounded list of the most frequent non-null values for categorical fields.

The default is five top values per categorical field. `--top` accepts positive integers up to 20. The command is an orientation aid, not a validation report or a promise that inferred types and categories express domain meaning.

## Competitor research

Research was checked on 2026-07-24 using the projects' current official documentation.

### qsv `stats` and `frequency`

qsv separates summary statistics from frequency analysis. Its [`stats` definitions](https://github.com/dathere/qsv/blob/master/docs/STATS_DEFINITIONS.md) cover inferred types, nulls, cardinality, min/max, mean, quartiles, and related measures. Its official [`frequency` command](https://qsv.dathere.com/web/frequency) defaults to the ten most common items per column, supports an explicit limit, and emits counts and percentages. Its richer JSON frequency shape also carries field type, cardinality, null count, sparsity, uniqueness, and ranked values.

Strong patterns to adopt:

- one record per field;
- null and cardinality signals beside type information;
- explicit, small top-value bounds;
- deterministic frequency ordering by count and then value;
- structured output that does not require parsing a display table.

Patterns not copied:

- separate commands that make the common orientation workflow two passes;
- an unbounded `0` frequency limit;
- every qsv statistic and distribution measure;
- CSV-specific parsing and qsv cache semantics.

### Frictionless `describe`

Frictionless treats describing data as creating useful resource metadata. Its official [describing data guide](https://framework.frictionlessdata.io/docs/guides/describing-data.html) shows `frictionless describe <file> --stats --json` returning resource identity, bytes, row count, field count, and an inferred schema. The [CLI describe reference](https://framework.frictionlessdata.io/docs/console/describe.html) distinguishes descriptive metadata inference from lean metadata listing and supports human, YAML, and JSON representations.

Strong patterns to adopt:

- dataset-level row and field counts alongside the schema;
- a single discoverable orientation command;
- the same conceptual result available to humans and programs.

Patterns not copied:

- emitting a Frictionless Data Resource descriptor;
- schema constraints, packages, hashing, or publication metadata;
- adding YAML or a second output framework;
- sampling behavior that would make counts look exact when they are not.

### DuckDB `SUMMARIZE`

DuckDB's official [`SUMMARIZE` guide](https://duckdb.org/docs/current/guides/meta/summarize.html) returns column name/type, min, max, approximate unique count, average, standard deviation, approximate quartiles, total count, and null percentage for a table or query. It can be used as a subquery, which makes it a useful primitive inside a larger bounded read-only statement.

Strong patterns to adopt:

- let DuckDB own type-aware min/max/mean semantics;
- keep the profile column-oriented and compact;
- calculate the profile in the same analytical engine that already stages KLOPSI inputs.

Patterns not copied:

- exposing approximate distinct counts as exact facts;
- approximate quartiles and standard deviation in the first experiment;
- direct remote file access through DuckDB extensions;
- a new execution path outside KLOPSI's query worker.

## Alternatives

### Recommended: one generated query through `QueryService`

A focused `ProfileService` builds one KLOPSI-owned read-only SQL statement and delegates execution to the existing `QueryService`. The statement combines `SUMMARIZE data` with an unpivoted non-null value stream. Grouped frequencies provide exact distinct counts, exact non-null counts, and ranked categorical values.

Advantages:

- provider/local resolution, ZIP extraction, XLSX/XML selectors, staging, derived-cache identity, query worker isolation, deadlines, memory/thread limits, output limits, and cleanup remain unchanged;
- only one stage lease and one worker query are needed;
- no format is parsed a second time;
- profile behavior is independently testable without broadening the user-SQL surface.

Tradeoff: exact distinct counts and frequencies require a full grouped scan and can be expensive on high-cardinality data. Existing query time and memory limits bound that cost.

### Alternative: call `SUMMARIZE` only

This is the smallest implementation and would be fast to explain. It was rejected because DuckDB labels the unique count approximate, does not provide exact null counts, and does not provide top values. Renaming those fields would overstate accuracy.

### Alternative: add a dedicated profile worker protocol

A specialized worker could issue multiple prepared statements against one connection and optimize type-specific frequencies. It was rejected for the first experiment because it duplicates query-worker lifecycle, cancellation, serialization, and limit enforcement. It remains an option if the one-statement design proves materially slower or harder to evolve.

## User experience and output contract

Example:

```sh
klopsi profile ./traffic.csv --top 3
klopsi profile archive.zip --entry rows.csv --top 3 --json
klopsi profile opsi:resource:RESOURCE_ID --timeout-ms 10000 --json
```

The result data is an array of field profiles. Each field has:

```ts
interface FieldProfile {
  readonly name: string;
  readonly type: string;
  readonly rowCount: number;
  readonly nullCount: number;
  readonly nullRate: number;
  readonly distinctCount: number;
  readonly min: string | number | boolean | null;
  readonly max: string | number | boolean | null;
  readonly mean: string | number | null;
  readonly topValues: readonly {
    readonly value: string | number | boolean;
    readonly count: number;
    readonly rate: number;
  }[];
}
```

`nullRate` and top-value `rate` are fractions from 0 through 1. `distinctCount` excludes nulls, matching SQL `COUNT(DISTINCT value)`. `topValues` excludes null because null coverage already has first-class fields. It is populated only for `VARCHAR`, `BOOLEAN`, and `ENUM` logical types; semantic categories encoded as integers remain numeric in this experiment.

Minimum and maximum are null when DuckDB cannot produce them. Numeric and Boolean text from DuckDB is converted to native JSON scalars only when conversion is finite and, for integer types, safe in JavaScript; otherwise KLOPSI preserves the string to avoid precision loss. Mean is numeric when safely representable and otherwise a string.

JSON keeps KLOPSI's stable envelope:

```json
{
  "schemaVersion": "1",
  "data": [
    {
      "name": "city",
      "type": "VARCHAR",
      "rowCount": 100,
      "nullCount": 2,
      "nullRate": 0.02,
      "distinctCount": 5,
      "min": "Celje",
      "max": "Žalec",
      "mean": null,
      "topValues": [
        { "value": "Ljubljana", "count": 40, "rate": 0.4 }
      ]
    }
  ],
  "meta": {
    "source": "/absolute/path/traffic.csv",
    "rowCount": 100,
    "columnCount": 1,
    "top": 5,
    "durationMs": 12.3,
    "cache": { "status": "hit", "kind": "duckdb-stage" }
  }
}
```

Human, NDJSON, CSV, TSV, `--fields`, quiet warnings, stdout/stderr, and sanitization behavior continue through the shared renderer. Human output is one row per field; nested top values are rendered as bounded JSON in the last cell. Repeating `rowCount` makes the human table self-contained while dataset-level metadata avoids repetition for structured consumers.

## Architecture and data flow

### Core profile service

`packages/core/src/profiles.ts` owns public result types, SQL construction, bounds validation, and safe conversion from query rows. `ProfileService` receives the existing `QueryService` and exposes:

```ts
execute(input: string, options?: ProfileServiceOptions): Promise<ProfileServiceResult>
```

`KlopsiClient` exposes it as `client.profile`. No new dependency is added.

The service asks `QueryService.execute` for at most 256 field rows. The generated statement:

1. evaluates `SUMMARIZE data`;
2. casts columns to `VARCHAR` only for a generic unpivoted value stream;
3. excludes nulls from frequency rows;
4. groups by column/value for exact frequency and exact distinct counts;
5. ranks categorical frequencies by count descending, then value ascending;
6. collects at most `top` ranked values per categorical field;
7. joins frequency results back to every summarized column in source order.

KLOPSI does not use DuckDB's `approx_unique` output for `distinctCount`. Row count comes from the per-column `SUMMARIZE` count. Exact null count is `rowCount - nonNullCount`, and rates are calculated in TypeScript to avoid parsing rounded percentage strings.

### CLI integration

`apps/cli/src/commands/profile.ts` is an action-only adapter registered from `program.ts`. The normalized manifest owns argument/options/help/completion:

- `<input>`;
- `--top <values>`;
- `--timeout-ms <milliseconds>`;
- `--sheet`, `--entry`, `--record-path`;
- the existing one-invocation network overrides.

The command applies configured/global query timeout, DuckDB memory, and DuckDB thread settings exactly as `query` does. It installs SIGINT/SIGTERM cancellation for the query worker and renders `result.fields` with the dataset metadata.

SDK exports include `ProfileServiceOptions`, `ProfileServiceResult`, `FieldProfile`, and `ProfileTopValue` through `@klopsi/core` and the packaged `klopsi/sdk` declaration surface.

### Cache behavior

Because `ProfileService` delegates to `QueryService`, profiles use the existing derived DuckDB stage cache. Cache identity depends on source bytes, format, XLSX sheet, staging version, and DuckDB version—not profile options. Changing `--top` or timeout reuses the same stage while recomputing the small profile result. KLOPSI does not cache profile output.

## Bounds and safety

- Default `--top`: 5; maximum: 20; no unbounded spelling.
- Maximum profiled columns: 256. More columns fail instead of returning a silent partial profile.
- Default timeout, maximum timeout, DuckDB memory, DuckDB threads, maximum cell size, and maximum output size are inherited from the existing query path.
- The generated SQL is KLOPSI-owned. The only interpolated value is a validated integer from 1 through 20.
- The query worker opens the stage read-only with external access, extension installation/loading, and configuration changes disabled.
- Remote resolution retains HTTPS, DNS, redirect, private-network, timeout, and download-size policy.
- ZIP, XLSX, and XML selection and extraction retain existing archive/document bounds.
- Values still pass through the shared terminal/JSON sanitization.
- No source, cache object, or adjacent provenance file is modified.

## Error behavior

- `--top` outside 1–20: `PROFILE_TOP_LIMIT`, exit 2.
- More than 256 source columns: `PROFILE_COLUMN_LIMIT`, exit 7.
- An internally malformed profile row: `PROFILE_RESULT_INVALID`, exit 7.
- Worker timeout, cancellation, memory, cell, output, and cleanup errors retain existing query codes and exit 7.
- Input resolution, missing files/resources, unsupported formats, archive entry selection, XLSX sheet selection, XML record selection, offline mode, and network policy retain existing typed errors and next actions.
- Warnings from a derived-cache bypass are written to stderr unless `--quiet` and included in JSON metadata.

An empty tabular file follows current staging behavior. A table with columns but zero data rows returns zero counts, zero rates, null min/max/mean, and no top values if DuckDB can stage it; otherwise the existing typed empty-input error is retained.

## Documentation

The root and packaged READMEs add profile to the quick workflow and command table. `docs/commands.md` documents syntax, exact-versus-approximate semantics, bounds, supported selectors, cache metadata, and examples. The command manifest keeps help and completions synchronized.

The existing `klopsi-analysis` Agent Skill owns `profile` alongside `query` and `convert`. Its generated guidance recommends a bounded profile as the orientation step before custom exploratory SQL, documents exact distinct counts and `--top`, and inherits the shared selector and safety contract. No new skill package is added.

## Testing strategy

Strict red/green cycles will cover:

- option validation and deterministic SQL bounds;
- exact null/distinct counts and rates;
- numeric min/max/mean;
- deterministic categorical top values and tie ordering;
- numeric fields receiving no categorical top values;
- safe scalar conversion and integer precision preservation;
- malformed/truncated profile worker results;
- local CSV end-to-end human and JSON output;
- `--top`, query timeout, cache miss then hit, and cache bypass;
- command registration, manifest parity, help, completion, and docs synchronization;
- public TypeScript declaration and package surfaces.

Existing query, cache, staging, conversion, and provider-resolution tests remain the regression suite.

## Acceptance criteria

1. `klopsi profile <supported-local-input>` returns row count and one bounded field profile per column.
2. JSON output contains exact null and distinct counts, fractional rates, numeric aggregates where applicable, and at most the requested categorical top values.
3. The same source produces deterministic ordering and values; equal-frequency top values sort by their text representation.
4. `--top` defaults to 5 and rejects values outside 1–20 with exit 2.
5. Profiles use existing provider/local/ZIP/XLSX/XML resolution and selectors without a new parser.
6. A repeated profile reports existing DuckDB stage-cache miss/hit semantics.
7. Query deadline, memory/thread, output, network, and cleanup protections remain in force.
8. More than 256 columns fails explicitly rather than truncating.
9. Human and structured outputs follow shared renderer and stdout/stderr conventions.
10. Core and packaged SDK types expose the profile service and result contract.
11. README, packaged README, command reference, manifest, help, and completion include the command.
12. Focused tests pass, and full verification introduces no failures beyond recorded baseline timing sensitivity.
13. The existing `klopsi-analysis` Agent Skill owns and documents `profile`, with generated files and the skill index synchronized.
