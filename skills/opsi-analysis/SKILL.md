---
name: opsi-analysis
description: "Query or convert bounded tabular data with OPSI CLI. Use for read-only SQL analysis, CSV/TSV/JSON/NDJSON/XLSX/Parquet conversion, and exported query results."
---

# opsi-analysis

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Analyze tabular inputs with bounded read-only SQL or convert supported formats. Generated for `opsi` 0.1.0.

## Workflow

- Preview and validate input before running a bounded query.
- Convert an input and then verify the generated provenance record.

## Commands

### `query`

Run one sandboxed read-only query over tabular data.

```sh
opsi query <input> --sql <query> [options]
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
| `--output <path>` | no | path | — | export bounded results (.csv, .tsv, .json, .ndjson) |
| `--force` | no | — | — | replace an existing output |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `convert`

Convert tabular data between supported formats.

```sh
opsi convert <input> --to <format> --output <path> [options]
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
| `--force` | no | — | — | replace an existing regular destination |
| `--spreadsheet-safe` | no | — | — | prefix formula-like string values |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |

## Safety

- Keep SQL read-only and bounded.
- Confirm before replacing an existing output with --force.

## Related skills

- [opsi-resources](../opsi-resources/SKILL.md)
- [opsi-validation](../opsi-validation/SKILL.md)
- [opsi-provenance](../opsi-provenance/SKILL.md)
