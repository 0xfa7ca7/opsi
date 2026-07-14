# OPSI CLI

`opsi` is a deterministic, open-source Node.js 24 CLI and TypeScript SDK for discovering, downloading, validating, querying, and converting Slovenian public data. It contains no AI features and sends no telemetry.

## Install

Supported release targets are Linux x64 with glibc, macOS arm64, and Windows x64. Install Node.js 24 and then:

```sh
npm install --global opsi
opsi doctor --offline
```

DuckDB is an optional native dependency so catalogue-only commands still install on other targets; data/query commands report `DUCKDB_UNAVAILABLE` when no supported binding exists. See [installation](docs/installation.md) and [security](docs/security.md).

## Quick start

```sh
opsi search promet --json --limit 5
opsi dataset list --json
opsi dataset list --refresh --json
opsi dataset list --live --json
opsi dataset show DATASET_ID
opsi download opsi:resource:RESOURCE_ID --output ./data
opsi validate ./data.csv --json
opsi query ./data.csv --sql "select * from data limit 10" --json
opsi convert ./data.csv --to parquet --output ./data.parquet
opsi provenance verify ./data.parquet --json
```

`opsi dataset list` is fast by default because it reads a compact, centrally published
catalogue snapshot. Accepted snapshots are always no more than 24 hours old according to their
generation time, and snapshot output supports the fields `id`, `title`, and `name`. Use
`--refresh` to check the published snapshot or the explicit, slower `--live` escape hatch to
page through OPSI directly. There is no silent live fallback. In offline mode, listing succeeds
only from a valid fresh local snapshot cache; a missing, invalid, or stale cache fails without a
network request.

Run `opsi --help` or read the complete [command reference](docs/commands.md). Library users import `OpsiClient` and public domain types from `opsi/sdk`.

The static catalogue service depends on GitHub Pages and its scheduled GitHub Actions
publisher; neither is presented as a hard uptime SLA. Maintainers can use the
[catalogue service operations guide](docs/catalogue-service.md) for enablement, failure
investigation, and public verification.

## Policies

OPSI CLI is MIT licensed. Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).
