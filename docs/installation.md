# Installation

The guaranteed targets are Node.js 24 on Linux x64 glibc, macOS arm64, and Windows x64. Windows arm64, Linux musl, and other architectures are not supported until both CI and official DuckDB bindings cover them.

Install the npm package or an exact release tarball with `npm install --global klopsi` or `npm install --global ./klopsi-<version>.tgz`, then run `klopsi --version` and `klopsi doctor --offline`. A package-manager installation may omit the optional native DuckDB binding; catalogue and configuration commands remain usable, while native data commands return `DUCKDB_UNAVAILABLE` with platform remediation. No standalone executable, Homebrew formula, or Scoop package is currently released.

## Prerequisites and supported targets

Use Node.js `>=24.0.0` and npm compatible with that Node release. Required release lanes install/query the exact same tarball on Linux x64 with glibc, macOS 14 arm64, and Windows x64. Linux musl, Windows arm64, macOS x64, and other combinations are unsupported until both an exact-install CI lane and official DuckDB Node Neo support exist. Catalogue-only use may still work elsewhere but is not a support claim.

For a project-local installation run `npm install klopsi` and invoke `npx klopsi`; TypeScript/JavaScript consumers import `{ KlopsiClient, ProviderRegistry }` from `klopsi/sdk`. The SDK declarations intentionally require no private workspace, Zod, or DuckDB type package and compile when optional dependencies are omitted.

## DuckDB dependencies

KLOPSI uses two separate optional DuckDB components:

- `@duckdb/node-api` is the optional npm native binding used to inspect, validate, convert, query, and stage tabular data. npm normally selects its platform package automatically. Omitting optional dependencies keeps catalogue, configuration, completion, and other non-native commands available.
- The external DuckDB CLI provides DuckDB UI and is needed only for `klopsi duckdb open`. It is not installed during `npm install`, startup, `doctor`, or any ordinary data command.

If `duckdb` is already on `PATH`, KLOPSI uses it. Otherwise run `klopsi duckdb install --yes`, or use `klopsi duckdb open <input> --install` to authorize installation and opening in one step. KLOPSI pins the compatible CLI version, downloads only DuckDB's official HTTPS installer, bounds the installer response to 1 MiB, executes it from an owner-only temporary directory without shell interpolation, verifies the resulting executable, and removes the temporary installer. Automatic installation supports Linux x64, macOS arm64, and Windows x64; other targets can install the CLI manually from DuckDB's official installation guide.

## Catalogue availability and offline use

`klopsi dataset list` uses a compact static catalogue by default and supports the snapshot fields
`id`, `title`, and `name`. The first online invocation needs GitHub Pages to serve a valid
publication; subsequent invocations reuse its local cache while the snapshot remains no more
than 24 hours old from `generatedAt`. `--refresh` checks the publication explicitly. The slower
`--live` option bypasses the snapshot and queries OPSI directly; it is an explicit escape hatch,
not an automatic fallback.

For offline operation, populate the cache while online and then run
`klopsi dataset list --offline --json` or set `KLOPSI_OFFLINE=1`. Offline listing fails if that cache
is missing, invalid, or stale, and `--refresh` and `--live` are rejected. GitHub Pages and the
scheduled GitHub Actions publisher are availability dependencies for cold/refresh use, without
a hard uptime SLA. Administrators should follow the
[catalogue service operations guide](catalogue-service.md) to enable Pages, inspect publication
failures, and verify the public artifact.

## Release verification

Download `klopsi-<version>.tgz` and `SHA256SUMS` from the GitHub Release, then run `sha256sum --check SHA256SUMS` (or a platform SHA-256 tool) before `npm install --global ./klopsi-<version>.tgz`. The GitHub asset bytes are the CI-tested canonical tarball; the npm release workflow publishes the identical digest with provenance. Confirm `klopsi --version` matches the tag and `klopsi doctor --json --offline` reports pass checks.

## Troubleshooting

`DUCKDB_UNAVAILABLE` means npm omitted or could not select the `@duckdb/node-api` native binding. Confirm the supported OS/architecture, Node 24, a glibc Linux distribution, and that install did not use `--omit=optional`; remove `node_modules`/lock as appropriate and reinstall. `DUCKDB_CLI_UNAVAILABLE` means the separate external DuckDB CLI is not installed; run `klopsi duckdb install --yes` or add `--install` to `duckdb open`. `DUCKDB_CLI_INSTALL_UNSUPPORTED` identifies a platform without automatic CLI installation, while `DUCKDB_CLI_INSTALL_FAILED` preserves a bounded diagnostic from the official installer. Catalogue/config/completion remain available meanwhile. Permission failures identify cache/temp paths; use `klopsi config path`, verify ownership, or set `KLOPSI_CACHE_DIR`/`KLOPSI_DOWNLOAD_DIR`. Snapshot-unavailable or stale errors should be checked against cache freshness and the [service operations guide](catalogue-service.md); use `--live` only when direct current OPSI access is intended. Proxy/DNS failures appear only in online doctor/catalogue commands. KLOPSI CLI never needs an AI key and sends no telemetry.
