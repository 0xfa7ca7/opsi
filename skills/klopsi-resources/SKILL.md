---
name: klopsi-resources
description: "Use when inspecting an OPSI resource, its secure access, headers, or bounded preview before the next step."
---

# klopsi-resources

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Inspect a resource safely without committing to a full data workflow. Generated for `klopsi` 0.0.1.

## Workflow

- Inspect metadata and headers before downloading an unfamiliar resource.
- Preview a bounded number of rows before validation or analysis.

## Capability guide

### Resolve the input

- Use a local path for local data and retain an exact `opsi:resource:` reference for provider data; do not invent either identifier.
- Run `resource inspect` to learn supported access operations before choosing download, validation, WFS, or analysis.

### Select safe access

- Use `resource headers` for a secure provider-header probe and `resource preview` with a small `--limit` for a bounded content check.
- Route a WFS resource to the services skill after inspection; do not replace KLOPSI access controls with direct HTTP.

### Resolve structured content

- Use one `--entry` or `--record-path` reported by resource inspect or the relevant operation's structured error/output; resource inspect can surface ZIP entries and XML record paths.
- Without `--sheet`, XLSX resource preview, validate, or query emits `SHEET_REQUIRED` with `context.sheets` and a suggestion; use one listed sheet.

### Interpret PC-Axis previews

- Dense PC-Axis preview emits deterministic long-form rows: each STUB or HEADING dimension becomes a label column, and a sibling `<dimension>__code` column appears when source CODES exist.
- Treat `__code` values as strings so zero-padded identifiers survive. A source data symbol produces `value: null` plus `value__symbol`; numeric zero remains `value: 0` without a symbol.

## Commands

### `resource show`

Show resource details.

```sh
klopsi resource show <id>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<id>` | — | resource identifier |


### `resource inspect`

Inspect supported access operations for a resource.

```sh
klopsi resource inspect <input> [options]
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
klopsi resource headers <id> [options]
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
klopsi resource preview <input> [options]
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

- [klopsi-catalogue](../klopsi-catalogue/SKILL.md)
- [klopsi-download](../klopsi-download/SKILL.md)
- [klopsi-validation](../klopsi-validation/SKILL.md)
- [klopsi-analysis](../klopsi-analysis/SKILL.md)
