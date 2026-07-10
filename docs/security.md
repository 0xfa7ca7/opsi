# Security boundaries

Network fetches require HTTPS and public DNS/IP results, revalidate redirects, limit redirect count/time/bytes, and sanitize filenames. Explicit `--allow-insecure-http` and `--allow-private-network` overrides apply only to that command. Existing files are not replaced without `--force`; atomic publication and checksum provenance detect partial or changed content.

Queries admit one SELECT, WITH…SELECT, or VALUES statement, run in a worker with row/time/memory/thread/cell/output bounds, open the staged database read-only, disable external access and extensions, and terminate on cancellation. Output escapes terminal controls and optionally prefixes formula-like spreadsheet strings. Debug stacks require `--debug` and redact secret headers/values. No telemetry, analytics, AI provider, or hidden AI service exists.
