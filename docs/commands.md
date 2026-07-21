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

Syntax: `opsi dataset schema <id> [--resource <id-or-reference>] [--sheet <name>] [--entry <path>] [--record-path <path>]`. If exactly one tabular resource exists it is selected; otherwise `--resource` is required. Use `--sheet` for XLSX, `--entry` for ambiguous ZIP archives, and `--record-path` for ambiguous XML. Network safety overrides are available. Output contains inferred fields/types. Ambiguous selection exits 2, missing content exits 3, unsupported formats exit 5. Example: `opsi dataset schema dataset-traffic-001 --resource resource-traffic-csv-001 --json`.

### `dataset open`

Syntax: `opsi dataset open <id>`. Resolves metadata and opens only the validated `https://podatki.gov.si/dataset/...` public page through the platform browser. It never opens a resource URL. Invalid origins exit 2; missing metadata exits 3. Example: `opsi dataset open dataset-traffic-001`.

### `resource show`

Syntax: `opsi resource show <id>`. Returns normalized resource metadata, canonical reference, format, media type, and URL. Not found exits 3. Example: `opsi resource show resource-traffic-csv-001 --json`.

### `resource preview`

Syntax: `opsi resource preview <input> [--limit <rows>] [--sheet <name>] [--entry <path>] [--record-path <path>]`. Input may be local or a canonical resource. Previewing is bounded. XLSX, ambiguous ZIP, and ambiguous XML require their explicit selection option. Example: `opsi resource preview archive.zip --entry data/rows.csv --limit 10 --json`.

### `resource inspect`

Syntax: `opsi resource inspect <input>`. Returns the resource kind/protocol, detected format, supported OPSI operations, selection choices, limitations, and safe next-action argv arrays. It does not recommend raw HTTP clients. Example: `opsi resource inspect opsi:resource:RESOURCE_ID --json`.

### `resource headers`

Syntax: `opsi resource headers <id>`. Securely probes remote status, headers, media type, and size with the same HTTPS, DNS, redirect, and timeout policy as downloads. It is unavailable on an offline cache miss. Example: `opsi resource headers resource-traffic-csv-001 --json`.

### `providers list`

Syntax: `opsi providers list`. Returns the registered `opsi` catalogue provider and `local` file resolver with their names, homepages, and declared capabilities. `--provider local` is for local paths and `local:file:` references; catalogue operations return a typed unsupported-capability error. This command works without DuckDB. Example: `opsi providers list --json`.

## Files and data

### `download`

Syntax: `opsi download <ids...> [--dataset|--resource] [--destination <path>|--output <path>] [--force]`. Canonical `provider:dataset:id` and `provider:resource:id` references are self-describing. Bare IDs require exactly one selector; dataset selection expands all embedded resources and an empty dataset exits 3. A directory receives sanitized provider filenames; a file path is valid for one selected resource. Each artifact and provenance sidecar is transactionally published without clobber races. Existing different content is not overwritten without `--force`. Partial batches exit 8. Examples: `opsi download RESOURCE_ID --resource --output ./downloads --json` and `opsi download opsi:dataset:DATASET_ID --output ./downloads`.

### `validate`

Syntax: `opsi validate <input> [--metadata] [--sheet <name>] [--entry <path>] [--record-path <path>]`. Without `--metadata`, validates local/provider content; use `--sheet` for XLSX, `--entry` for ambiguous ZIP archives, and `--record-path` for ambiguous XML. With `--metadata`, input must be a canonical dataset/resource reference and only metadata is checked. The remote-content overrides `--allow-insecure-http` and `--allow-private-network` apply to content validation for one invocation. Output includes issues, severities, and recommendations. Invalid data exits 6. Example: `opsi validate ./downloads/traffic.csv --json`.

### `convert`

Syntax: `opsi convert <input> --to <csv|tsv|json|ndjson|xlsx|parquet> --output <path> [options]`. Options include `--sheet`, `--entry`, `--record-path`, `--force`, `--spreadsheet-safe`, and network overrides. Publication is atomic. Example: `opsi convert stations.xml --record-path /root/station --to parquet --output stations.parquet`.

### `query`

Syntax: `opsi query <input> --sql <statement> [options]`. Only one read-only SELECT, WITH…SELECT, or VALUES statement is accepted. Options include `--limit`, `--timeout-ms`, `--sheet`, `--entry`, `--record-path`, `--output`, `--force`, and network overrides. User SQL runs against OPSI-owned table `data` with row/time/memory/thread/cell/output bounds and external access disabled. Example: `opsi query archive.zip --entry rows.csv --sql "select * from data limit 2" --json`.

### `service inspect`

Syntax: `opsi service inspect <resource>`. Inspects a canonical WFS resource and reports the negotiated service version, supported operations, output formats, and advertised layers. The remote-content overrides apply for one invocation. Example: `opsi service inspect opsi:resource:ID --json`.

### `service layers`

Syntax: `opsi service layers <resource>`. Lists the feature layers exposed by a canonical WFS resource. The remote-content overrides apply for one invocation. Example: `opsi service layers opsi:resource:ID --json`.

### `service schema`

Syntax: `opsi service schema <resource> --layer <name>`. Describes the fields and types for one feature layer. The remote-content overrides apply for one invocation. Example: `opsi service schema opsi:resource:ID --layer si:roads --json`.

### `service preview`

