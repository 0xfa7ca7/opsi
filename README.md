# OPSI CLI

Discover, inspect, download, validate, query, and convert Slovenian public data from the command line.

`opsi` is an open-source Node.js CLI and TypeScript SDK for working with datasets published through Slovenia's OPSI portal. It provides predictable structured output, bounded local data operations, secure downloads, offline cache reuse, and artifact provenance. It contains no AI features and sends no telemetry.

## Highlights

- Search and inspect normalized dataset and resource metadata.
- Download remote resources with HTTPS, redirect, DNS, size, and integrity controls.
- Preview and validate CSV, TSV, JSON, NDJSON, XLSX, and Parquet files.
- Run bounded, read-only DuckDB queries against local or provider data.
- Convert tabular data and verify generated provenance records.
- Use stable JSON, NDJSON, CSV, or TSV output in scripts and pipelines.
- Reuse cached metadata and content in offline workflows.

## Requirements

- Node.js 24 or later
- Linux x64 with glibc, macOS arm64, or Windows x64 for supported releases

DuckDB is an optional native dependency. Catalogue, configuration, and completion commands still work when a compatible binding is unavailable; data and query commands then return `DUCKDB_UNAVAILABLE` with remediation guidance.

## Installation

```sh
npm install --global opsi
opsi --version
opsi doctor --offline
```

For a project-local installation, run `npm install opsi` and invoke the CLI with `npx opsi`. See the [installation guide](docs/installation.md) for exact target support, release verification, and troubleshooting.

## Quick start

Search for datasets and inspect a result:

```sh
opsi search promet --limit 5
opsi dataset show DATASET_ID --json
opsi dataset resources DATASET_ID
```

Replace `DATASET_ID` with an ID returned by `search`. Then download a resource using its canonical reference:

```sh
opsi download opsi:resource:RESOURCE_ID --output ./downloads
```

Replace `RESOURCE_ID` with an ID returned by `dataset resources`. Once downloaded, use the actual filename in `./downloads` to inspect and validate the local file:

```sh
opsi resource preview ./downloads/data.csv --limit 10
opsi validate ./downloads/data.csv --json
```

Query it, convert it to Parquet, and verify the generated provenance record:

```sh
opsi query ./downloads/data.csv \
  --sql "select * from data limit 10" \
  --json

opsi convert ./downloads/data.csv \
  --to parquet \
  --output ./downloads/data.parquet

opsi provenance verify ./downloads/data.parquet --json
```

Run `opsi --help` or open the [complete command reference](docs/commands.md) for every option and exit category.

## Common commands

| Goal                          | Command                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| Search the catalogue          | `opsi search [text]`                                        |
| List datasets quickly         | `opsi dataset list`                                         |
| Inspect a dataset             | `opsi dataset show <id>`                                    |
| Inspect or preview a resource | `opsi resource show <id>` / `opsi resource preview <input>` |
| Download data                 | `opsi download <ids...>`                                    |
| Validate data or metadata     | `opsi validate <input>`                                     |
| Query tabular data            | `opsi query <input> --sql <statement>`                      |
| Convert formats               | `opsi convert <input> --to <format> --output <path>`        |
| Verify provenance             | `opsi provenance verify <path>`                             |
| Inspect local state           | `opsi cache info` / `opsi config list`                      |
| Diagnose the installation     | `opsi doctor`                                               |
| Generate shell completion     | `opsi completion <bash\|zsh\|fish>`                         |

`opsi dataset list` uses a compact, centrally published catalogue snapshot by default. Use `--refresh` to check for a current snapshot or `--live` to explicitly query OPSI directly. It never silently falls back to a live query. Learn more in the [installation](docs/installation.md) and [catalogue service](docs/catalogue-service.md) guides.

## Data formats

OPSI CLI can inspect and validate CSV, TSV, JSON, NDJSON, XLSX, and Parquet. It can convert between those formats and query them through a bounded local DuckDB worker. XLSX formulas are treated as data and are never executed.

See [format support](docs/formats.md) for detection rules, limits, worksheet handling, and extension guidance.

## Automation and structured output

Human-readable tables are the interactive default. For scripts, choose `--json`, `--ndjson`, `--csv`, `--tsv`, or `--output-format` and check the process exit status.

```sh
opsi search promet --fields id,title --json --limit 5
opsi dataset list --ndjson
NO_COLOR=1 opsi providers list --csv
```

JSON responses use a stable `{ schemaVersion, data, meta, error? }` envelope. Result data goes to stdout; warnings and diagnostics go to stderr. See the [command reference](docs/commands.md) for exit categories and field projection behavior.

## Offline use

Warm the cache during an online run, then pass `--offline` or set `OPSI_OFFLINE=1`:

```sh
opsi dataset list --refresh --json
opsi dataset list --offline --json
OPSI_OFFLINE=1 opsi resource preview opsi:resource:RESOURCE_ID --json
```

Offline commands never make network requests. Operations that require uncached metadata or content fail with a typed cache-miss error. A cached catalogue snapshot must still be valid and no more than 24 hours old.

## Security and privacy

OPSI CLI sends no telemetry and does not require an AI or analytics key. Remote content is subject to HTTPS, DNS, redirect, timeout, and download-size controls. Queries accept only one bounded, read-only statement and run with DuckDB external access and extension loading disabled. Downloads, conversions, and query exports publish atomically and record provenance.

Read the [security model](docs/security.md) and [security policy](SECURITY.md) before using network overrides or reporting a vulnerability.

## TypeScript SDK

The dependency-clean `opsi/sdk` entry point exports `OpsiClient`, `ProviderRegistry`, and public domain types. Supply a provider that implements the public `DataProvider` contract:

```ts
import { OpsiClient, ProviderRegistry, type DataProvider } from "opsi/sdk";

export function createClient(provider: DataProvider): OpsiClient {
  const registry = new ProviderRegistry([provider]);
  return new OpsiClient({
    registry,
    providerId: provider.descriptor.id,
  });
}
```

Provider and format extension contracts are documented in [provider development](docs/providers.md), [format development](docs/formats.md), and [architecture](docs/architecture.md).

## Documentation

- [Command reference](docs/commands.md)
- [Recipes](docs/recipes.md)
- [Configuration](docs/configuration.md)
- [Installation and troubleshooting](docs/installation.md)
- [Security model](docs/security.md)
- [Architecture](docs/architecture.md)
- [Provider development](docs/providers.md)
- [Format development](docs/formats.md)
- [Release process](docs/releases.md)

## Development

This repository is a pnpm monorepo. Use Node.js 24 and pnpm 11.11.0:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Normal tests use local fixtures and do not contact OPSI.

## License

[MIT](LICENSE)
