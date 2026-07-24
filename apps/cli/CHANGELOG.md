# klopsi

## 0.0.2

### Patch Changes

- 08c98cc: Add agent-only static and interactive HTML dashboard skills with self-contained offline templates, bounded presentation contracts, nested skill resources, and a shared artifact verifier.
- f0a5bde: Add `klopsi duckdb open` for representing and exploring acquired or computed tabular data in a writable DuckDB workbench backed by a read-only source attachment, an explicitly authorized optional DuckDB CLI installer, and a broad `klopsi-dataset-workbench` Agent Skill with optional `Example queries` notebook guidance.
- 4d18b1e: Add guided bare-command onboarding and polished, color-aware human output for Agent Skills setup while preserving structured output.

## 0.0.1

### Initial release

- Ship the production CLI and TypeScript SDK for Slovenian public data, including catalogue discovery, secure downloads and caching, previews, validation, conversion, bounded read-only queries, provenance, configuration, diagnostics, shell completion, and WFS access.
- Add resilient support for delimited, JSON, NDJSON, XLSX, Parquet, ZIP, and XML resources with bounded inspection and conversion workflows.
- Use a centrally generated, digest-verified catalogue snapshot by default, with explicit refresh and live traversal modes and no silent fallback.
- Include installable Agent Skills with complete user-focused data workflows, offline skill generation, and automatic agent-host setup through the pinned installer.
- Publish one tested npm tarball through GitHub trusted publishing with provenance, exact-byte cross-platform verification, and immutable GitHub Release assets.
