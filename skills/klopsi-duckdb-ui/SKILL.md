---
name: klopsi-duckdb-ui
description: "Use when acquired or computed Slovenian public data should be explored interactively in DuckDB UI with SQL, tables, summaries, or temporary charts."
---

# klopsi-duckdb-ui

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Open a resolved tabular input as the read-only `data` table in DuckDB UI for local exploratory visual analysis. Generated for `klopsi` 0.0.1.

## Workflow

- Inspect or validate the selected input, verify important artifact provenance, then open it in DuckDB UI for an attached exploratory session.
- Use an existing DuckDB CLI when available and install it only after explicit authorization.
- Move reproducible results back through bounded KLOPSI query exports or a durable HTML dashboard workflow.

## Capability guide

### Choose exploratory DuckDB UI

- Use DuckDB UI for a local exploratory session that needs iterative SQL, profiling, tables, summaries, or temporary charts over acquired or computed data.
- Do not treat a UI session as the final artifact when the user needs a reproducible export, a self-contained presentation, or a result that another person can open without DuckDB.

### Open prepared data

- Prefer a verified downloaded, converted, WFS-exported, or query-exported local artifact; use `--entry`, `--record-path`, or `--sheet` when the selected ZIP, XML, or XLSX input requires it.
- Run `klopsi duckdb open <input>` and query the staged table `data`. KLOPSI opens the leased database read-only and removes it after DuckDB UI exits.
- DuckDB UI is an attached local SQL environment, not the bounded read-only SQL sandbox provided by `klopsi query`; keep untrusted SQL and extensions out of the session.

### Authorize optional installation

- Use the already installed external DuckDB CLI when available. If it is absent, request explicit authorization before `klopsi duckdb install --yes` or `klopsi duckdb open <input> --install`.
- Do not infer installation consent from a request to inspect data, and do not run the official installer when the user requires offline execution.

### Preserve reproducible results

- For a reproducible computed artifact, rerun the final bounded SQL through `klopsi query --output <path>` and verify its provenance rather than relying on UI-only state.
- Use `klopsi-static-dashboard` for a concise static HTML board or `klopsi-interactive-dashboard` for a self-contained interactive HTML presentation; those durable workflows are distinct from temporary DuckDB UI charts.

## Commands

### `duckdb open`

Open tabular data in DuckDB UI.

```sh
klopsi duckdb open <input> [options]
```

#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
| `<input>` | — | local path or canonical resource reference |

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--sheet <name>` | no | name | — | XLSX sheet name |
| `--entry <path>` | no | path | — | ZIP data entry path |
| `--record-path <path>` | no | path | — | XML record element path |
| `--install` | no | — | — | install the optional DuckDB CLI when unavailable |
| `--allow-insecure-http` | no | — | — | allow HTTP for this invocation |
| `--allow-private-network` | no | — | — | allow private network addresses for this invocation |


### `duckdb install`

Install the optional DuckDB CLI.

```sh
klopsi duckdb install [options]
```

#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
| `--yes` | no | — | — | authorize the official DuckDB installer |

## Safety

- Install the external DuckDB CLI only after explicit authorization.
- Do not describe DuckDB UI SQL as KLOPSI's bounded query sandbox.
- Do not claim durable provenance for temporary UI state or charts.

## Related skills

- [klopsi-analysis](../klopsi-analysis/SKILL.md)
- [klopsi-static-dashboard](../klopsi-static-dashboard/SKILL.md)
- [klopsi-interactive-dashboard](../klopsi-interactive-dashboard/SKILL.md)
