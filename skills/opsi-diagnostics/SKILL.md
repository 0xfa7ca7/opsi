---
name: opsi-diagnostics
description: "Use when diagnosing OPSI, generating shell completion or Agent Skills, or performing agent setup."
---

# opsi-diagnostics

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Generate installable Agent Skills, diagnose the CLI environment, and expose providers and shell integration. Generated for `opsi` 0.2.0.

## Workflow

- Use `opsi agent setup` to detect installed agent hosts and install the complete OPSI skill repertoire globally.
- Use `--dry-run` to inspect the installation plan, or `--agent` when the target host IDs are already known.
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


### `agent setup`

Install OPSI Agent Skills for detected agent hosts.

```sh
opsi agent setup [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--agent <ids...>` | no | ids... | — | target explicit agent installer IDs |
| `--all` | no | — | `--agent` | install for every supported agent |
| `--copy` | no | — | — | copy skills into agent directories (default behavior) |
| `--yes` | no | — | — | accept detected agents without prompting |
| `--dry-run` | no | — | — | show the setup plan without making changes |

## Safety

- Do not turn a diagnostic check into a network request when offline was requested.
- In non-interactive use, require `--yes`, `--agent`, or `--all` before installing skills.

## Related skills

- [opsi-local-state](../opsi-local-state/SKILL.md)
