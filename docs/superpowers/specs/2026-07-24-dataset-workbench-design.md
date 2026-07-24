# Dataset Workbench Design

## Goal

Give people and AI agents one quick KLOPSI workflow for representing acquired or computed tabular data as an explorable database workbench, while keeping DuckDB as the current implementation and the external DuckDB CLI as an explicit optional installation.

## User experience

KLOPSI adds a `duckdb` command group:

```text
klopsi duckdb open <input> [--sheet <name>] [--entry <path>] [--record-path <path>] [--install]
klopsi duckdb install --yes
```

`duckdb open` accepts the same local paths, `local:file:` references, provider resource references, archives, and structured-data selectors as `query`. KLOPSI resolves the input and stages it as a DuckDB database containing the table `data`. It then creates a separate writable invocation-local workbench database, attaches the staged database read-only as `dataset`, and creates a workbench view named `data` over `dataset.main.data`. DuckDB UI opens the writable workbench, never the staged database directly. The process stays attached until DuckDB UI exits so KLOPSI can retain and then clean up both invocation-local databases safely.

If the DuckDB CLI is absent, `duckdb open` returns `DUCKDB_CLI_UNAVAILABLE` with commands for either `klopsi duckdb install --yes` or the one-call `klopsi duckdb open <input> --install` path. `--install` installs only when the CLI is unavailable. `duckdb install` refuses to make changes without `--yes`, reports an already available compatible CLI without reinstalling it, and uses the DuckDB project’s official HTTPS installer.

Human output leaves the child CLI attached to the terminal so DuckDB can display its local UI address and lifecycle messages. Structured output is written after the UI process exits and records the resolved source, table name, derived-stage cache status, CLI version, and whether installation occurred.

The generated Agent Skill is named `klopsi-dataset-workbench`. The broad name describes the user outcome—representing a dataset as an explorable database—rather than binding skill discovery to DuckDB UI. The owned CLI commands remain `duckdb open` and `duckdb install` because those commands expose the concrete implementation.

## Architecture

### Reusable staged-database lease

`QueryDatabaseCache` extracts its current stage/materialize/verify/cleanup lifecycle into a callback-based `withDatabase` operation:

```ts
withDatabase<T>(
  source: DataInput,
  options: QueryDatabasePreparationOptions,
  operation: (databasePath: string, metadata: QueryDatabaseMetadata) => Promise<T>,
): Promise<QueryDatabaseLeaseResult<T>>
```

The callback receives an invocation-local staged-database path, never the canonical derived-cache object. The staged database contains exactly one base table named `data`. Cleanup runs after the callback settles. Existing query execution delegates to this lease and keeps its public results and cache behavior unchanged.

`QueryService.withDatabase` wraps this lease in `DataService.withResolvedInput`, preserving provider download controls, ZIP extraction, XLSX sheet selection, XML record selection, cache reuse, and temporary-input cleanup. It returns the callback result plus source, cache, and warnings.

### External CLI runner

A focused CLI module owns external DuckDB discovery, installation, and execution. It uses argument-array process spawning rather than a shell command. UI launch creates `workbench.duckdb` beside the leased staged database and passes it as the writable DuckDB filename. A startup command attaches the staged database with `AS dataset (READ_ONLY)` and creates `main.data` as a view over `dataset.main.data` before `-ui` starts. SQL string literals escape the KLOPSI-created staged path, and no shell interprets the command.

The default installer:

- fetches only `https://install.duckdb.org` on Linux/macOS or `https://install.duckdb.org/install.ps1` on Windows;
- limits the response body to 1 MiB;
- writes the installer into an owner-only temporary directory;
- runs `sh <installer>` or PowerShell with `-NoProfile -ExecutionPolicy Bypass -File <installer>`;
- pins `DUCKDB_VERSION` to the CLI version compatible with KLOPSI’s staged database format;
- removes the temporary directory on success or failure;
- verifies the installed CLI before returning.

The runner maps command-not-found, installer download, installer exit, and UI exit failures to typed, sanitized KLOPSI errors. Program dependencies accept an injected runner for deterministic tests.

### Command and agent integration

The normalized command manifest declares `duckdb open` and `duckdb install`, so help and shell completion update automatically. A new command adapter connects the runner to `QueryService.withDatabase`.

The generated Agent Skills repertoire adds `klopsi-dataset-workbench` as a command skill that owns both new command paths. Its workflow tells agents to:

1. use KLOPSI acquisition, validation, and analysis skills to obtain or compute the relevant artifact;
2. represent the prepared dataset as the read-only `data` relation in a writable local database workbench;
3. use DuckDB UI for interactive exploration, SQL iteration, tables, summaries, and temporary charts;
4. retain `data` as the workbench relation name;
5. install the external CLI only with explicit user authorization;
6. optionally create a DuckDB UI notebook named `Example queries` through supported UI interactions;
7. use static or interactive HTML dashboard skills when the requested result is a durable, self-contained presentation rather than a local exploratory session.

