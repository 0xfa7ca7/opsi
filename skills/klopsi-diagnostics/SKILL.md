---
name: klopsi-diagnostics
description: "Use when diagnosing KLOPSI, generating shell completion or Agent Skills, or performing agent setup."
---

# klopsi-diagnostics

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Generate installable Agent Skills, diagnose the CLI environment, and expose providers and shell integration. Generated for `klopsi` 0.0.1.

## Workflow

- Use `klopsi agent setup` to detect installed agent hosts and install the complete KLOPSI skill repertoire globally.
- Setup copies generated skills before removing its temporary source, so completed installations remain durable.
- Use `--dry-run` to inspect the installation plan, or `--agent` when the target host IDs are already known.
- Run offline diagnostics first when network access is unavailable or unwanted.

## Capability guide

### Diagnose the environment without network access

- Run `klopsi doctor --offline --json` first when network access is unavailable or unwanted; offline mode skips the connectivity check while retaining local environment, cache, DuckDB, and format checks.
- Run `klopsi providers list --offline --json` to record the registered provider inventory without turning diagnosis into a network request.
- Read every failed or skipped check in structured output before changing the environment, configuration, or cache.

### Generate shell completion

- Use `klopsi completion <bash|zsh|fish>` to print completion for the selected shell, then follow that shell's normal installation or sourcing workflow.
- Regenerate completion after upgrading KLOPSI rather than editing generated completion output.

### Generate a portable skill tree

- `generate-skills` writes the complete portable repertoire to its output directory but does not install it into an agent host.
- Use `klopsi generate-skills --output-dir ./generated-skills --json` when another workflow needs a portable tree instead of a host installation.

### Preview, install, and refresh agent skills

- Detected hosts are used only for a non-dry-run setup without `--agent` or `--all`; `--agent` selects explicit hosts, `--all` selects every supported host, and `--yes` accepts detected hosts for unattended setup.
- `--dry-run` reports the planned selection and repertoire without installing or detecting hosts. An empty detection result fails safely and never expands `--yes` to every supported host.
- Use this refresh recipe: `klopsi doctor --offline --json`; `klopsi agent setup --agent codex --dry-run --json`; `klopsi agent setup --agent codex --yes --json`.
- `agent setup` installs or refreshes the complete repertoire for selected hosts as durable copies. Rerun `klopsi agent setup` to refresh a stale repertoire, then verify in structured setup output that `agents` contains the requested host and `skills` contains the complete repertoire. Do not infer an installed host path or use a guessed filesystem location. `generate-skills` does not install or refresh Codex; use it only for a portable tree.

## Commands

### `providers list`

List registered providers.

```sh
klopsi providers list
```


### `doctor`

Run installation and environment diagnostics.

```sh
klopsi doctor [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--offline` | no | — | — | skip connectivity checks |


### `completion`

Generate static shell completion.

```sh
klopsi completion <shell>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<shell>` | `bash`, `zsh`, `fish` | shell name |


### `generate-skills`

Generate installable Agent Skills for the klopsi CLI.

```sh
klopsi generate-skills [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--output-dir <path>` | no | path | — | directory that receives generated skills |


### `agent setup`

Install KLOPSI Agent Skills for detected agent hosts.

```sh
klopsi agent setup [options]
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

- [klopsi-local-state](../klopsi-local-state/SKILL.md)
