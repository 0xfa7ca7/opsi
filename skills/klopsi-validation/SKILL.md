---
name: klopsi-validation
description: "Use when checking local or provider data, or OPSI metadata, for integrity issues and remediation."
---

# klopsi-validation

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Validate data content or normalized metadata and explain actionable issues. Generated for `klopsi` 0.0.1.

## Workflow

- Validate downloaded content before analysis or conversion.

## Capability guide

### Choose validation mode

- Validate a local path or canonical provider reference before analysis; use `--metadata` when only normalized metadata should be checked.
- Use offline validation after acquisition when all required input is local; do not silently retry a failed offline request online.

### Select structured data

- Use one `--entry` or `--record-path` reported by resource inspect or the relevant operation's structured error/output; resource inspect can surface ZIP entries and XML record paths.
- Without `--sheet`, XLSX resource preview, validate, or query emits `SHEET_REQUIRED` with `context.sheets` and a suggestion; use one listed sheet.

### Recover from validation failures

- Treat exit 6 as a validation or integrity failure: report the issues and repair, replace, or reselect the input before retrying.
- Do not treat validation or integrity failure as a transient network error or bypass it before analysis.

## Commands

### `validate`

Validate local data, provider resources, or metadata.

```sh
klopsi validate <input> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<input>` | — | data input or canonical metadata reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--metadata` | no | — | — | validate metadata without fetching resource content |
| `--sheet <name>` | no | name | — | XLSX sheet name |
| `--entry <path>` | no | path | — | ZIP data entry path |
| `--record-path <path>` | no | path | — | XML record element path |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |

## Safety

- Treat integrity failures as non-retryable until the input changes.

## Related skills

- [klopsi-resources](../klopsi-resources/SKILL.md)
- [klopsi-download](../klopsi-download/SKILL.md)
- [klopsi-analysis](../klopsi-analysis/SKILL.md)
