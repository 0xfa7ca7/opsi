# OPSI Agent Skills

Installable Agent Skills for using the OPSI CLI from compatible AI agents. Run `opsi agent setup` for automatic host detection and global installation of the complete repertoire. To manage a project-local installation manually, install the repertoire with a compatible Agent Skills installer, or install one focused domain skill and its `opsi-shared` prerequisite.

| Skill | Description |
| --- | --- |
| [opsi](../skills/opsi/SKILL.md) | Route Slovenian public-data requests to the smallest relevant OPSI CLI skill. Use for discovering, inspecting, downloading, validating, querying, converting, or accessing services from the Slovenian OPSI portal. |
| [opsi-shared](../skills/opsi-shared/SKILL.md) | Apply shared OPSI CLI installation, structured-output, offline, safety, and error-handling rules. Load with every OPSI domain skill. |
| [opsi-catalogue](../skills/opsi-catalogue/SKILL.md) | Discover and inspect Slovenian OPSI datasets. Use for catalogue search, dataset listing, dataset metadata, embedded resources, schema inference, or opening a public dataset page. |
| [opsi-resources](../skills/opsi-resources/SKILL.md) | Inspect OPSI resource access capabilities, metadata, secure headers, and bounded local or provider previews. Use when evaluating a dataset resource before download or analysis. |
| [opsi-download](../skills/opsi-download/SKILL.md) | Download Slovenian OPSI dataset or resource content securely. Use for destination selection, batch downloads, overwrite handling, and downloaded artifact provenance. |
| [opsi-validation](../skills/opsi-validation/SKILL.md) | Validate local or provider tabular data and OPSI dataset or resource metadata. Use to find integrity issues, warnings, and remediation recommendations. |
| [opsi-analysis](../skills/opsi-analysis/SKILL.md) | Query or convert bounded data with OPSI CLI. Use for resilient delimited, ZIP-selected, XML, JSON, XLSX, Parquet, and exported query workflows. |
| [opsi-services](../skills/opsi-services/SKILL.md) | Use when Slovenian public data is exposed through WFS and the request needs capabilities, layers, schemas, bounded feature previews, counts, or CSV exports. |
| [opsi-provenance](../skills/opsi-provenance/SKILL.md) | Inspect or verify OPSI artifact provenance. Use to explain an artifact's source and transformations or detect integrity mismatches. |
| [opsi-local-state](../skills/opsi-local-state/SKILL.md) | Inspect or update OPSI CLI cache and non-secret configuration. Use for cache diagnostics, verification, pruning, clearing, or configuration values and paths. |
| [opsi-diagnostics](../skills/opsi-diagnostics/SKILL.md) | Inspect OPSI providers, diagnose an installation, generate shell completion, or generate installable Agent Skills. Use for setup, troubleshooting, capability discovery, CLI integration, and agent setup. |
