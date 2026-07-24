---
name: klopsi-provenance
description: "Use when inspecting or verifying KLOPSI artifact provenance, transformations, or integrity mismatches."
---

# klopsi-provenance

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Inspect recorded lineage and verify an artifact against its digest. Generated for `klopsi` 0.0.2.

## Workflow

- Verify every important downloaded, converted, or query-exported artifact.

## Capability guide

### Inspect recorded lineage

- Use `provenance show` to inspect an artifact's source, retrieval, and transformation record before explaining where it came from.
- Compare the record with the exact local artifact and preserve canonical references returned by KLOPSI.

### Verify artifact integrity

- Use `provenance verify` to recompute and compare the artifact digest after download, conversion, or query export.
- Report a digest mismatch as integrity failure; Do not mutate, replace, or discard the evidence before it is reported.

## Commands

### `provenance show`

Show artifact provenance.

```sh
klopsi provenance show <path>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<path>` | — | artifact path |


### `provenance verify`

Verify artifact provenance.

```sh
klopsi provenance verify <path>
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<path>` | — | artifact path |

## Safety

- Do not dismiss a digest mismatch or mutate evidence before reporting it.

## Related skills

- [klopsi-download](../klopsi-download/SKILL.md)
- [klopsi-analysis](../klopsi-analysis/SKILL.md)
