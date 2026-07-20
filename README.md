# opsi

**One CLI for Slovenian public data — built for people, scripts, and agents.**

Search Slovenia's [OPSI](https://podatki.gov.si/) catalogue, inspect and download resources, safely select ZIP/XML data, query read-only WFS services, and analyze tabular data locally with DuckDB. Structured output, bounded operations, and built-in help make `opsi` straightforward to use from a terminal, an automated workflow, or a coding agent.

[![CI](https://github.com/0xfa7ca7/opsi/actions/workflows/ci.yml/badge.svg)](https://github.com/0xfa7ca7/opsi/actions/workflows/ci.yml)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> [!IMPORTANT]
> `opsi` is under active development. Expect breaking changes before v1.0.

## Contents

- [Why opsi?](#why-opsi)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Command overview](#command-overview)
- [Working with data](#working-with-data)
- [Automation and structured output](#automation-and-structured-output)
- [Using opsi with agents](#using-opsi-with-agents)
- [Offline use](#offline-use)
- [Security](#security)
- [TypeScript SDK](#typescript-sdk)
- [Documentation](#documentation)
- [Development](#development)

## Why opsi?

- **One end-to-end workflow.** Discover a dataset, inspect its resources, download the data, validate it, query it, and convert it without switching tools.
- **Predictable automation.** Choose JSON, NDJSON, CSV, or TSV output; keep result data on stdout; and branch on stable exit categories.
- **Agent-friendly interface.** Discover commands with `--help`, request compact machine-readable results with `--json` and `--fields`, and handle failures without parsing human-readable messages.
- **Safe local analysis.** Downloads are bounded and verified, queries are read-only and sandboxed, and generated artifacts include provenance records.
- **Useful offline.** Reuse cached catalogue metadata and content without allowing accidental network requests.
- **Fast repeated queries.** Transparently reuse immutable DuckDB staging databases for unchanged content, with a separate TTL/LRU storage budget.

## Installation

### Requirements

- Node.js 24 or later
- Linux x64 with glibc, macOS arm64, or Windows x64 for supported releases

DuckDB is an optional native dependency. Catalogue, configuration, and completion commands remain available when a compatible binding cannot be installed; native data commands return `DUCKDB_UNAVAILABLE` with remediation guidance.

### Install from npm

Install the supported release globally:

```sh
npm install --global opsi
```

Confirm the installation:

```sh
opsi --version
opsi doctor --offline
```

For project-local use, run `npm install opsi` and invoke the CLI with `npx opsi`.

### Install from source

To build the current source checkout instead:

```sh
git clone https://github.com/0xfa7ca7/opsi.git
cd opsi
corepack enable
corepack prepare pnpm@11.11.0 --activate
pnpm install --frozen-lockfile
pnpm build
npm install --global ./apps/cli
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
| Set up detected AI agents     | `opsi agent setup`                                          |

`opsi dataset list` reads a compact, centrally published catalogue snapshot by default. Use `--refresh` to check for a current snapshot or `--live` to query OPSI directly. The command never silently falls back to a live query. See the [catalogue service guide](docs/catalogue-service.md) for details.

## Working with data

`opsi` can inspect and validate resilient CSV/TSV-style data (UTF-8/UTF-16, comma/tab/semicolon/pipe), JSON, NDJSON, XLSX, Parquet, bounded XML records, and one safely selected data entry inside a ZIP. Use `--entry` for ambiguous archives and `--record-path` for ambiguous XML. Read-only WFS workflows expose layers, schemas, bounded previews, counts, and CSV exports without leaving OPSI.

The first query for a source imports it into a rebuildable DuckDB stage; later queries over identical bytes and the same XLSX sheet reuse that stage. JSON query metadata reports `cache.status` as `miss`, `hit`, or `bypass`. The derived cache defaults to a 10 GB budget and 30-day sliding lifetime, and its entries are visible through `opsi cache info|list|verify|prune|clear`. Derived eviction never removes raw downloads or catalogue data merely to satisfy the DuckDB budget.

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

JSON responses use a stable `{ schemaVersion, data, meta, error? }` envelope. Query metadata includes the transparent DuckDB stage-cache status. Results go to stdout; warnings and diagnostics go to stderr. Stable exit categories let scripts distinguish invalid input, missing data, provider failures, validation errors, query failures, and partial success without parsing messages.

## Using opsi with agents

The repository ships a complete repertoire of [Agent Skills](docs/skills.md): a main `opsi` orchestrator, shared safety guidance, and focused skills for every command area. After installing the CLI, let OPSI detect supported agent hosts and install the complete repertoire globally:

```sh
opsi agent setup
```

Interactive setup asks for confirmation when more than one host is detected. For unattended setup, accept the detected hosts with `--yes`, target explicit installer IDs with `--agent codex claude-code`, or target every globally installable profile with `--all`. If detection finds no host, choose one explicitly with `--agent` or `--all`; `--yes` never expands an empty detection result. Use `--dry-run` to preview the plan. Setup always copies skills durably into agent directories because its generated source is temporary. Setup uses the pinned installer shipped with OPSI, does not invoke `npx`, does not offer unrelated remote skills, and does not create `.agents` or `skills-lock.json` in the current project.

For a project-local installation, use a compatible Agent Skills installer directly:

```sh
npx skills add https://github.com/0xfa7ca7/opsi
```

Or install only a focused skill and its `opsi-shared` prerequisite:

```sh
npx skills add https://github.com/0xfa7ca7/opsi/tree/main/skills/opsi-analysis
npx skills add https://github.com/0xfa7ca7/opsi/tree/main/skills/opsi-shared
```

Compatible agent hosts select `opsi` automatically from your request. Depending on the host, you may also invoke the main orchestrator as `/opsi`, `@opsi`, or `$opsi`; these are agent-host forms, not shell commands. The skills use the installed CLI and do not add a model runtime or provider dependency to `opsi`.

An installed CLI can also generate the same repertoire into a directory without installing it:

```sh
opsi generate-skills
opsi generate-skills --output-dir ~/.agents/skills --json
```

Agents use the same command surface as people and scripts. They should start with `--help`, request structured output, and keep results focused with field and row limits:

```sh
opsi --help
opsi search promet --fields id,title --json --limit 5
opsi dataset show DATASET_ID --json
opsi resource preview ./downloads/data.csv --limit 20 --json
```

For reliable agent workflows:

- Prefer `--json` or `--ndjson` over parsing human-readable tables.
- Use `--fields` and command-specific limits to keep context small and predictable.
- Read results from stdout, diagnostics from stderr, and use the process exit status for control flow.
- Pass `--offline` when the agent must not make network requests.
- Run `opsi <command> --help` to inspect available arguments before constructing a command.

## Offline use

Warm the cache during an online run, then pass `--offline` or set `OPSI_OFFLINE=1`:

```sh
opsi dataset list --refresh --json
opsi dataset list --offline --json
OPSI_OFFLINE=1 opsi resource preview opsi:resource:RESOURCE_ID --json
```

Offline commands never make network requests. Operations that require uncached metadata or content fail with a typed cache-miss error. Catalogue snapshots must remain valid and no more than 24 hours old.

## Security

Remote content is subject to HTTPS, DNS, redirect, timeout, and download-size controls. Queries run with DuckDB external access and extension loading disabled. Downloads, conversions, and query exports publish atomically and record provenance.

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
