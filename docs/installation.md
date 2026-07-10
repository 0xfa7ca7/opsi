# Installation

The guaranteed targets are Node.js 24 on Linux x64 glibc, macOS arm64, and Windows x64. Windows arm64, Linux musl, and other architectures are not supported until both CI and official DuckDB bindings cover them.

Install the npm package or an exact release tarball with `npm install --global opsi` or `npm install --global ./opsi-0.1.0.tgz`, then run `opsi --version` and `opsi doctor --offline`. A package-manager installation may omit the optional native DuckDB binding; catalogue and configuration commands remain usable, while native data commands return `DUCKDB_UNAVAILABLE` with platform remediation. No standalone executable, Homebrew formula, or Scoop package is currently released.
