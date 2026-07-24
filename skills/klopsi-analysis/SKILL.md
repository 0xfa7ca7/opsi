---
name: klopsi-analysis
description: "Use when profiling, querying, or converting bounded data, including ZIP, XML, JSON, XLSX, Parquet, or query exports."
---

# klopsi-analysis

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Profile tabular inputs, analyze them with bounded read-only SQL, or convert supported formats. Generated for `klopsi` 0.0.1.

## Workflow

- Preview and validate input, then run a bounded profile before writing exploratory SQL.
- Convert an input and then verify the generated provenance record.

## Capability guide

### Choose a supported input

- Profile, query, or convert CSV, TSV, JSON, NDJSON, XLSX, Parquet, ZIP, or XML only after inspection identifies a usable tabular member.
- Use a resolved `--entry`, `--record-path`, or `--sheet` whenever ZIP, XML, or XLSX input is ambiguous.

### Profile a tabular input

- Use `klopsi profile <input> --json` for an initial schema, row-count, completeness, exact distinct-count, numeric-range, and categorical-frequency summary before composing custom SQL.
- Keep `--top` at its bounded default or lower it when compact agent context matters. Treat inferred DuckDB types and type-based categories as orientation signals, not domain semantics.

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

### `profile`

Profile bounded tabular data.

```sh
klopsi profile <input> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<input>` | — | local path or canonical resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--top <values>` | no | values | — | maximum top values per categorical field |
| `--timeout-ms <milliseconds>` | no | milliseconds | — | hard profile deadline |
| `--sheet <name>` | no | name | — | XLSX sheet name |
| `--entry <path>` | no | path | — | ZIP data entry path |
| `--record-path <path>` | no | path | — | XML record element path |
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

- Keep profiles bounded with --top and the inherited query deadline.
- Keep SQL read-only and bounded.
- Confirm before replacing an existing output with --force.

## Related skills

- [klopsi-resources](../klopsi-resources/SKILL.md)
- [klopsi-validation](../klopsi-validation/SKILL.md)
- [klopsi-provenance](../klopsi-provenance/SKILL.md)
