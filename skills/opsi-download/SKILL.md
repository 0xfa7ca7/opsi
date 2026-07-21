---
name: opsi-download
description: "Use when securely downloading an OPSI dataset or resource and choosing a destination or overwrite handling."
---

# opsi-download

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Download selected provider resources through the CLI's bounded secure downloader. Generated for `opsi` 0.0.1.

## Workflow

- Resolve a canonical resource or dataset reference, then download it.

## Capability guide

### Resolve download targets

- Pass canonical resource references when available; use `--dataset` or `--resource` to disambiguate bare identifiers.
- Inspect a selected resource first when its format or access method is uncertain.

### Choose a destination

- For a batch, `--destination` or `--output` must name an existing directory; a file destination is valid for one resource only.
- Otherwise use the configured download directory; do not use `--force` to replace an existing artifact unless that exact overwrite is authorized, and verify the existing artifact first when it matters.

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
| `--destination <path>` | no | path | — | destination path (a file for one resource, or an existing directory for a batch) |
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
