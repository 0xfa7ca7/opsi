---
name: opsi-local-state
description: "Use when inspecting or changing the OPSI cache or non-secret configuration."
---

# opsi-local-state

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Manage local cache and validated non-secret CLI configuration. Generated for `opsi` 0.0.1.

## Workflow

- Inspect cache state before pruning or clearing it.
- Locate and inspect configuration before changing a value.

## Capability guide

### Distinguish cache tiers from downloads

- The cache holds the catalogue snapshot and cached raw objects alongside rebuildable derived DuckDB stages; `cache list` labels entries as `raw` or `duckdb-stage`.
- Files written by `download` are destination files, not cache entries; preserve them separately when they matter, while a derived DuckDB stage can be rebuilt from its input.

### Inspect before mutating cache state

- Use `cache info`, `cache list`, and `cache verify` before `cache prune` or `cache clear` to understand size, entry kind, and integrity.
- `cache prune` removes unreferenced raw objects and expired or over-budget derived stages; `cache clear` removes the whole cache. Require explicit authorization before either mutation, then use `--yes` only for that authorized operation.

### Inspect validated non-secret configuration

- Use `config path`, `config list`, and `config get <key>` to locate and inspect a value before `config set <key> <value>`; configuration values are validated when written.
- Keep secrets out of configuration: secret-like keys cannot be persisted, so provide credentials through environment variables for the current process instead.

## Commands

### `cache info`

Show cache statistics.

```sh
opsi cache info
```


### `cache list`

List cache entries.

```sh
opsi cache list
```


### `cache clear`

Clear cache entries.

```sh
opsi cache clear [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--yes` | no | — | — | confirm deletion without prompting |


### `cache prune`

Prune unreferenced cache entries.

```sh
opsi cache prune [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--yes` | no | — | — | confirm deletion without prompting |


### `cache verify`

Verify cached content.

```sh
opsi cache verify
```


### `config get`

Get a user configuration value.

```sh
opsi config get <key>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<key>` | — | dotted key |


### `config set`

Set a validated user configuration value.

```sh
opsi config set <key> <value>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<key>` | — | dotted key |
| `<value>` | — | JSON value or string |


### `config list`

List user configuration.

```sh
opsi config list
```


### `config path`

Show configuration paths.

```sh
opsi config path
```

## Safety

- Confirm cache clear or prune unless the exact mutation is already authorized.

## Related skills

- [opsi-diagnostics](../opsi-diagnostics/SKILL.md)
