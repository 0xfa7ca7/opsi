# Changelog

## 0.1.0

- Initial complete OPSI CLI: catalogue discovery, secure download/cache, previews, validation, conversion, sandboxed queries, provenance, configuration, diagnostics, completion, and public SDK.
- Made `opsi dataset list` fast and deterministic by default with a centrally generated,
  digest-verified catalogue snapshot that is never accepted beyond 24 hours from generation.
- Added `dataset list --refresh` for the current static publication and explicit `--live` for
  direct OPSI pagination, with no silent fallback between modes.
- Added offline fresh-cache listing, strict versioned schemas and size limits, immutable GitHub
  Pages snapshots, a six-hour publisher workflow, and operator verification guidance.
