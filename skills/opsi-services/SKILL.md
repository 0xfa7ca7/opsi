---
name: opsi-services
description: "Use when Slovenian public data is exposed through WFS and the request needs capabilities, layers, schemas, bounded feature previews, counts, or CSV exports."
---

# opsi-services

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Access WFS feature services through bounded, schema-validated OPSI workflows. Generated for `opsi` 0.2.0.

## Workflow

- Inspect a canonical WFS resource, list layers, then inspect a selected layer schema.
- Preview or count a layer with typed equality filters before exporting bounded rows.

## Capability guide

### Inspect the WFS service and layer

- Keep the exact canonical `opsi:resource:` reference returned by OPSI; run `service inspect`, then `service layers`, then `service schema --layer <name>` before selecting features.
- Use the layer schema to choose a layer and its available fields; do not infer feature bounds or paging support from service inspection metadata.

### Select fields and matching features

- Use a small `service preview` before export; `--property` may repeat or take a comma-separated list to select the fields to return.
- Use `--filter-eq <field=value>` for typed lexical equality: values are coerced as booleans, numbers, or strings, not schema-aware XSD coercion.
- Use `service count` to measure the filtered selection before choosing an export limit.

### Constrain space and pagination

- Use `--bbox <minx,miny,maxx,maxy>` for a spatial extent, and `--crs <name>` must name the coordinate reference system used for the bbox.
- When paging, `--start-index` is zero-based; keep each preview or export bounded with a finite `--limit`.

### Export and verify a bounded result

- After previewing or counting the selection, use `service export` with a finite `--limit`; export output is CSV only.
- Choose a new output path unless the user gives `--force` after explicit overwrite authorization, then run `provenance verify` on an important exported artifact.

## Commands

### `service inspect`

Inspect a read-only WFS service.

```sh
opsi service inspect <resource> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<resource>` | — | canonical WFS resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `service layers`

List WFS feature layers.

```sh
opsi service layers <resource> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<resource>` | — | canonical WFS resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `service schema`

Describe a WFS feature layer.

```sh
opsi service schema <resource> --layer <name> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<resource>` | — | canonical WFS resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--layer <name>` | yes | name | — | feature layer name |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `service preview`

Preview bounded WFS features.

```sh
opsi service preview <resource> --layer <name> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<resource>` | — | canonical WFS resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--layer <name>` | yes | name | — | feature layer name |
| `--limit <rows>` | no | rows | — | maximum preview rows |
| `--start-index <number>` | no | number | — | zero-based feature offset |
| `--property <name>` | no | name | — | selected field (repeatable or comma-separated) |
| `--filter-eq <field=value>` | no | field=value | — | typed equality filter (repeatable) |
| `--bbox <minx,miny,maxx,maxy>` | no | minx,miny,maxx,maxy | — | bounded spatial extent |
| `--crs <name>` | no | name | — | bbox coordinate reference system |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `service count`

Count matching WFS features.

```sh
opsi service count <resource> --layer <name> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<resource>` | — | canonical WFS resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--layer <name>` | yes | name | — | feature layer name |
| `--filter-eq <field=value>` | no | field=value | — | typed equality filter (repeatable) |
| `--bbox <minx,miny,maxx,maxy>` | no | minx,miny,maxx,maxy | — | bounded spatial extent |
| `--crs <name>` | no | name | — | bbox coordinate reference system |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `service export`

Export bounded WFS features to CSV.

```sh
opsi service export <resource> --layer <name> --output <path> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<resource>` | — | canonical WFS resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--layer <name>` | yes | name | — | feature layer name |
| `--output <path>` | yes | path | — | destination CSV path |
| `--limit <rows>` | no | rows | — | maximum exported rows |
| `--start-index <number>` | no | number | — | zero-based feature offset |
| `--property <name>` | no | name | — | selected field (repeatable or comma-separated) |
| `--filter-eq <field=value>` | no | field=value | — | typed equality filter (repeatable) |
| `--bbox <minx,miny,maxx,maxy>` | no | minx,miny,maxx,maxy | — | bounded spatial extent |
| `--crs <name>` | no | name | — | bbox coordinate reference system |
| `--force` | no | — | — | replace an existing regular file |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |

## Safety

- Use canonical resource references and bounded limits.
- Never send transaction requests, raw CQL, arbitrary XML filters, or direct HTTP calls.

## Related skills

- [opsi-catalogue](../opsi-catalogue/SKILL.md)
- [opsi-resources](../opsi-resources/SKILL.md)
- [opsi-analysis](../opsi-analysis/SKILL.md)
- [opsi-provenance](../opsi-provenance/SKILL.md)
