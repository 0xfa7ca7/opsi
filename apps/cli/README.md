# opsi

**One CLI for Slovenian public data — built for people, scripts, and agents.**

Search Slovenia's [OPSI](https://podatki.gov.si/) catalogue, inspect and download resources, safely select ZIP/XML data, query read-only WFS services, and analyze tabular data locally with DuckDB. Structured output, bounded operations, and built-in help make `opsi` straightforward to use from a terminal, an automated workflow, or a coding agent.

[![CI](https://github.com/0xfa7ca7/opsi/actions/workflows/ci.yml/badge.svg)](https://github.com/0xfa7ca7/opsi/actions/workflows/ci.yml)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/0xfa7ca7/opsi/blob/main/LICENSE)

> [!IMPORTANT]
> `opsi` is under active development. Expect breaking changes before v1.0.

## Why opsi?

- **One end-to-end workflow.** Discover, inspect, download, validate, query, and convert public data without switching tools.
- **Predictable automation.** Choose JSON, NDJSON, CSV, or TSV output and branch on stable exit categories.
- **Agent-friendly interface.** Use built-in help, machine-readable results, bounded operations, and installable Agent Skills.
- **Safe local analysis.** Downloads are bounded and verified, queries are read-only and sandboxed, and generated artifacts include provenance records.
- **Useful offline.** Reuse cached catalogue metadata and content without accidental network requests.

## Installation

Requires Node.js 24 or later. Supported releases target Linux x64 with glibc, macOS arm64, and Windows x64.

```sh
npm install --global opsi
opsi --version
opsi doctor --offline
```

DuckDB is an optional native dependency. Catalogue, configuration, and completion commands remain available when a compatible binding cannot be installed; native data commands return `DUCKDB_UNAVAILABLE` with remediation guidance.

For project-local use, run `npm install opsi` and invoke the CLI with `npx opsi`. See the [installation guide](https://github.com/0xfa7ca7/opsi/blob/main/docs/installation.md) for release verification and troubleshooting.

## Quick start

Search the catalogue and inspect a dataset:

```sh
opsi search promet --limit 5
opsi dataset show DATASET_ID --json
opsi dataset resources DATASET_ID
```

Download a returned resource, then preview, validate, and query it locally:

```sh
opsi download opsi:resource:RESOURCE_ID --output ./downloads
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

Run `opsi --help` or read the [complete command reference](https://github.com/0xfa7ca7/opsi/blob/main/docs/commands.md) for every command, option, and exit category.

## Command overview

| Goal                          | Command                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| Search the catalogue          | `opsi search [text]`                                        |
| Inspect a dataset             | `opsi dataset show <id>`                                    |
| List dataset resources        | `opsi dataset resources <id>`                               |
| Inspect or preview a resource | `opsi resource show <id>` / `opsi resource preview <input>` |
| Download data                 | `opsi download <ids...>`                                    |
| Validate data or metadata     | `opsi validate <input>`                                     |
| Query tabular data            | `opsi query <input> --sql <statement>`                      |
| Convert formats               | `opsi convert <input> --to <format> --output <path>`        |
| Verify provenance             | `opsi provenance verify <path>`                             |
| Diagnose the installation     | `opsi doctor`                                               |

## Using opsi with agents

Install the complete [Agent Skills repertoire](https://github.com/0xfa7ca7/opsi/blob/main/docs/skills.md) into automatically detected compatible agent hosts:

```sh
opsi agent setup
```

Use `--yes` for unattended detected-host setup, `--agent <ids...>` for explicit hosts, `--all` for every globally installable profile, or `--dry-run` to preview the operation. An empty detection result fails safely instead of expanding `--yes` to every profile. Setup installs durable copies because its generated source is temporary.

To refresh a stale repertoire, preview the exact target with `opsi agent setup --agent <id> --dry-run --json`, then rerun without `--dry-run` after authorization. After a successful exit, confirm that structured output lists only the requested `agents` and the complete `skills` repertoire. Generate the same portable skill tree without installing it with `opsi generate-skills --output-dir <directory>`.

Agents use the same CLI as people and scripts. Prefer structured output and bounded results:

```sh
opsi search promet --fields id,title --json --limit 5
opsi resource preview ./downloads/data.csv --limit 20 --json
```

## TypeScript SDK

The dependency-clean `opsi/sdk` entry point exports `OpsiClient`, `ProviderRegistry`, and public domain types:

```ts
import { OpsiClient, ProviderRegistry, type DataProvider } from "opsi/sdk";

export function createClient(provider: DataProvider): OpsiClient {
  const registry = new ProviderRegistry([provider]);
  return new OpsiClient({ registry, providerId: provider.descriptor.id });
}
```

See [provider development](https://github.com/0xfa7ca7/opsi/blob/main/docs/providers.md), [format development](https://github.com/0xfa7ca7/opsi/blob/main/docs/formats.md), and [architecture](https://github.com/0xfa7ca7/opsi/blob/main/docs/architecture.md) for extension contracts.

## Documentation

- [Command reference](https://github.com/0xfa7ca7/opsi/blob/main/docs/commands.md)
- [Recipes](https://github.com/0xfa7ca7/opsi/blob/main/docs/recipes.md)
- [Configuration](https://github.com/0xfa7ca7/opsi/blob/main/docs/configuration.md)
- [Installation and troubleshooting](https://github.com/0xfa7ca7/opsi/blob/main/docs/installation.md)
- [Security model](https://github.com/0xfa7ca7/opsi/blob/main/docs/security.md)
- [Agent Skills](https://github.com/0xfa7ca7/opsi/blob/main/docs/skills.md)

## License

[MIT](https://github.com/0xfa7ca7/opsi/blob/main/LICENSE)
