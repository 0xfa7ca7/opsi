---
name: opsi-provenance
description: "Inspect or verify OPSI artifact provenance. Use to explain an artifact's source and transformations or detect integrity mismatches."
---

# opsi-provenance

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

Inspect recorded lineage and verify an artifact against its digest. Generated for `opsi` 0.1.0.

## Workflow

- Verify every important downloaded, converted, or query-exported artifact.

## Commands

### `provenance show`

Show artifact provenance.

```sh
opsi provenance show <path>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<path>` | — | artifact path |


### `provenance verify`

Verify artifact provenance.

```sh
opsi provenance verify <path>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<path>` | — | artifact path |

## Safety

- Do not dismiss a digest mismatch or mutate evidence before reporting it.

## Related skills

- [opsi-download](../opsi-download/SKILL.md)
- [opsi-analysis](../opsi-analysis/SKILL.md)

