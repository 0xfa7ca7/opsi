# opsi

**One CLI for Slovenian public data — from discovery to analysis.**

Search Slovenia's [OPSI](https://podatki.gov.si/) catalogue, inspect and download resources, validate common data formats, and query them locally with DuckDB. Built for terminals, scripts, and TypeScript applications.

[![CI](https://github.com/0xfa7ca7/opsi/actions/workflows/ci.yml/badge.svg)](https://github.com/0xfa7ca7/opsi/actions/workflows/ci.yml)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> `opsi` is under active development and has not yet been published to npm. Expect breaking changes before v1.0 and use the [source installation](#install-from-source) for now.

## Contents

- [Why opsi?](#why-opsi)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Command overview](#command-overview)
- [Working with data](#working-with-data)
- [Automation and structured output](#automation-and-structured-output)
- [Offline use](#offline-use)
- [Security and privacy](#security-and-privacy)
- [TypeScript SDK](#typescript-sdk)
- [Documentation](#documentation)
- [Development](#development)

## Why opsi?

- **One end-to-end workflow.** Discover a dataset, inspect its resources, download the data, validate it, query it, and convert it without switching tools.
- **Predictable automation.** Choose JSON, NDJSON, CSV, or TSV output; keep result data on stdout; and branch on stable exit categories.
- **Safe local analysis.** Downloads are bounded and verified, queries are read-only and sandboxed, and generated artifacts include provenance records.
- **Useful offline.** Reuse cached catalogue metadata and content without allowing accidental network requests.
- **Private by default.** No telemetry, analytics key, or AI service is required.

## Installation

### Requirements

- Node.js 24 or later
- Linux x64 with glibc, macOS arm64, or Windows x64 for supported releases

DuckDB is an optional native dependency. Catalogue, configuration, and completion commands remain available when a compatible binding cannot be installed; native data commands return `DUCKDB_UNAVAILABLE` with remediation guidance.

### Install from source

Until the first npm release, build and install the CLI from this repository:

```sh
git clone https://github.com/0xfa7ca7/opsi.git
cd opsi
corepack enable
corepack prepare pnpm@11.11.0 --activate
pnpm install --frozen-lockfile
pnpm build
npm install --global ./apps/cli
```

Confirm the installation:

```sh
opsi --version
opsi doctor --offline
```

After the package is released, the recommended installation will be:

```sh
npm install --global opsi
```

See the [installation guide](docs/installation.md) for supported targets, release verification, and troubleshooting.

## Quick start

Search the catalogue and inspect a dataset:

```sh
opsi search promet --limit 5
opsi dataset show DATASET_ID --json
opsi dataset resources DATASET_ID
```

Replace `DATASET_ID` with an ID returned by `search`, then download one of its resources:

```sh
opsi download opsi:resource:RESOURCE_ID --output ./downloads
```

Replace `RESOURCE_ID` with an ID returned by `dataset resources`. Use the downloaded filename to preview, validate, and query the data:

```sh
opsi resource preview ./downloads/data.csv --limit 10
opsi validate ./downloads/data.csv --json
opsi query ./downloads/data.csv \
  --sql "select * from data limit 10" \
  --json
```

Convert the resource to Parquet and verify its provenance:

```sh
opsi convert ./downloads/data.csv \
  --to parquet \
  --output ./downloads/data.parquet

opsi provenance verify ./downloads/data.parquet --json
```

Run `opsi --help` or read the [complete command reference](docs/commands.md) for every command, option, and exit category.

## Command overview

| Goal                          | Command                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| Search the catalogue          | `opsi search [text]`                                        |
| List datasets quickly         | `opsi dataset list`                                         |
| Inspect a dataset             | `opsi dataset show <id>`                                    |
| List dataset resources        | `opsi dataset resources <id>`                               |
| Inspect or preview a resource | `opsi resource show <id>` / `opsi resource preview <input>` |
| Download data                 | `opsi download <ids...>`                                    |
| Validate data or metadata     | `opsi validate <input>`                                     |
| Query tabular data            | `opsi query <input> --sql <statement>`                      |
| Convert formats               | `opsi convert <input> --to <format> --output <path>`        |
| Verify provenance             | `opsi provenance verify <path>`                             |
| Inspect local state           | `opsi cache info` / `opsi config list`                      |
| Diagnose the installation     | `opsi doctor`                                               |
| Generate shell completion     | `opsi completion <bash\|zsh\|fish>`                         |

`opsi dataset list` reads a compact, centrally published catalogue snapshot by default. Use `--refresh` to check for a current snapshot or `--live` to query OPSI directly. The command never silently falls back to a live query. See the [catalogue service guide](docs/catalogue-service.md) for details.

## Working with data

`opsi` can inspect and validate CSV, TSV, JSON, NDJSON, XLSX, and Parquet files. It can convert between those formats and query them through a bounded local DuckDB worker.

| Capability | Behavior                                                                        |
| ---------- | ------------------------------------------------------------------------------- |
| Preview    | Reads a bounded number of rows from local files or provider resources           |
| Validate   | Reports typed issues and recommendations for data or metadata                   |
| Query      | Accepts one bounded, read-only `SELECT`, `WITH … SELECT`, or `VALUES` statement |
| Convert    | Writes CSV, TSV, JSON, NDJSON, XLSX, or Parquet atomically                      |
| Provenance | Records and verifies the source, transformation, and SHA-256 digest             |

XLSX formulas are treated as data and are never executed. See [format support](docs/formats.md) for detection rules, limits, worksheet handling, and extension guidance.

## Automation and structured output

Human-readable tables are the interactive default. For scripts and pipelines, select `--json`, `--ndjson`, `--csv`, `--tsv`, or `--output-format`:

```sh
opsi search promet --fields id,title --json --limit 5
opsi dataset list --ndjson
NO_COLOR=1 opsi providers list --csv
```

JSON responses use a stable `{ schemaVersion, data, meta, error? }` envelope. Results go to stdout; warnings and diagnostics go to stderr. Stable exit categories let scripts distinguish invalid input, missing data, provider failures, validation errors, query failures, and partial success without parsing messages.

## Offline use

Warm the cache during an online run, then pass `--offline` or set `OPSI_OFFLINE=1`:

```sh
opsi dataset list --refresh --json
opsi dataset list --offline --json
OPSI_OFFLINE=1 opsi resource preview opsi:resource:RESOURCE_ID --json
```

Offline commands never make network requests. Operations that require uncached metadata or content fail with a typed cache-miss error. Catalogue snapshots must remain valid and no more than 24 hours old.

## Security and privacy

`opsi` sends no telemetry and requires no AI or analytics key. Remote content is subject to HTTPS, DNS, redirect, timeout, and download-size controls. Queries run with DuckDB external access and extension loading disabled. Downloads, conversions, and query exports publish atomically and record provenance.

Read the [security model](docs/security.md) and [security policy](SECURITY.md) before enabling network overrides or reporting a vulnerability.

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
