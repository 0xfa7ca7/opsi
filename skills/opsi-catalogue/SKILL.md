---
name: opsi-catalogue
description: "Use when discovering Slovenian public-data or OPSI datasets, metadata, resources, schemas, or public pages."
---

# opsi-catalogue

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Find datasets and inspect their normalized metadata and tabular schemas. Generated for `opsi` 0.0.1.

## Workflow

- Search with a narrow limit and fields, then inspect the selected dataset.
- List dataset resources before selecting one for preview or download.

## Capability guide

### Choose catalogue mode

- Use the published snapshot for ordinary discovery; use `dataset list --refresh` only when a fresh snapshot is needed.
- Use `dataset list --live` for an explicit paginated live traversal, and do not combine it with `--refresh`.

### Refine discovery

- Start with `search` using `--limit`, `--fields`, and only the relevant organization, tag, format, license, date, or sort filters.
- Use `--all` only when every result page is required; otherwise retain a bounded page and exact IDs returned by the CLI.

### Follow a selected dataset

- Run `dataset show`, then `dataset resources` before choosing a resource; use `dataset schema` when tabular structure determines the choice.
- Use `dataset open` only to view the provider's public page, not as a replacement for structured CLI metadata.

## Commands

### `search`

Search datasets.

```sh
opsi search [text] [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `[text]` | — | full-text search query |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--organization <name>` | no | name | — | filter by organization |
| `--tag <name>` | no | name | — | filter by tag (repeatable) |
| `--format <name>` | no | name | — | filter by resource format (repeatable) |
| `--license <id>` | no | id | — | filter by license |
| `--modified-after <date>` | no | date | — | filter by earliest modification date |
| `--modified-before <date>` | no | date | — | filter by latest modification date |
| `--sort <field:direction>` | no | field:direction | — | sort result (repeatable) |
| `--limit <number>` | no | number | — | maximum results |
| `--offset <number>` | no | number | — | result offset |
| `--all` | no | — | `--limit` | retrieve every result page |


### `dataset list`

List all datasets.

```sh
opsi dataset list [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--refresh` | no | — | `--live` | refresh the published catalogue snapshot |
| `--live` | no | — | `--refresh` | query OPSI directly using paginated requests |


### `dataset show`

Show dataset details.

```sh
opsi dataset show <id>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<id>` | — | dataset identifier |


### `dataset resources`

List resources embedded in a dataset.

```sh
opsi dataset resources <id>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<id>` | — | dataset identifier |


### `dataset schema`

Infer the schema of a dataset's tabular resource.

```sh
opsi dataset schema <id> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<id>` | — | dataset identifier |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--resource <id>` | no | id | — | resource identifier or canonical resource reference |
| `--sheet <name>` | no | name | — | XLSX sheet name |
| `--entry <path>` | no | path | — | ZIP data entry path |
| `--record-path <path>` | no | path | — | XML record element path |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `dataset open`

Open the provider's public dataset page.

```sh
opsi dataset open <id>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<id>` | — | dataset identifier |

## Safety

- Use explicit live catalogue traversal only when the user needs it.

## Related skills

- [opsi-resources](../opsi-resources/SKILL.md)
- [opsi-download](../opsi-download/SKILL.md)
- [opsi-validation](../opsi-validation/SKILL.md)
