# Command reference

All commands send result data to stdout and warnings/diagnostics to stderr. Human tables are the interactive default. `--json`, `--ndjson`, `--csv`, `--tsv`, and `--output-format table|json|ndjson|csv|tsv` select machine output and are mutually exclusive. JSON uses `{schemaVersion,data,meta,error?}`. Stable exit categories are 0 success, 1 internal, 2 invalid input/configuration, 3 not found, 4 provider/network, 5 unsupported, 6 validation/integrity, 7 query, and 8 partial success. Stacks require `--debug` and are redacted.

Global controls are `--provider opsi|local`, repeatable/comma-separated `--fields`, `--offline`, `--cache-dir`, `--download-dir`, `--http-timeout-ms`, `--max-download-bytes`, `--preview-row-limit`, `--query-row-limit`, `--query-timeout-ms`, `--duckdb-memory-limit`, `--duckdb-threads`, `--quiet`, `--debug`, and `--no-color`. Field projection preserves the requested order in every output format. `NO_COLOR` also disables styling. Remote-content overrides `--allow-insecure-http` and `--allow-private-network` affect one invocation only.

## Catalogue

### `search`

Syntax: `opsi search [text] [options]`. Filters: `--organization`, repeatable `--tag` and `--format`, `--license`, `--modified-after`, `--modified-before`, repeatable `--sort field:asc|desc`, positive `--limit`, nonnegative `--offset`, and `--all`. `--all` performs bounded advancing page traversal and conflicts with `--limit`. Output is dataset summaries with deterministic pagination metadata. Invalid sort/number values exit 2; provider failures exit 4. Example: `opsi search promet --tag mobilnost --format CSV --all --fields id,title --json`.

### `dataset show`

Syntax: `opsi dataset show <id>`. Returns complete normalized dataset metadata and embedded resources. A missing ID exits 3; malformed provider data or network failure exits 4. Example: `opsi dataset show dataset-traffic-001 --json`.

### `dataset list`

Syntax: `opsi dataset list [--refresh|--live]`. By default, this reads the centrally published catalogue snapshot, using a valid local cache when available and otherwise downloading the current snapshot. Snapshots must be no more than 24 hours old. Snapshot mode supports exactly the fields `id`, human-readable `title`, and provider slug `name`; global `--fields` can select and reorder those fields. JSON metadata includes `total`, `count`, `source` (`snapshot-cache` or `snapshot-remote`), `generatedAt`, and `stale: false`.

`--refresh` bypasses a fresh local snapshot and checks the published snapshot, but never queries OPSI directly; it is rejected in offline mode. Snapshot validation or retrieval failures are returned without a silent live fallback. In offline mode, normal listing succeeds only with a valid cached snapshot that is no more than 24 hours old; missing, invalid, and stale snapshots fail without network access.

`--live` is the explicit, slower direct-OPSI mode. It uses advancing 300-row provider pages, conflicts with `--refresh`, and is rejected in offline mode. Only live human, NDJSON, CSV, and TSV output streams each provider page as it arrives; live JSON buffers one envelope with `total`, `count`, `pages`, and `source: "live"`. Invalid live pagination exits 4. Examples: `opsi dataset list --fields name,id --json`, `opsi dataset list --refresh --json`, and `opsi dataset list --live --ndjson`.

### `dataset resources`

Syntax: `opsi dataset resources <id>`. Returns resources belonging to the dataset. Missing datasets exit 3. Example: `opsi dataset resources dataset-traffic-001 --csv`.

### `dataset schema`

Syntax: `opsi dataset schema <id> [--resource <id-or-reference>] [--sheet <name>]`. If exactly one tabular resource exists it is selected; otherwise `--resource` is required. Network safety overrides are available. Output contains inferred fields/types. Ambiguous selection exits 2, missing content exits 3, unsupported formats exit 5. Example: `opsi dataset schema dataset-traffic-001 --resource resource-traffic-csv-001 --json`.

### `dataset open`

Syntax: `opsi dataset open <id>`. Resolves metadata and opens only the validated `https://podatki.gov.si/dataset/...` public page through the platform browser. It never opens a resource URL. Invalid origins exit 2; missing metadata exits 3. Example: `opsi dataset open dataset-traffic-001`.

### `resource show`

Syntax: `opsi resource show <id>`. Returns normalized resource metadata, canonical reference, format, media type, and URL. Not found exits 3. Example: `opsi resource show resource-traffic-csv-001 --json`.

### `resource preview`

Syntax: `opsi resource preview <input> [--limit <rows>] [--sheet <name>]`. Input may be a local path, `local:file:` reference, bare resource ID, or canonical resource reference. Previewing is bounded and never executes spreadsheet formulas. XLSX with multiple sheets requires `--sheet`. Unsupported/malformed content exits 5/6. Example: `opsi resource preview traffic.xlsx --sheet Data --limit 10 --json`.

### `resource headers`

Syntax: `opsi resource headers <id>`. Securely probes remote status, headers, media type, and size with the same HTTPS, DNS, redirect, and timeout policy as downloads. It is unavailable on an offline cache miss. Example: `opsi resource headers resource-traffic-csv-001 --json`.

