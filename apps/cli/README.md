# opsi

`opsi` is the production Node.js 24 CLI and TypeScript SDK for Slovenian public data. It provides catalogue search, normalized metadata, secure downloads, resilient delimited/ZIP/XML access, read-only WFS workflows, bounded previews and validation, conversion, sandboxed DuckDB queries, provenance, diagnostics, and shell completion. Machine-readable output, stable errors, and bounded operations make it suitable for interactive use, automation, and coding agents.

Install the complete Agent Skills repertoire globally into automatically detected agent hosts with `opsi agent setup`. Use `--yes` for unattended detected-host setup, `--agent <ids...>` for explicit hosts, `--all` for every globally installable profile, or `--dry-run` to preview the plan. An empty detection result fails safely instead of expanding `--yes` to every profile. Setup installs durable copies because its generated source is temporary. Generate the same skills without installing them with `opsi generate-skills` or choose a target with `--output-dir`. The main orchestrator, shared execution rules, and complete domain repertoire are indexed at `https://github.com/0xfa7ca7/opsi/blob/main/docs/skills.md`.

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
