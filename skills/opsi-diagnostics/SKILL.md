---
name: opsi-diagnostics
description: "Use when diagnosing OPSI, generating shell completion or Agent Skills, or performing agent setup."
---

# opsi-diagnostics

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Generate installable Agent Skills, diagnose the CLI environment, and expose providers and shell integration. Generated for `opsi` 0.2.0.

## Workflow

- Use `opsi agent setup` to detect installed agent hosts and install the complete OPSI skill repertoire globally.
- Setup copies generated skills before removing its temporary source, so completed installations remain durable.
- Use `--dry-run` to inspect the installation plan, or `--agent` when the target host IDs are already known.
- Run offline diagnostics first when network access is unavailable or unwanted.

## Capability guide

### Diagnose the environment without network access

- Run `opsi doctor --offline --json` first when network access is unavailable or unwanted; offline mode skips the connectivity check while retaining local environment, cache, DuckDB, and format checks.
- Run `opsi providers list --offline --json` to record the registered provider inventory without turning diagnosis into a network request.
- Read every failed or skipped check in structured output before changing the environment, configuration, or cache.

### Generate shell completion

- Use `opsi completion <bash|zsh|fish>` to print completion for the selected shell, then follow that shell's normal installation or sourcing workflow.
- Regenerate completion after upgrading OPSI rather than editing generated completion output.

### Generate a portable skill tree

- `generate-skills` writes the complete portable repertoire to its output directory but does not install it into an agent host.
- Use `opsi generate-skills --output-dir ./generated-skills --json` when another workflow needs a portable tree instead of a host installation.

### Preview, install, and refresh agent skills

- Detected hosts are used only for a non-dry-run setup without `--agent` or `--all`; `--agent` selects explicit hosts, `--all` selects every supported host, and `--yes` accepts detected hosts for unattended setup.
- `--dry-run` reports the planned selection and repertoire without installing or detecting hosts. An empty detection result fails safely and never expands `--yes` to every supported host.
- Use this refresh recipe: `opsi doctor --offline --json`; `opsi agent setup --agent codex --dry-run --json`; `opsi agent setup --agent codex --yes --json`.
- `agent setup` installs or refreshes the complete repertoire for selected hosts as durable copies. Rerun `opsi agent setup` to refresh a stale repertoire, then verify in structured setup output that `agents` contains the requested host and `skills` contains the complete repertoire. Do not infer an installed host path or use a guessed filesystem location. `generate-skills` does not install or refresh Codex; use it only for a portable tree.

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
| `--yes` | no | — | — | accept detected agents without prompting |
| `--dry-run` | no | — | — | show the setup plan without making changes |

## Safety

- Do not turn a diagnostic check into a network request when offline was requested.
- In non-interactive use, require `--yes`, `--agent`, or `--all` before installing skills.

## Related skills

- [opsi-local-state](../opsi-local-state/SKILL.md)