The router, generated skill index, checked-in generated files, and public skill documentation include the new skill.

### Optional Example queries notebook

After opening the workbench, the agent offers to create a notebook named `Example queries`. If the user accepts and the agent can control the open DuckDB UI, it creates the notebook through the UI rather than writing DuckDB UI's private `_duckdb_ui` tables. The notebook contains a small dataset-specific sequence of titled SQL cells, chosen from:

1. preview and schema orientation;
2. coverage and completeness;
3. latest values or top categories;
4. trends, comparisons, or period-over-period changes;
5. missing-period, duplicate, or null checks.

Queries use the simple relation name `data`, remain read-only, and avoid redundant cells. If UI control is unavailable, the agent does not claim a notebook was created; it presents the proposed query list and offers SQL that the user can paste into an `Example queries` notebook.

### Handoff presentation

The Agent Skill requires a concise, scannable handoff while the workbench is available:

1. title `DuckDB dataset workbench`;
2. the local workbench URL as the primary next action;
3. dataset title and compact facts such as relation name, rows, time coverage, measures, and columns;
4. validation, provenance, and read-only attachment checks;
5. `Example queries` status: created, offered, or unavailable, followed by numbered query topics;
6. source and transformation files;
7. a short note that the dataset is attached read-only and the writable workbench is session-local.

The handoff avoids a loose paragraph, raw diagnostic dump, or a single unexplained SQL block. It never says a notebook exists unless the agent created it successfully.

## Safety and compatibility

- DuckDB UI opens a separate writable invocation-local workbench. The staged database is attached with DuckDB's `READ_ONLY` option, and KLOPSI source and provenance files are never passed as writable database filenames.
- UI mode is an explicitly requested local interactive capability. DuckDB UI may install/load its official `ui` extension and exposes DuckDB’s own local SQL environment; it is not the bounded SQL sandbox used by `klopsi query`.
- Notebook creation uses supported UI interaction. KLOPSI and its Agent Skill do not insert into or depend on DuckDB UI's private internal tables.
- Installer execution requires `duckdb install --yes` or the explicit `duckdb open --install` flag. No installation occurs during ordinary package installation, diagnostics, query, conversion, or UI open when the CLI already exists.
- The existing optional `@duckdb/node-api` dependency remains optional and is still required for staging. The external DuckDB CLI is a separate optional UI dependency.
- Existing `query` syntax, limits, warnings, cache metadata, cache identity, and cleanup errors remain backward compatible.
- Linux x64 glibc, macOS arm64, and Windows x64 remain the supported targets. Unsupported platforms receive a typed error before installer execution.

## Error handling

- Missing external executable: `DUCKDB_CLI_UNAVAILABLE`, exit 5.
- Unsupported installer platform: `DUCKDB_CLI_INSTALL_UNSUPPORTED`, exit 5.
- Missing confirmation: `CONFIRMATION_REQUIRED`, exit 2.
- Official installer fetch or execution failure: `DUCKDB_CLI_INSTALL_FAILED`, exit 5.
- DuckDB UI nonzero exit or spawn failure after discovery: `DUCKDB_UI_FAILED`, exit 6.
- Input resolution, archive selection, format detection, staging, cache, and cleanup retain their existing typed errors.

Child stderr is inherited for interactive human use. KLOPSI errors do not include arbitrary installer output, local cache paths, URLs with credentials, or child stacks unless the existing `--debug` path is explicitly selected.

## Testing

Unit and integration coverage will prove:

- `withDatabase` builds, caches, leases, and cleans a database while leaving existing query behavior unchanged;
- a callback can read the staged `data` table and no invocation-local path survives cleanup;
- manifest registration, help, completion, and agent-skill command ownership include both commands;
- the command passes selectors and network overrides through input resolution;
- the runner probes the CLI, handles exit and spawn failures, and never invokes a shell for UI launch;
- the runner launches a writable workbench, attaches the staged database read-only with a safely escaped path, exposes the `data` view, and cleans the workbench after UI exit;
- installation requires explicit authorization, fetches only the pinned official URL under the byte bound, executes the platform-specific installer with a pinned version, verifies it, and cleans temporary files;
- `open --install` installs only after a missing-CLI result and then launches the UI;
- generated skills and packed CLI artifacts contain `klopsi-dataset-workbench` and no stale `klopsi-duckdb-ui`;
- generated guidance offers an optional `Example queries` notebook, requires accurate creation status, and contains the structured handoff contract;
- documentation distinguishes exploratory DuckDB UI from bounded `klopsi query` and durable HTML dashboards.

The full repository format, lint, typecheck, unit, integration, end-to-end, and package checks must pass before delivery.

## Delivery

The change will be committed on `codex/duckdb-ui`, pushed to `origin`, and update pull request #31 against `main`.
