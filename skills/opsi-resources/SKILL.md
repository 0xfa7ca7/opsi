---
name: opsi-resources
description: "Use when inspecting an OPSI resource, its secure access, headers, or bounded preview before the next step."
---

# opsi-resources

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Inspect a resource safely without committing to a full data workflow. Generated for `opsi` 0.2.0.

## Workflow

- Inspect metadata and headers before downloading an unfamiliar resource.
- Preview a bounded number of rows before validation or analysis.

## Capability guide

### Resolve the input

- Use a local path for local data and retain an exact `opsi:resource:` reference for provider data; do not invent either identifier.
- Run `resource inspect` to learn supported access operations before choosing download, validation, WFS, or analysis.

### Select safe access

- Use `resource headers` for a secure provider-header probe and `resource preview` with a small `--limit` for a bounded content check.
- Route a WFS resource to the services skill after inspection; do not replace OPSI access controls with direct HTTP.

### Resolve structured content

- For an ambiguous ZIP, use the returned `--entry`; for XML use one returned `--record-path`; for XLSX use the returned `--sheet`.
- Do not guess a selector or process every archive entry, XML element, or workbook sheet when inspection reports an ambiguity.

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


### `resource inspect`

Inspect supported access operations for a resource.

```sh
opsi resource inspect <input> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<input>` | — | local path or canonical resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


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
| `--entry <path>` | no | path | — | ZIP data entry path |
| `--record-path <path>` | no | path | — | XML record element path |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |

## Safety

- Keep previews bounded and do not weaken network controls implicitly.

## Related skills

- [opsi-catalogue](../opsi-catalogue/SKILL.md)
- [opsi-download](../opsi-download/SKILL.md)
- [opsi-validation](../opsi-validation/SKILL.md)
- [opsi-analysis](../opsi-analysis/SKILL.md)
