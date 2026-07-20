---
name: opsi-download
description: "Download Slovenian OPSI dataset or resource content securely. Use for destination selection, batch downloads, overwrite handling, and downloaded artifact provenance."
---

# opsi-download

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Download selected provider resources through the CLI's bounded secure downloader. Generated for `opsi` 0.1.0.

## Workflow

- Resolve a canonical resource or dataset reference, then download it.

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
| `--dataset` | no | — | `resource` | treat bare identifiers as datasets |
| `--resource` | no | — | `dataset` | treat bare identifiers as resources |
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
