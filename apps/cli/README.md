# opsi

`opsi` is the production Node.js 24 CLI and TypeScript SDK for Slovenian public data. It provides catalogue search, normalized dataset/resource metadata, secure downloads and cache reuse, bounded previews and validation, format conversion, sandboxed DuckDB queries, provenance, diagnostics, and static shell completion. Machine-readable output, stable errors, and bounded operations make it suitable for interactive use, automation, and coding agents.

Supported release targets are Linux x64 glibc, macOS arm64, and Windows x64. Install with `npm install --global opsi`, then run `opsi --version` and `opsi doctor --offline --json`. DuckDB is optional so catalogue/config/completion commands still start when a native binding cannot install; native operations return typed `DUCKDB_UNAVAILABLE` remediation.

```sh
opsi search promet --json --limit 5
opsi dataset show DATASET_ID --json
opsi download opsi:resource:RESOURCE_ID --output ./downloads
opsi validate ./downloads/data.csv --json
opsi query ./downloads/data.csv --sql "select * from data limit 10" --json
opsi convert ./downloads/data.csv --to parquet --output ./data.parquet
opsi provenance verify ./data.parquet --json
```

Import the dependency-clean public SDK with `import { OpsiClient, ProviderRegistry } from "opsi/sdk"`. Full command, configuration, provider/format extension, architecture, installation, security, recipe, and release references are maintained in the repository at `https://github.com/0xfa7ca7/opsi/tree/main/docs`.
