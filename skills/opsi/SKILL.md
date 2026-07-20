---
name: opsi
description: "Use when a Slovenian public-data or OPSI request needs the relevant skill selected."
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
| Access WFS feature services through bounded, schema-validated OPSI workflows. | [opsi-services](../opsi-services/SKILL.md) |
| Inspect recorded lineage and verify an artifact against its digest. | [opsi-provenance](../opsi-provenance/SKILL.md) |
| Manage local cache and validated non-secret CLI configuration. | [opsi-local-state](../opsi-local-state/SKILL.md) |
| Generate installable Agent Skills, diagnose the CLI environment, and expose providers and shell integration. | [opsi-diagnostics](../opsi-diagnostics/SKILL.md) |

Do not pass `/opsi`, `@opsi`, or `$opsi` to the shell. Those are host-specific ways to invoke this skill; shell commands begin with `opsi`.

## End-to-end workflows

### Acquire and analyze data

1. Search with a bounded result set, inspect the selected dataset and resource, then preview and validate the chosen input.
2. Download it to a new destination when local processing is needed; then use `--offline` for the local validation, query, conversion, and provenance steps.
3. Keep queries read-only and bounded, authorize any overwrite, and run `provenance verify` for important outputs.

### Inspect and export WFS data

1. Inspect the canonical WFS resource, list its layers, and inspect the selected layer schema.
2. Preview or count a finite selection before exporting a bounded CSV; preserve the CLI's network safeguards and never send WFS transactions.
3. Verify the exported artifact with provenance.

### Refresh an agent installation

1. Run `opsi agent setup --dry-run` to inspect the planned selection and repertoire.
2. With explicit authorization, select the intended host with `--agent <id>` and use `--yes` for non-interactive installation.
3. Confirm the result includes the current repertoire, including `opsi-services`; use `generate-skills` only when a portable skill tree is needed rather than an installation.

## Routing rules

- Prefer the narrowest skill that fully handles the request.
- Inspect `opsi <command> --help` if runtime syntax might differ from the generated reference.
- Keep identifiers returned by the CLI exact; do not invent dataset or resource IDs.
- Return a concise result grounded in stdout, stderr, and the process exit status.
