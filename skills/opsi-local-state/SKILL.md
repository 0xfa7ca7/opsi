---
name: opsi-local-state
description: "Inspect or update OPSI CLI cache and non-secret configuration. Use for cache diagnostics, verification, pruning, clearing, or configuration values and paths."
---

# opsi-local-state

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Manage local cache and validated non-secret CLI configuration. Generated for `opsi` 0.1.0.

## Workflow

- Inspect cache state before pruning or clearing it.
- Locate and inspect configuration before changing a value.

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

