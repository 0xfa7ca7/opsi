# Installation

The guaranteed targets are Node.js 24 on Linux x64 glibc, macOS arm64, and Windows x64. Windows arm64, Linux musl, and other architectures are not supported until both CI and official DuckDB bindings cover them.

Install the npm package or an exact release tarball with `npm install --global opsi` or `npm install --global ./opsi-0.1.0.tgz`, then run `opsi --version` and `opsi doctor --offline`. A package-manager installation may omit the optional native DuckDB binding; catalogue and configuration commands remain usable, while native data commands return `DUCKDB_UNAVAILABLE` with platform remediation. No standalone executable, Homebrew formula, or Scoop package is currently released.

## Prerequisites and supported targets

Use Node.js `>=24.0.0` and npm compatible with that Node release. Required release lanes install/query the exact same tarball on Linux x64 with glibc, macOS 14 arm64, and Windows x64. Linux musl, Windows arm64, macOS x64, and other combinations are unsupported until both an exact-install CI lane and official DuckDB Node Neo support exist. Catalogue-only use may still work elsewhere but is not a support claim.

For a project-local installation run `npm install opsi` and invoke `npx opsi`; TypeScript/JavaScript consumers import `{ OpsiClient, ProviderRegistry }` from `opsi/sdk`. The SDK declarations intentionally require no private workspace, Zod, or DuckDB type package and compile when optional dependencies are omitted.

## Release verification

Download `opsi-<version>.tgz` and `SHA256SUMS` from the GitHub Release, then run `sha256sum --check SHA256SUMS` (or a platform SHA-256 tool) before `npm install --global ./opsi-<version>.tgz`. The GitHub asset bytes are the CI-tested canonical tarball; npm trusted publishing publishes the identical digest with provenance. Confirm `opsi --version` matches the tag and `opsi doctor --json --offline` reports pass checks.

## Troubleshooting

`DUCKDB_UNAVAILABLE` means npm omitted or could not select the native binding. Confirm the supported OS/architecture, Node 24, a glibc Linux distribution, and that install did not use `--omit=optional`; remove `node_modules`/lock as appropriate and reinstall. Catalogue/config/completion remain available meanwhile. Permission failures identify cache/temp paths; use `opsi config path`, verify ownership, or set `OPSI_CACHE_DIR`/`OPSI_DOWNLOAD_DIR`. Proxy/DNS failures appear only in online doctor/catalogue commands. OPSI CLI never needs an AI key and sends no telemetry.