### `providers list`

Syntax: `opsi providers list`. Returns the registered `opsi` catalogue provider and `local` file resolver with their names, homepages, and declared capabilities. `--provider local` is for local paths and `local:file:` references; catalogue operations return a typed unsupported-capability error. This command works without DuckDB. Example: `opsi providers list --json`.

## Files and data

### `download`

Syntax: `opsi download <ids...> [--dataset|--resource] [--destination <path>|--output <path>] [--force]`. Canonical `provider:dataset:id` and `provider:resource:id` references are self-describing. Bare IDs require exactly one selector; dataset selection expands all embedded resources and an empty dataset exits 3. A directory receives sanitized provider filenames; a file path is valid for one selected resource. Each artifact and provenance sidecar is transactionally published without clobber races. Existing different content is not overwritten without `--force`. Partial batches exit 8. Examples: `opsi download RESOURCE_ID --resource --output ./downloads --json` and `opsi download opsi:dataset:DATASET_ID --output ./downloads`.

### `validate`

Syntax: `opsi validate <input> [--metadata] [--sheet <name>]`. Without `--metadata`, validates local/provider tabular content. With it, input must be a canonical dataset/resource reference and only metadata is checked. Output includes issues, severities, and recommendations. Invalid data exits 6. Example: `opsi validate ./downloads/traffic.csv --json`.

### `convert`

Syntax: `opsi convert <input> --to <csv|tsv|json|ndjson|xlsx|parquet> --output <path> [options]`. Options are `--sheet`, `--force`, `--spreadsheet-safe`, and network overrides. Publication is atomic; provenance records the source, digest, transformation, and override flags. Unsupported conversion exits 5; invalid input/output conflicts exit 2. Example: `opsi convert traffic.csv --to parquet --output traffic.parquet`.

### `query`

Syntax: `opsi query <input> --sql <statement> [options]`. Only one read-only SELECT, WITH…SELECT, or VALUES statement is accepted. Options: `--limit`, `--timeout-ms`, `--sheet`, `--output`, `--force`, and network overrides. User SQL runs in a worker against staged table `data`, with row/time/1GB memory/4-thread/cell/output bounds and extensions/external access disabled. Rejected, timed-out, or cancelled queries exit 7. Example: `opsi query traffic.csv --sql "select * from data limit 2" --json`.

### `provenance show`

Syntax: `opsi provenance show <path>`. Reads the adjacent versioned provenance record for a downloaded/converted/query-exported artifact. Missing or malformed provenance exits 3 or 6. Example: `opsi provenance show traffic.parquet --json`.

### `provenance verify`

Syntax: `opsi provenance verify <path>`. Recomputes the artifact SHA-256 and compares the stored record. Mismatch/tampering exits 6. Example: `opsi provenance verify traffic.parquet --json`.

## Local state

### `cache info`

Reports cache paths, object/metadata counts, and bytes. Example: `opsi cache info --json`.

### `cache list`

Lists cache objects and metadata without mutation. Example: `opsi cache list --json`.

### `cache clear`

Deletes cache content with `--yes` or an interactive human confirmation. Non-TTY and structured-output use never prompt and exit 2 with `CONFIRMATION_REQUIRED`. Example: `opsi cache clear --yes`.

### `cache prune`

Removes expired metadata and unreferenced objects with `--yes` or interactive human confirmation. Publication locks and valid live references are preserved. Example: `opsi cache prune --yes --json`.

### `cache verify`

Re-hashes cached objects and reports corruption. Any corrupt object exits 6. Example: `opsi cache verify --json`.

### `config get`

Syntax: `opsi config get <dotted-key>`. Reads the persisted user source (not secret environment values). Example: `opsi config get query.rowLimit --json`.

### `config set`

Syntax: `opsi config set <dotted-key> <JSON-or-string>`. The complete strict source is validated and atomically written mode 0600. Secret-like keys are rejected. Example: `opsi config set query.rowLimit 500`.

### `config list`

Lists persisted user configuration only. It does not print `OPSI_API_KEY`. Example: `opsi config list --json`.

### `config path`

Returns platform user configuration and current project configuration paths. Example: `opsi config path --json`.

## Diagnostics and shell integration

### `doctor`

Syntax: `opsi doctor [--offline]`. Aggregates Node, configuration, writable cache/temp, connectivity (or deterministic skip), real DuckDB load/query, and real CSV/TSV/JSON/NDJSON/XLSX/Parquet handler previews. Output is `{status,checks[]}` where each check is `pass`, `fail`, or `skip`. All checks run before failure. Native absence exits 5 as `DUCKDB_UNAVAILABLE`; connectivity failure exits 4; other failed checks exit 6. Example: `opsi doctor --offline --json`.

### `completion`

Syntax: `opsi completion <bash|zsh|fish>`. Prints a static script generated from the normalized command manifest. It completes only known commands/options/enum/provider values plus local filesystem paths and never calls OPSI. Install with `opsi completion bash > ~/.local/share/bash-completion/completions/opsi`, the corresponding zsh `$fpath` file, or `~/.config/fish/completions/opsi.fish`.