Syntax: `opsi service preview <resource> --layer <name> [options]`. `--limit` and nonnegative `--start-index` bound pagination. Repeatable/comma-separated `--property` selects fields, repeatable `--filter-eq field=value` applies typed equality filters, and `--bbox minx,miny,maxx,maxy` accepts an optional `--crs`. Raw CQL/XML filters are not supported. Example: `opsi service preview opsi:resource:ID --layer si:roads --property id,name --limit 5 --json`.

### `service count`

Syntax: `opsi service count <resource> --layer <name> [options]`. Repeatable `--filter-eq field=value` applies typed equality filters, and `--bbox minx,miny,maxx,maxy` accepts an optional `--crs`. The operation is read-only and does not accept raw CQL/XML filters. Example: `opsi service count opsi:resource:ID --layer si:roads --filter-eq status=active --json`.

### `service export`

Syntax: `opsi service export <resource> --layer <name> --output <path> [options]`. Exports bounded CSV rows using `--limit`, nonnegative `--start-index`, repeatable/comma-separated `--property`, typed `--filter-eq field=value`, `--bbox`, and `--crs`. Existing regular files require `--force`. Write transactions and raw CQL/XML filters are not supported. Example: `opsi service export opsi:resource:ID --layer si:roads --limit 1000 --output roads.csv`.

### `provenance show`

Syntax: `opsi provenance show <path>`. Reads the adjacent versioned provenance record for a downloaded/converted/query-exported artifact. Missing or malformed provenance exits 3 or 6. Example: `opsi provenance show traffic.parquet --json`.

### `provenance verify`

Syntax: `opsi provenance verify <path>`. Recomputes the artifact SHA-256 and compares the stored record. Mismatch/tampering exits 6. Example: `opsi provenance verify traffic.parquet --json`.

## Local state

### `cache info`

Reports cache paths, object/metadata counts, total bytes, and separate DuckDB-derived object/byte/budget/TTL totals. Example: `opsi cache info --json`.

### `cache list`

Lists cache objects without mutation, marking them `raw` or `duckdb-stage`; derived entries include format and retention timestamps but no source path, URL, SQL, or result rows. Example: `opsi cache list --json`.

### `cache clear`

Deletes cache content with `--yes` or an interactive human confirmation. Non-TTY and structured-output use never prompt and exit 2 with `CONFIRMATION_REQUIRED`. Example: `opsi cache clear --yes`.

### `cache prune`

Removes expired metadata and unreferenced objects with `--yes` or interactive human confirmation. Derived stages are expired first and then evicted by least-recent use until their separate budget is met. Raw cache entries are not evicted to meet that budget. Publication locks and valid live references are preserved. Example: `opsi cache prune --yes --json`.

### `cache verify`

Re-hashes cached objects and structurally opens derived DuckDB stages read-only. Any corrupt object exits 6. Example: `opsi cache verify --json`.

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

### `generate-skills`

Syntax: `opsi generate-skills [--output-dir <path>]`. Generates the complete installable Agent Skills repertoire for compatible AI-agent hosts. The default output directory is `./skills`; the `--output-dir` option accepts relative paths resolved from the current directory or absolute paths.

Generation is deterministic, idempotent, and offline. It creates the output and known skill directories as needed, atomically replaces only known generated `SKILL.md` targets, and preserves unrelated files. An existing non-directory or symbolic-link target is rejected with `SKILL_OUTPUT_INVALID`. Other filesystem failures return `SKILL_GENERATION_FAILED`. Normal structured output flags are supported; for example, `opsi generate-skills --output-dir ~/.agents/skills --json` returns the resolved output directory, generated skill count, and skill names.

### `agent setup`

Syntax: `opsi agent setup [--agent <ids...> | --all] [--yes] [--dry-run]`. Generates the current version's complete OPSI Agent Skills repertoire in a private temporary directory, performs automatic agent detection from a registry synchronized with the pinned Agent Skills installer, then uses that installed runtime for global installation. OPSI passes only resolved, validated agent IDs with non-prompting confirmation and always copies skills durably because the generated source is temporary, so the installer cannot offer unrelated remote skills or leave targets dependent on cleanup. The temporary directory is removed after success or failure. The command does not run `npx`, fetch skills from GitHub, or create project-local `.agents` and `skills-lock.json` files.

In an interactive terminal, no selection flag is required: one detected host is selected automatically and multiple detected hosts require one OPSI confirmation. `--yes` accepts the detected set without prompting, `--agent <ids...>` chooses explicit validated installer IDs, and `--all` targets every profile in the pinned registry that supports global installation. If no host is detected, setup exits 2 with `AGENT_HOSTS_NOT_DETECTED`; `--yes` never turns that empty set into all profiles. `--agent` and `--all` conflict. `--dry-run` returns the installer version, global scope, requested selection, and generated skill names without creating a temporary directory, probing the host filesystem, or resolving the installer.

Non-interactive and structured-output invocations must use `--yes`, `--agent`, or `--all` unless they are dry runs; otherwise they exit 2 with `AGENT_SETUP_NONINTERACTIVE_REQUIRED`. Invalid, unknown, duplicate, or conflicting selections return `AGENT_SETUP_OPTIONS_INVALID`. Installer resolution failures return `AGENT_INSTALLER_UNAVAILABLE`; nonzero installer exits return `AGENT_SETUP_FAILED` with a bounded diagnostic. A zero-exit upstream result that reports failed targets becomes `AGENT_SETUP_PARTIAL` with exit 8. Normal structured output flags are supported; for example, `opsi agent setup --agent codex --yes --json` installs without mixing installer decoration into stdout.
