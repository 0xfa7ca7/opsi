# Security boundaries

Network fetches require HTTPS and public DNS/IP results, revalidate redirects, limit redirect count/time/bytes, and sanitize filenames. OPSI catalogue redirects are restricted to the exact configured HTTPS origin and their intermediate bodies are cancelled. Explicit `--allow-insecure-http` and `--allow-private-network` overrides apply only to download/content commands. Existing files are not replaced without `--force`; atomic publication and checksum provenance detect partial or changed content.

Queries admit one SELECT, WITH…SELECT, or VALUES statement, run in a worker with row/time/memory/thread/cell/output bounds, open the staged database read-only, disable external access and extensions, and terminate on cancellation. Output escapes terminal controls and optionally prefixes formula-like spreadsheet strings. Debug stacks require `--debug` and redact secret headers/values. No telemetry, analytics, AI provider, or hidden AI service exists.

## Threat boundaries

Provider metadata, filenames, URLs, redirects, headers, tabular cells, spreadsheet formulas, SQL, configuration files, cache objects, and provenance sidecars are untrusted. Remote text is sanitized before terminal rendering. Filenames are reduced to safe basenames and destinations remain inside the selected directory. Redirect/DNS checks are repeated to resist rebinding; private, loopback, link-local, multicast, and special-purpose addresses are denied unless the explicit per-command override is present. Plain HTTP is likewise opt-in and recorded in provenance.

Downloads use bounded time/bytes/redirects, exclusive temporary files, hashes, atomic rename/link publication, and cleanup. Existing different files survive unless `--force`. Cache objects are content-addressed, locked, and verified. Provenance redacts URL credentials/query secrets and stores source/final redirect information, retrieval time, digest, size, provider/dataset/resource IDs, transformations, and override flags. Verification recomputes the artifact digest.

## Query and format isolation

SQL policy uses DuckDB statement extraction/preparation, rejects multiple/diagnostic/mutating statements, stages input in an OPSI-owned database, reopens read-only, disables external access and extension auto-install/load, and runs in a killable worker. Limits cover SQL bytes, rows, deadline, 1GB memory, four threads, columns, cells, and output. XLSX shared strings/columns and all preview/export sizes are bounded. Formula-like strings are warned or prefixed by explicit spreadsheet-safe export.

## Overrides, secrets, and reporting

`--allow-insecure-http`, `--allow-private-network`, `--force`, and `--debug` never persist as relaxed defaults. Destructive cache operations require `--yes` in non-TTY or structured-output contexts; interactive human TTY commands may use the explicit `[y/N]` confirmation prompt. Non-TTY processes never prompt or hang for input. `OPSI_API_KEY` is environment-only, and config refuses secret-like keys. Errors omit causes/stacks by default; debug stacks pass terminal sanitation and redaction.

Report vulnerabilities privately through GitHub Security Advisories with affected version/platform, reproduction, and impact. Do not include live credentials or private datasets. Maintainers will coordinate validation, a supported-release fix, regression tests, advisory/CVE where appropriate, and release notes before public disclosure.
