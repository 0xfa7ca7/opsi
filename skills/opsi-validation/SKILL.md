---
name: opsi-validation
description: "Validate local or provider tabular data and OPSI dataset or resource metadata. Use to find integrity issues, warnings, and remediation recommendations."
---

# opsi-validation

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Validate data content or normalized metadata and explain actionable issues. Generated for `opsi` 0.2.0.

## Workflow

- Validate downloaded content before analysis or conversion.

## Commands

### `validate`

Validate local data, provider resources, or metadata.

```sh
opsi validate <input> [options]
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

- [opsi-resources](../opsi-resources/SKILL.md)
- [opsi-download](../opsi-download/SKILL.md)
- [opsi-analysis](../opsi-analysis/SKILL.md)
