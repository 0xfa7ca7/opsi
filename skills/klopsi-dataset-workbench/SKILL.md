---
name: klopsi-dataset-workbench
description: "Use when acquired or computed Slovenian public data should be represented as an explorable database with SQL, profiles, tables, charts, or an Example queries notebook."
---

# klopsi-dataset-workbench

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before executing these commands.

Represent a resolved tabular dataset as the read-only `data` relation in a writable local database workbench. Generated for `klopsi` 0.0.2.

## Workflow

- Inspect or validate the selected input, verify important artifact provenance, then represent it as the `data` relation in a database workbench.
- Offer a dataset-specific `Example queries` notebook for guided exploration when supported UI control is available.
- Use an existing DuckDB CLI when available and install it only after explicit authorization.
- Move reproducible results back through bounded KLOPSI query exports or a durable HTML dashboard workflow.

## Capability guide

### Choose a database workbench

- Use this skill when acquired or computed data should be represented as an explorable database for iterative SQL, profiling, tables, summaries, charts, or guided example queries.
- Do not treat a UI session as the final artifact when the user needs a reproducible export, a self-contained presentation, or a result that another person can open without DuckDB.

### Open the dataset workbench

- Prefer a verified downloaded, converted, WFS-exported, or query-exported local artifact; use `--entry`, `--record-path`, or `--sheet` when the selected ZIP, XML, or XLSX input requires it.
- Run `klopsi duckdb open <input>` and query the workbench table `data`. KLOPSI opens a writable session-local workbench with the staged dataset attached read-only, then removes both invocation-local databases after DuckDB UI exits.
- DuckDB UI is an attached local SQL environment, not the bounded read-only SQL sandbox provided by `klopsi query`; keep untrusted SQL and extensions out of the session.

### Offer an Example queries notebook

- Offer to create a notebook named `Example queries`. If the user accepts and supported UI control is available, create it through DuckDB UI controls with a small dataset-specific set of titled, read-only SQL cells.
- Choose only useful cells: preview and schema orientation, coverage or completeness, latest values or top categories, trends or period-over-period changes, and missing-period, duplicate, or null checks.
- Do not write private DuckDB UI storage tables, and never claim the notebook was created unless the supported UI action succeeded. If UI control is unavailable, present the proposed numbered queries for the user to paste.

### Authorize optional installation

- Use the already installed external DuckDB CLI when available. If it is absent, request explicit authorization before `klopsi duckdb install --yes` or `klopsi duckdb open <input> --install`.
- Do not infer installation consent from a request to inspect data, and do not run the official installer when the user requires offline execution.

### Present the open workbench

- Use this final-response section order: `DuckDB dataset workbench`, `Open workbench`, `Dataset`, `Checks`, `Example queries`, `Sources`.
- Place the local URL immediately under `Open workbench`. Show compact dataset facts such as title, relation, rows, coverage, measures, and columns; then report validation, provenance, and attached read-only status.
- Report the `Example queries` notebook as created, offered, or unavailable and list its numbered query topics. End with source and transformation files plus a note that the writable workbench is session-local.

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
- Create notebooks only through supported UI controls and report their status accurately.
- Do not claim durable provenance for temporary UI state or charts.

## Related skills

- [klopsi-analysis](../klopsi-analysis/SKILL.md)
- [klopsi-static-dashboard](../klopsi-static-dashboard/SKILL.md)
- [klopsi-interactive-dashboard](../klopsi-interactive-dashboard/SKILL.md)
