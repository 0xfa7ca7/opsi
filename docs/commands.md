# Command reference

Global flags: `--json`, `--ndjson`, `--csv`, `--tsv`, `--output-format table|json|ndjson|csv|tsv`, `--provider`, `--offline`, cache/download/HTTP/preview/query/DuckDB limit overrides, `--quiet`, `--debug`, and `--no-color`. Result data uses stdout; diagnostics use stderr. Non-TTY sessions never prompt. Errors use stable exit categories 0–8 and omit stacks unless `--debug`.

- `search [text]`: filters by organization, repeatable tag/format, license, modification dates, sort, limit, and offset.
- `dataset show|resources <id>`: shows metadata or resources. `dataset schema <id> [--resource ID] [--sheet NAME]` infers tabular fields. `dataset open <id>` opens only the validated public OPSI HTTPS page.
- `resource show|headers <id>` shows metadata or safely probes headers. `resource preview <input>` supports bounded `--limit` and XLSX `--sheet`.
- `download <ids...> [--output PATH|--destination PATH] [--force]` downloads securely and records provenance; multiple IDs require a directory/default destination.
- `validate <input> [--metadata] [--sheet NAME]` reports validation issues and exits 6 on failure.
- `convert <input> --to csv|tsv|json|ndjson|xlsx|parquet --output PATH` supports `--force`, `--sheet`, and `--spreadsheet-safe`.
- `query <input> --sql SQL` accepts one read-only SELECT/WITH/VALUES statement, with bounded limit, timeout, memory, threads, optional sheet, and bounded export output.
- `provenance show|verify <path>` reads or verifies the adjacent provenance record.
- `providers list`; `cache info|list|clear|prune|verify`; `config get <key>|set <key> <JSON-or-string>|list|path`.
- `doctor [--offline] [--json]` checks Node, configuration, writable cache/temp storage, connectivity unless offline, DuckDB load/query, and every registered format.
- `completion bash|zsh|fish` prints a static, offline script generated from the command manifest. Redirect it to the appropriate shell completion location.

Remote content flags `--allow-insecure-http` and `--allow-private-network` relax a single invocation only. Use `--help` on each command for exact arguments and examples.
