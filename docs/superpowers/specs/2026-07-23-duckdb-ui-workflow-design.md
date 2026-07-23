# DuckDB UI Workflow Design

## Goal

Give people and AI agents one quick KLOPSI workflow for opening acquired or computed tabular data in DuckDB UI, while keeping the external DuckDB CLI an explicit optional installation.

## User experience

KLOPSI adds a `duckdb` command group:

```text
klopsi duckdb open <input> [--sheet <name>] [--entry <path>] [--record-path <path>] [--install]
klopsi duckdb install --yes
```

`duckdb open` accepts the same local paths, `local:file:` references, provider resource references, archives, and structured-data selectors as `query`. KLOPSI resolves the input, stages it as a DuckDB database containing the table `data`, and starts the external DuckDB CLI with that database in read-only UI mode. The process stays attached until DuckDB UI exits so KLOPSI can retain and then clean up the invocation-local database safely.

If the DuckDB CLI is absent, `duckdb open` returns `DUCKDB_CLI_UNAVAILABLE` with commands for either `klopsi duckdb install --yes` or the one-call `klopsi duckdb open <input> --install` path. `--install` installs only when the CLI is unavailable. `duckdb install` refuses to make changes without `--yes`, reports an already available compatible CLI without reinstalling it, and uses the DuckDB project’s official HTTPS installer.

Human output leaves the child CLI attached to the terminal so DuckDB can display its local UI address and lifecycle messages. Structured output is written after the UI process exits and records the resolved source, table name, derived-stage cache status, CLI version, and whether installation occurred.

## Architecture

### Reusable staged-database lease

`QueryDatabaseCache` extracts its current stage/materialize/verify/cleanup lifecycle into a callback-based `withDatabase` operation:

```ts
withDatabase<T>(
  source: DataInput,
  options: QueryDatabasePreparationOptions,
  operation: (databasePath: string, metadata: QueryDatabaseMetadata) => Promise<T>,
): Promise<T>
```

The callback receives an invocation-local database path, never the canonical derived-cache object. The database contains exactly one base table named `data`. Cleanup runs after the callback settles. Existing query execution delegates to this lease and keeps its public results and cache behavior unchanged.

`QueryService.withDatabase` wraps this lease in `DataService.withResolvedInput`, preserving provider download controls, ZIP extraction, XLSX sheet selection, XML record selection, cache reuse, and temporary-input cleanup. It returns the callback result plus source, cache, and warnings.

### External CLI runner

A focused CLI module owns external DuckDB discovery, installation, and execution. It uses argument-array process spawning rather than a shell command. UI launch uses the staged database as the filename and passes `-readonly` and `-ui`.

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

The generated Agent Skills repertoire adds `klopsi-duckdb-ui` as a command skill that owns both new command paths. Its workflow tells agents to:

1. use KLOPSI acquisition, validation, and analysis skills to obtain or compute the relevant artifact;
2. use DuckDB UI for interactive exploration, SQL iteration, tables, summaries, and temporary charts;
3. retain `data` as the staged table name;
4. install the external CLI only with explicit user authorization;
5. use static or interactive HTML dashboard skills when the requested result is a durable, self-contained presentation rather than a local exploratory session.

The router, generated skill index, checked-in generated files, and public skill documentation include the new skill.

## Safety and compatibility

- The staged database is opened read-only by the external CLI. KLOPSI source and provenance files are never passed as writable database filenames.
- UI mode is an explicitly requested local interactive capability. DuckDB UI may install/load its official `ui` extension and exposes DuckDB’s own local SQL environment; it is not the bounded SQL sandbox used by `klopsi query`.
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
- the runner probes the CLI, launches exact read-only UI arguments, handles exit and spawn failures, and never invokes a shell for UI launch;
- installation requires explicit authorization, fetches only the pinned official URL under the byte bound, executes the platform-specific installer with a pinned version, verifies it, and cleans temporary files;
- `open --install` installs only after a missing-CLI result and then launches the UI;
- generated skills and packed CLI artifacts contain `klopsi-duckdb-ui`;
- documentation distinguishes exploratory DuckDB UI from bounded `klopsi query` and durable HTML dashboards.

The full repository format, lint, typecheck, unit, integration, end-to-end, and package checks must pass before delivery.

## Delivery

The change will be committed on `codex/duckdb-ui`, pushed to `origin`, and opened as a pull request against `main`.
