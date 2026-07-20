---
name: opsi-resources
description: "Inspect OPSI resource metadata, secure remote headers, or bounded local and provider data previews. Use when evaluating a dataset resource before download or analysis."
---

# opsi-resources

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Inspect a resource safely without committing to a full data workflow. Generated for `opsi` 0.1.0.

## Workflow

- Inspect metadata and headers before downloading an unfamiliar resource.
- Preview a bounded number of rows before validation or analysis.

## Commands

### `resource show`

Show resource details.

```sh
opsi resource show <id>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<id>` | — | resource identifier |


### `resource headers`

Probe resource headers securely.

```sh
opsi resource headers <id> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<id>` | — | resource identifier |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `resource preview`

Preview bounded rows from a local or provider resource.

```sh
opsi resource preview <input> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<input>` | — | local path, local:file reference, resource ID, or canonical resource |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--limit <rows>` | no | rows | — | maximum preview rows |
| `--sheet <name>` | no | name | — | XLSX sheet name |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |

## Safety

- Keep previews bounded and do not weaken network controls implicitly.

## Related skills

- [opsi-catalogue](../opsi-catalogue/SKILL.md)
- [opsi-download](../opsi-download/SKILL.md)
- [opsi-validation](../opsi-validation/SKILL.md)
- [opsi-analysis](../opsi-analysis/SKILL.md)
