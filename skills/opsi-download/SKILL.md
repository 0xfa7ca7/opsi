---
name: opsi-download
description: "Use when securely downloading an OPSI dataset or resource and choosing a destination or overwrite handling."
---

# opsi-download

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Download selected provider resources through the CLI's bounded secure downloader. Generated for `opsi` 0.2.0.

## Workflow

- Resolve a canonical resource or dataset reference, then download it.

## Capability guide

### Resolve download targets

- Pass canonical resource references when available; use `--dataset` or `--resource` to disambiguate bare identifiers.
- Inspect a selected resource first when its format or access method is uncertain.

### Choose a destination

- Use `--destination` or `--output` for one resource; use the configured download directory for a batch.
- Do not use `--force` to replace an existing artifact unless that exact overwrite is authorized; verify the existing artifact first when it matters.

### Handle batch results

- For a batch, report each successful and failed resource separately; exit 8 means Partial success, not complete success.
- Run `provenance verify` for important downloaded artifacts before handing them to later workflow steps.

## Commands

### `download`

Download one or more resources securely.

```sh
opsi download <ids...> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<ids...>` | — | resource identifiers |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--dataset` | no | — | `--resource` | treat bare identifiers as datasets |
| `--resource` | no | — | `--dataset` | treat bare identifiers as resources |
| `--destination <path>` | no | path | — | destination path (one resource only) |
| `--output <path>` | no | path | — | alias for --destination |
| `--force` | no | — | — | replace the requested regular file |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |

## Safety

- Confirm before replacing an existing artifact with --force.

## Related skills

- [opsi-catalogue](../opsi-catalogue/SKILL.md)
- [opsi-resources](../opsi-resources/SKILL.md)
- [opsi-validation](../opsi-validation/SKILL.md)
- [opsi-provenance](../opsi-provenance/SKILL.md)
