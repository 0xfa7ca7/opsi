# Security policy

Report vulnerabilities privately through GitHub Security Advisories; do not open public issues containing exploit details or secrets. Supported releases receive security fixes.

KLOPSI CLI rejects insecure HTTP and private/special-purpose network destinations by default, bounds redirects, downloads, previews, queries, cells, and outputs, uses read-only sandboxed DuckDB queries, disables extension autoload/install, sanitizes terminal text, warns about spreadsheet formulas, verifies checksums and provenance, and never persists secret-like configuration keys. `--allow-insecure-http`, `--allow-private-network`, `--force`, and `--debug` are explicit per-invocation overrides; debug stacks are redacted. The product has no telemetry and no AI service.
