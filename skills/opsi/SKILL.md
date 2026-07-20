---
name: opsi
description: "Route Slovenian public-data requests to the smallest relevant OPSI CLI skill. Use for discovering, inspecting, downloading, validating, querying, converting, or managing data from the Slovenian OPSI portal."
---

# OPSI orchestrator

Use this skill as the main entry point for Slovenian public-data work with the `opsi` CLI. Generated for `opsi` 0.2.0.

## Route requests

1. Read [opsi-shared](../opsi-shared/SKILL.md).
2. Classify the request and load the smallest relevant skill from this table.
3. Load more than one domain skill only when the workflow crosses domains.
4. Execute the documented `opsi` commands and summarize structured results.

| Intent | Skill |
| --- | --- |
| Find datasets and inspect their normalized metadata and tabular schemas. | [opsi-catalogue](../opsi-catalogue/SKILL.md) |
| Inspect a resource safely without committing to a full data workflow. | [opsi-resources](../opsi-resources/SKILL.md) |
| Download selected provider resources through the CLI's bounded secure downloader. | [opsi-download](../opsi-download/SKILL.md) |
| Validate data content or normalized metadata and explain actionable issues. | [opsi-validation](../opsi-validation/SKILL.md) |
| Analyze tabular inputs with bounded read-only SQL or convert supported formats. | [opsi-analysis](../opsi-analysis/SKILL.md) |
| Inspect recorded lineage and verify an artifact against its digest. | [opsi-provenance](../opsi-provenance/SKILL.md) |
| Manage local cache and validated non-secret CLI configuration. | [opsi-local-state](../opsi-local-state/SKILL.md) |
| Generate installable Agent Skills, diagnose the CLI environment, and expose providers and shell integration. | [opsi-diagnostics](../opsi-diagnostics/SKILL.md) |

Do not pass `/opsi`, `@opsi`, or `$opsi` to the shell. Those are host-specific ways to invoke this skill; shell commands begin with `opsi`.

## Common workflows

- Discover data, inspect its metadata, then choose a resource.
- Download or preview selected data before validating, querying, or converting it.
- Use provenance to verify any artifact produced by a download, conversion, or query export.

## Routing rules

- Prefer the narrowest skill that fully handles the request.
- Inspect `opsi <command> --help` if runtime syntax might differ from the generated reference.
- Keep identifiers returned by the CLI exact; do not invent dataset or resource IDs.
- Return a concise result grounded in stdout, stderr, and the process exit status.
