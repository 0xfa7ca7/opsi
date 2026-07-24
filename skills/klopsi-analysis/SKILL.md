---
name: klopsi-analysis
description: "Use when querying or converting bounded data, including ZIP, XML, JSON, XLSX, Parquet, or query exports."
---

# klopsi-analysis

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Compare tabular refreshes, analyze inputs with bounded read-only SQL, or convert supported formats. Generated for `klopsi` 0.0.1.

## Workflow

- Preview and validate input before running a bounded query.
- Compare two refreshes by explicit unique keys before interpreting downstream changes.
- Convert an input and then verify the generated provenance record.

## Capability guide

### Choose a supported input

- Query or convert CSV, TSV, JSON, NDJSON, XLSX, Parquet, ZIP, or XML only after inspection identifies a usable tabular member.
- Use a resolved `--entry`, `--record-path`, or `--sheet` whenever ZIP, XML, or XLSX input is ambiguous.
- Use `diff` with explicit non-null unique key columns; correct missing, type-mismatched, null, or duplicate key diagnostics instead of accepting misleading row counts.

### Run bounded read-only SQL

- Use one read-only `SELECT`, `WITH ... SELECT`, or `VALUES` statement, with an explicit `--limit` and a suitable timeout.
- Keep global query row, time, memory, and thread bounds appropriate to the requested result; correct exit 7 rather than retrying the same query.

### Export query results

- Use `--output` for a bounded query export and choose a new path unless the user explicitly authorizes `--force`.
- Run `provenance verify` on an important query export before reporting it as a final artifact.

### Convert safely

- Choose a supported conversion target and `--output`; use `--spreadsheet-safe` for CSV or XLSX intended for spreadsheet software.
- Validate or inspect the converted result and use `provenance verify`; do not overwrite an existing destination without authorization.

## Commands

### `diff`

Compare two tabular datasets by explicit keys (experimental).

```sh
klopsi diff <before> <after> --key <columns...> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<before>` | — | earlier local path or canonical resource reference |
| `<after>` | — | later local path or canonical resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--key <columns...>` | yes | columns... | — | key columns that uniquely identify a row |
| `--limit <rows>` | no | rows | — | maximum samples per change class (1-100) |
| `--before-sheet <name>` | no | name | — | XLSX sheet for the earlier input |
| `--after-sheet <name>` | no | name | — | XLSX sheet for the later input |
| `--before-entry <path>` | no | path | — | ZIP data entry for the earlier input |
| `--after-entry <path>` | no | path | — | ZIP data entry for the later input |
| `--before-record-path <path>` | no | path | — | XML record path for the earlier input |
| `--after-record-path <path>` | no | path | — | XML record path for the later input |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `query`

Run one sandboxed read-only query over tabular data.

```sh
klopsi query <input> --sql <query> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<input>` | — | local path or canonical resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--sql <query>` | yes | query | — | one SELECT, WITH ... SELECT, or VALUES statement |
| `--limit <rows>` | no | rows | — | maximum returned rows |
| `--timeout-ms <milliseconds>` | no | milliseconds | — | hard query deadline |
| `--sheet <name>` | no | name | — | XLSX sheet name |
| `--entry <path>` | no | path | — | ZIP data entry path |
| `--record-path <path>` | no | path | — | XML record element path |
| `--output <path>` | no | path | — | export bounded results (.csv, .tsv, .json, .ndjson) |
| `--force` | no | — | — | replace an existing output |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `convert`

Convert tabular data between supported formats.

```sh
klopsi convert <input> --to <format> --output <path> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<input>` | — | local path or canonical resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--to <format>` | yes | `csv`, `tsv`, `json`, `ndjson`, `xlsx`, `parquet` | — | destination data format |
| `--output <path>` | yes | path | — | destination file path |
| `--sheet <name>` | no | name | — | XLSX sheet name |
| `--entry <path>` | no | path | — | ZIP data entry path |
| `--record-path <path>` | no | path | — | XML record element path |
| `--force` | no | — | — | replace an existing regular destination |
| `--spreadsheet-safe` | no | — | — | prefix formula-like string values |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |

## Safety

- Require explicit non-null unique keys for semantic dataset comparison.
- Keep SQL read-only and bounded.
- Confirm before replacing an existing output with --force.

## Related skills

- [klopsi-resources](../klopsi-resources/SKILL.md)
- [klopsi-validation](../klopsi-validation/SKILL.md)
- [klopsi-provenance](../klopsi-provenance/SKILL.md)
