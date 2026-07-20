---
name: opsi-diagnostics
description: "Inspect OPSI providers, diagnose an installation, or generate shell completion. Use for setup, troubleshooting, capability discovery, and CLI integration."
---

# opsi-diagnostics

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Diagnose the CLI environment and expose supported providers and shell integration. Generated for `opsi` 0.1.0.

## Workflow

- Run offline diagnostics first when network access is unavailable or unwanted.

## Commands

### `providers list`

List registered providers.

```sh
opsi providers list
```


### `doctor`

Run installation and environment diagnostics.

```sh
opsi doctor [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--offline` | no | — | — | skip connectivity checks |


### `completion`

Generate static shell completion.

```sh
opsi completion <shell>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<shell>` | `bash`, `zsh`, `fish` | shell name |


### `generate-skills`

Generate installable Agent Skills for the opsi CLI.

```sh
opsi generate-skills [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--output-dir <path>` | no | path | — | directory that receives generated skills |

## Safety

- Do not turn a diagnostic check into a network request when offline was requested.

## Related skills

- [opsi-local-state](../opsi-local-state/SKILL.md)

