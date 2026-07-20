---
name: opsi-shared
description: "Apply shared OPSI CLI installation, structured-output, offline, safety, and error-handling rules. Load with every OPSI domain skill."
---

# OPSI shared execution contract

Read this before using any OPSI domain skill. Generated for `opsi` 0.1.0.

## Install and discover

```sh
npm install --global opsi
opsi --version
opsi --help
opsi <command> --help
```

Use the installed CLI as the source of truth when its help differs from generated skill text.

## Structured output

- Prefer `--json` for one bounded result envelope or `--ndjson` for streamed records.
- Use `--fields` and command-specific row limits to keep agent context small.
- Read result data from stdout, diagnostics from stderr, and the exit status as the authoritative success signal.
- Inspect the structured `error.code` together with the exit status before choosing remediation.
- Never parse a human-readable table when structured output is available.

## Global options

| Option | Values | Conflicts | Description |
| --- | --- | --- | --- |
| `--json` | — | `ndjson`, `csv`, `tsv`, `outputFormat` | render JSON |
| `--ndjson` | — | `json`, `csv`, `tsv`, `outputFormat` | render newline-delimited JSON |
| `--csv` | — | `json`, `ndjson`, `tsv`, `outputFormat` | render CSV |
| `--tsv` | — | `json`, `ndjson`, `csv`, `outputFormat` | render TSV |
| `--output-format <format>` | `table`, `json`, `ndjson`, `csv`, `tsv` | — | select output format |
| `--fields <field>` | field | — | select output field (repeatable or comma-separated) |
| `--provider <id>` | `opsi`, `local` | — | select provider |
| `--offline` | — | — | disable network access |
| `--cache-dir <path>` | path | — | override cache directory |
| `--download-dir <path>` | path | — | override download directory |
| `--http-timeout-ms <number>` | number | — | HTTP timeout in milliseconds |
| `--max-download-bytes <number>` | number | — | maximum download size |
| `--preview-row-limit <number>` | number | — | preview row limit |
| `--query-row-limit <number>` | number | — | query row limit |
| `--query-timeout-ms <number>` | number | — | query timeout in milliseconds |
| `--duckdb-memory-limit <limit>` | limit | — | DuckDB memory limit |
| `--duckdb-threads <number>` | number | — | DuckDB worker threads |
| `--quiet` | — | — | suppress non-result output |
| `--debug` | — | — | include diagnostic stack traces |
| `--no-color` | — | — | disable color output |

## Network and offline behavior

- Pass `--offline` when network access is prohibited. Do not imply that an uncached request can succeed offline.
- Preserve HTTPS, DNS, redirect, timeout, download-size, query, memory, thread, cell, and output bounds.
- Use `--allow-insecure-http` or `--allow-private-network` only after the user explicitly accepts that invocation's risk.
- Do not blindly retry invalid input, unsupported operations, validation failures, or integrity failures.

## Confirm mutations

- Confirm before `cache clear` or `cache prune` unless the user already requested that exact operation.
- Confirm before using `--force` to replace an artifact unless that exact overwrite is already authorized.
- Do not persist secret-like configuration values; use the environment for secrets.

## Exit categories

| Exit | Meaning | Response |
| --- | --- | --- |
| 0 | Success | Use the structured result. |
| 1 | Internal failure | Report diagnostics; retry only when evidence suggests a transient failure. |
| 2 | Invalid input or configuration | Correct the command or configuration before retrying. |
| 3 | Not found | Check the exact dataset, resource, or local path. |
| 4 | Provider or network failure | Respect offline mode and retry only transient failures. |
| 5 | Unsupported operation | Choose a supported provider, format, or installed native dependency. |
| 6 | Validation or integrity failure | Report issues and repair or replace the input. |
| 7 | Query failure | Correct the bounded read-only SQL or resource input. |
| 8 | Partial success | Report successes and failures separately. |

## Shell discipline

- Quote paths and user-provided values safely.
- Never print credentials, authorization headers, cookies, or secret environment values.
- Use canonical references returned by `opsi` when available.
