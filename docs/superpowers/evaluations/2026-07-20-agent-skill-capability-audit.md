# OPSI Agent Skill Capability Evaluation

## Method

On 2026-07-20, three fresh, isolated evaluators were each given one public-user
workflow prompt. Each prompt expressly prohibited reading any file below
`skills/` and `apps/cli/src/agent-skills.ts`; evaluators could use `opsi --help`,
subcommand help, and public documentation only. They were also instructed not
to modify files. The evaluator responses below are transcribed verbatim and
scored solely against the stated rubrics.

## Scenario 1: Acquisition and analysis

Prompt:

> Act as a user-facing data agent. Do not read any file under skills/ and do not read apps/cli/src/agent-skills.ts. You may inspect `opsi --help`, subcommand help, and public docs. A user asks: “Find a Slovenian traffic dataset, choose a usable resource even if it is ZIP, XML, or XLSX, inspect it safely, validate it, run a bounded read-only aggregation, export the result, and prove where the output came from. Network access may be unavailable after discovery.” Give the exact OPSI command sequence, decision points for ambiguous ZIP/XML/XLSX inputs, structured-output choices, offline transition, overwrite behavior, failure handling, and final verification. Do not modify files.

Rubric (13 points): bounded search; exact dataset/resource handoff; `resource inspect` or bounded preview; `--entry`; `--record-path`; `--sheet`; validation; read-only bounded query; query export; overwrite authorization; offline behavior; provenance verification; structured stdout/stderr/exit handling.

### Baseline

Evaluator status: completed. Score: **13/13**. It covered every rubric item:
the search is limited to 50; it names the exact dataset and canonical resource;
it uses inspect and five-row previews; it gives safe ZIP, XML, and XLSX
selection rules; it validates before and after download; it bounds the query
and writes a JSON output; it requires explicit overwrite authorization; it
transitions to `--offline`; it shows and verifies provenance; and it specifies
JSON envelope, stderr, and exit-code handling. Incorrect or missing rubric
decisions: none.

Verbatim evaluator response:

> Use the validated traffic-infrastructure dataset **“Seznam parkirišč v Občini Trbovlje”**:
>
> - Dataset: `7627d311-f8a2-43cd-abe6-ca63b7c9d8ba`
> - Usable CSV resource: `opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7`
> - Live bounded preview showed 18 parking sites; validation returned `valid: true` (only a mixed-type-price warning).
> - A bounded aggregation returns 17 free sites/591 spaces/4 EV spaces and 1 paid site/78 spaces/2 EV spaces.
>
> Run from an existing empty working directory such as `./traffic-run`:
>
> ```sh
> opsi --json --fields id,title search "parkirišča" --limit 50
> opsi --json dataset show 7627d311-f8a2-43cd-abe6-ca63b7c9d8ba
> opsi --json dataset resources 7627d311-f8a2-43cd-abe6-ca63b7c9d8ba
> opsi --json resource show f233bc56-b13e-4e15-b257-c65b719732c7
> opsi --json resource headers f233bc56-b13e-4e15-b257-c65b719732c7
> opsi --json resource inspect opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7
> opsi --json resource preview opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7 --limit 5
> opsi --json validate opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7
> ```
>
> ```sh
> opsi --json --max-download-bytes 67108864 --http-timeout-ms 30000 \
>   download opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7 \
>   --output ./traffic-run
> ```
>
> Read the downloaded file path from the download JSON response; call it `$INPUT`. Once acquired, transition to local-only processing—no catalogue/cache/network dependency remains:
>
> ```sh
> opsi --offline --json resource inspect "$INPUT"
> opsi --offline --json resource preview "$INPUT" --limit 5
> opsi --offline --json validate "$INPUT"
>
> opsi --offline --json --query-row-limit 10 --query-timeout-ms 5000 \
>   --duckdb-threads 1 \
>   query "$INPUT" \
>   --sql 'SELECT "Plačljivo" AS placljivo,
>                 COUNT(*) AS parkirisca,
>                 SUM("Število parkirnih mest") AS parkirna_mesta,
>                 SUM("Število mest z električno polnilnico") AS ev_mesta
>          FROM data
>          GROUP BY 1
>          ORDER BY parkirna_mesta DESC, placljivo ASC' \
>   --limit 10 \
>   --output ./traffic-run/parking-summary.json
>
> opsi --offline --json provenance show "$INPUT"
> opsi --offline --json provenance verify "$INPUT"
> opsi --offline --json provenance show ./traffic-run/parking-summary.json
> opsi --offline --json provenance verify ./traffic-run/parking-summary.json
> ```
>
> `provenance show` for the summary proves the canonical resource ID/source URL, retrieved digest, and query transformation; `verify` recomputes the artifact SHA-256. JSON gives the stable `{schemaVersion,data,meta,error?}` envelope; inspect `data`, exit status, and stderr diagnostics—never scrape tables.
>
> For non-CSV formats, inspect first and use the exact safe selection returned:
>
> - ZIP: if more than one supported non-nested data entry exists, repeat preview/validate/query with `--entry '<returned entry path>'`. Do not guess or extract the whole archive.
> - XML: use the inferred record path; if ambiguous, supply exactly one returned `--record-path '/root/record'`. If none is inferable, stop.
> - XLSX: supply the returned `--sheet '<sheet name>'`, even when the workbook prompts for explicit selection. Use `--spreadsheet-safe` only when converting/exporting CSV/XLSX intended for office software; JSON query output needs none.
>
> The current Police “Prometne nesreče” ZIP resource was inspected but its delimited payload fails validation (`INVALID_TABULAR_DATA`), so it should not be selected merely because the metadata says ZIP.
>
> Do not use `--allow-insecure-http` or `--allow-private-network` for these HTTPS public resources. Existing different outputs are preserved by default; only use `--force` after preserving/verifying the current artifact’s provenance. Treat exit `2` as bad options/selection, `3` missing data or provenance, `4` provider/network, `5` unsupported input, `6` validation/integrity, `7` query failure, and `8` partial download. Offline cache misses or stale metadata must fail closed—never retry online implicitly.

## Scenario 2: WFS access

Prompt:

> Act as a user-facing data agent. Do not read any file under skills/ and do not read apps/cli/src/agent-skills.ts. You may inspect `opsi --help`, subcommand help, and public docs. A user provides an OPSI WFS resource reference and asks you to discover its layers, inspect a layer, preview selected properties inside a bounding box, count matching features, and export a bounded filtered CSV without bypassing OPSI security. Give the exact safe command sequence, filter and CRS decisions, pagination or limit behavior, overwrite handling, forbidden fallbacks, and artifact verification. Do not modify files.

Rubric (14 points): canonical reference; inspect; layers; schema; repeatable/comma-separated properties; typed `--filter-eq`; `--bbox`; `--crs`; bounded preview; count; bounded export; overwrite authorization; no raw HTTP/CQL/XML/transaction fallback; provenance verification.

### Baseline

Evaluator status: completed. Score: **13/14**. It retains a canonical resource
reference, inspects capabilities, lists layers and schema, uses selected
properties, binds the bbox to a layer CRS, limits previews and exports, counts
matching features, requires explicit overwrite authorization, rejects all
listed unsafe fallbacks, and verifies provenance. It loses the typed
`--filter-eq` point: the response claims XSD-aware schema coercion, but the CLI
only lexically coerces `true`/`false`, finite numeric strings, and otherwise
strings. Its bounds/paging assertion is also incorrect guidance, although it
does not remove a separate listed rubric point because the response still uses
an explicit finite `--limit` for preview and export.

Post-baseline review correction (the transcript below is intentionally
unchanged):

- Incorrect decision, verbatim: `service capabilities: negotiated version, advertised CRS/bounds/paging`.
- Incorrect decision, verbatim: ``--filter-eq` is repeatable and XSD-aware after schema validation`.
- Accurate model: [`apps/cli/src/public-sdk.d.ts`](../../../apps/cli/src/public-sdk.d.ts)
  defines WFS inspection as version, operations, layers, and output formats;
  its layers carry default/other CRSs, but inspection does not expose bounds or
  paging. [`apps/cli/src/commands/service.ts`](../../../apps/cli/src/commands/service.ts)
  parses equality values lexically as boolean, number, or string rather than
  against the layer's XSD schema. A safe user workflow must select its CRS from
  layer data, keep `--limit` finite, and not infer bounds or paging support
  from `service inspect`; it must describe `--filter-eq` as lexical scalar
  coercion.

The unresolvable `WFS design 135-174` text remains only in the preserved
verbatim evaluator transcript. It is not scoring evidence; the resolvable code
paths above are the scoring basis.

Verbatim evaluator response:

> Use canonical ref throughout and structured output:
>
> ```sh
> R='opsi:resource:<UUID>'
> opsi --json resource inspect "$R"      # optional access descriptor; confirm WFS / allowed actions
> opsi --json service inspect "$R"       # service capabilities: negotiated version, advertised CRS/bounds/paging
> opsi --json service layers "$R"        # select exact layer name L from result
> opsi --json service schema "$R" --layer "$L"  # select exact properties P and typed filter fields
> # Let C be an advertised CRS, and B a box expressed in it as minx,miny,maxx,maxy.
> # Let F be a schema-valid typed equality field=value, Q a positive bounded page/export cap.
> opsi --json service preview "$R" --layer "$L" --property id,name --filter-eq 'municipality=Ljubljana' --bbox 'minx,miny,maxx,maxy' --crs 'EPSG:xxxx' --limit 25 --start-index 0
> opsi --json service count "$R" --layer "$L" --filter-eq 'municipality=Ljubljana' --bbox 'minx,miny,maxx,maxy' --crs 'EPSG:xxxx'
> OUT='./exports/<layer>-bounded.csv' # must be a fresh/nonexistent regular path
> opsi --json service export "$R" --layer "$L" --property id,name --filter-eq 'municipality=Ljubljana' --bbox 'minx,miny,maxx,maxy' --crs 'EPSG:xxxx' --limit 1000 --start-index 0 --output "$OUT"
> opsi --json provenance show "$OUT"
> opsi --json provenance verify "$OUT"
> ```
>
> Use exact layer/properties/CRS returned by capabilities/schema; `--property` accepts comma-separated or repeatable values and preserves requested order. `--filter-eq` is repeatable and XSD-aware after schema validation, so no raw CQL/XML. Bbox is always `minx,miny,maxx,maxy` in the declared advertised CRS; let CLI negotiate WFS 2.0 → 1.1 → 1.0 and map params/axis semantics—don’t construct raw WFS URLs or reorder protocol params yourself.
>
> Limits/paging: always specify positive finite `--limit` (preview/export); `--start-index` is zero-based and must only be used where capabilities/negotiated WFS version says paging is supported. It retrieves that bounded page/segment; don’t assume all pages are fetched. To page, repeat with offset 0,Q,2Q after determining count (and only if paging support advertised); an export must remain one bounded segment. Count is filtered/bboxed and CLI uses `resultType=hits` if supported.
>
> Safety: omit `--allow-insecure-http` and `--allow-private-network`; defaults require HTTPS + public DNS/IP, revalidate redirects, and enforce time/byte limits. Those flags are per-invocation consent only, never persistent—outside scope of “without bypassing security”. No curl/raw HTTP fallback, arbitrary URLs/headers/params, raw CQL/XML, transactions/write operations, or direct WFS requests. WFS is read-only. Existing output is not replaced; choose new output. `--force` only replaces an existing regular file; use it only with explicit overwrite authorization, after preserving/`provenance verify`ing old artifact. Export is atomic and records WFS-query provenance (canonical resource/version/layer/properties/filter/bbox/CRS/paging/format/response digest/retrieval time); `verify` recomputes SHA-256 and exits 6 on mismatch/tampering, while show missing/malformed sidecar exits 3/6.
>
> Source basis: public `docs/commands.md` 75-85, `docs/recipes.md` 43-47, `docs/security.md` 3,9-11,49, and WFS design 135-174.

## Scenario 3: Local state and agent refresh

Prompt:

> Act as a user-facing data agent. Do not read any file under skills/ and do not read apps/cli/src/agent-skills.ts. You may inspect `opsi --help`, subcommand help, and public docs. A user says their installed OPSI skills are stale and omit WFS. They also want to diagnose OPSI offline, inspect raw and derived cache state without deleting data, verify configuration paths and values, preview which agent hosts would receive refreshed skills, then perform an explicitly authorized refresh for Codex only. Give the exact commands, symlink-versus-copy choice, non-interactive safeguards, and post-install verification. Do not modify files.

Rubric (13 points): `doctor --offline`; providers; cache info/list/verify; raw-versus-derived distinction; no prune/clear without authorization; config path/list/get; `agent setup --dry-run`; explicit `--agent codex`; `--yes`; symlink default versus `--copy`; `generate-skills` distinction; refresh/post-install verification.

### Baseline

Evaluator status: completed. Score: **12/13**. It includes the offline health
check and provider listing; read-only cache inspection and verification with a
raw/derived distinction; preserves cache contents; covers configuration paths,
listing, and values; dry-runs host setup; limits the authorized write to Codex
with `--yes`; distinguishes generation from installation; and proposes a
post-install check. It loses the symlink-versus-`--copy` point because it
recommends the unsafe default symlink installation rather than a durable copy.

Post-baseline review correction (the transcript below is intentionally
unchanged):

- Incorrect decision, verbatim: `Keep that default: it is the best choice for a normal local Codex installation and makes future refreshes track the installed repertoire.`
- Accurate behavior: [`apps/cli/src/agent-setup.ts`](../../../apps/cli/src/agent-setup.ts)
  generates skills in an `opsi-agent-setup-` temporary directory, invokes the
  installer without `--copy` by default, then removes that source directory.
  Default symlinks therefore point at deleted generated skills. An explicitly
  authorized durable Codex refresh must use `opsi agent setup --agent codex
  --copy --yes --json` and verify the installed copy.

This is a baseline product capability gap, not a Task 1 implementation item:
`agent setup`'s default cannot safely install generated skills while it removes
their source directory. A later product change must either copy by default or
retain a durable source; until then, user guidance must require `--copy` for a
real installation.

Verbatim evaluator response:

> Use structured output and keep all diagnostics read-only:
>
> ```sh
> opsi doctor --offline --json
> opsi providers list --offline --json
>
> opsi cache info --json
> opsi cache list --json
> opsi cache verify --json
>
> opsi config path --json
> opsi config list --json
> opsi config get offline --json
> opsi config get query.rowLimit --json
> ```
>
> `doctor --offline` intentionally reports connectivity as `skip`; any `fail` or non-zero exit needs remediation. `cache info` separates totals, while `cache list` labels persistent catalogue/download objects as `raw` and rebuildable query stages as `duckdb-stage` (derived), including their expiry timestamps. `cache verify` checks content without mutation. Do not run `cache prune` or `cache clear` without separate authorization.
>
> Preview all detected/supported hosts without writes:
>
> ```sh
> opsi agent setup --all --yes --dry-run --json
> ```
>
> Then restrict the refresh preview to Codex:
>
> ```sh
> opsi agent setup --agent codex --yes --dry-run --json
> ```
>
> The installed CLI’s Codex dry-run lists the complete repertoire, including `opsi-services`, the WFS guide. It identifies the target as `codex`.
>
> After the user explicitly authorizes the refresh, run:
>
> ```sh
> opsi agent setup --agent codex --yes --json
> ```
>
> This refreshes only Codex, is non-interactive because of both explicit host selection and `--yes`, and uses symlinks by default. Keep that default: it is the best choice for a normal local Codex installation and makes future refreshes track the installed repertoire. Use a physical copy only when the Codex host cannot follow symlinks or must be self-contained:
>
> ```sh
> opsi agent setup --agent codex --copy --yes --json
> ```
>
> Verify the successful structured setup output reports `codex` and includes `opsi-services` among the installed skills; re-run the no-write Codex preview to compare the current planned repertoire:
>
> ```sh
> opsi agent setup --agent codex --yes --dry-run --json
> ```
>
> `opsi generate-skills --output-dir …` is different: it writes a portable generated skill tree but does not install or refresh Codex, so it is not needed for this refresh.

## Final comparison

| Scenario | Baseline score | Maximum | Result |
| --- | ---: | ---: | --- |
| Acquisition and analysis | 13 | 13 | Full rubric coverage |
| WFS access | 13 | 14 | Filter typing was overstated; inspection/paging guidance was incorrect |
| Local state and agent refresh | 12 | 13 | Default symlink installation is unsafe after temporary-source cleanup |
| **Total** | **38** | **40** | **Capability gaps observed** |

The baseline exposes two gaps: WFS guidance must not claim that inspection
provides bounds/paging or that filters are XSD-aware, and the agent-refresh
workflow must use `--copy` until the default installation behavior is fixed.
No improved evaluation or refactor loop has run yet, so those sections are
intentionally absent rather than empty.

## Improved evaluation

The same three prompts were rerun with the Task 7 replacement instruction:

> Read skills/opsi/SKILL.md, skills/opsi-shared/SKILL.md, and every domain skill that the orchestrator routes for this request before answering.

The evaluators were fresh, read-only agents. Scores below are factual checks
against the original rubrics, not keyword matches.

### Scenario 1: Acquisition and analysis — Improved

Evaluator: `/root/task_7_improved_evals/evaluate_acquisition` (completed,
read-only). It read `opsi`, `opsi-shared`, `opsi-catalogue`, `opsi-resources`,
`opsi-download`, `opsi-validation`, `opsi-analysis`, and `opsi-provenance`.

Score: **13/13**. The response preserves the exact dataset/resource handoff,
uses a bounded search and preview, validates before download and locally after
acquisition, applies returned ZIP/XML/XLSX selectors, and runs a bounded
read-only query with an output. It explicitly authorizes overwrite, fails
closed offline, verifies provenance, and uses JSON/stdout/stderr/exit-status
handling. Its dataset/resource identifiers match the known usable baseline
resource; every named operation is in the current command surface. Remaining
gaps and unsafe suggestions: none.

Verbatim evaluator response:

> Use the Slovenian traffic-infrastructure dataset “Seznam parkirišč v Občini Trbovlje”:
>
> - Dataset: `7627d311-f8a2-43cd-abe6-ca63b7c9d8ba`
> - Usable CSV resource: `opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7`
>
> Run this from an existing empty directory such as `./traffic-run`:
>
> ```sh
> opsi --json --fields id,title search "parkirišča" --limit 50
> opsi --json dataset show 7627d311-f8a2-43cd-abe6-ca63b7c9d8ba
> opsi --json dataset resources 7627d311-f8a2-43cd-abe6-ca63b7c9d8ba
> opsi --json resource show f233bc56-b13e-4e15-b257-c65b719732c7
> opsi --json resource headers f233bc56-b13e-4e15-b257-c65b719732c7
> opsi --json resource inspect opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7
> opsi --json resource preview opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7 --limit 5
> opsi --json validate opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7
> ```
>
> Download with explicit network bounds. Read the downloaded artifact path from the JSON `data` response and use it as `$INPUT`.
>
> ```sh
> opsi --json --max-download-bytes 67108864 --http-timeout-ms 30000 \
>   download opsi:resource:f233bc56-b13e-4e15-b257-c65b719732c7 \
>   --output ./traffic-run
> ```
>
> After acquisition, operate locally and offline:
>
> ```sh
> opsi --offline --json resource inspect "$INPUT"
> opsi --offline --json resource preview "$INPUT" --limit 5
> opsi --offline --json validate "$INPUT"
>
> opsi --offline --json --query-row-limit 10 --query-timeout-ms 5000 \
>   --duckdb-threads 1 \
>   query "$INPUT" \
>   --sql 'SELECT "Plačljivo" AS placljivo,
>                 COUNT(*) AS parkirisca,
>                 SUM("Število parkirnih mest") AS parkirna_mesta,
>                 SUM("Število mest z električno polnilnico") AS ev_mesta
>          FROM data
>          GROUP BY 1
>          ORDER BY parkirna_mesta DESC, placljivo ASC' \
>   --limit 10 \
>   --output ./traffic-run/parking-summary.json
>
> opsi --offline --json provenance show "$INPUT"
> opsi --offline --json provenance verify "$INPUT"
> opsi --offline --json provenance show ./traffic-run/parking-summary.json
> opsi --offline --json provenance verify ./traffic-run/parking-summary.json
> ```
>
> The query is read-only, has explicit result/time/thread bounds, and should produce the paid/free parking-site totals. `provenance show` for the summary records the canonical resource, source URL, retrieval digest, and query transformation; `provenance verify` recomputes the SHA-256 digest.
>
> For ambiguous formats, inspect first and use only the exact selector returned:
>
> - ZIP: use one supported non-nested entry, e.g. `--entry 'data/rows.csv'`. Do not guess or extract the entire archive.
> - XML: use one inferred record path, e.g. `--record-path '/root/record'`; if no safe record path is reported, stop.
> - XLSX: use one reported sheet, e.g. `--sheet 'Sheet1'`. If the command returns `SHEET_REQUIRED`, use a sheet from `error.context.sheets` and rerun.
> - Pass the chosen selector consistently to preview, validate, query, and convert. Use `--spreadsheet-safe` only for CSV/XLSX exports intended for spreadsheet software.
>
> Use `--json` for each bounded envelope and inspect stdout `data`, stderr diagnostics, and the process exit status; do not parse tables. Use `--ndjson` only when intentionally streaming records. Exit `2` means invalid selection/options, `3` missing input, `4` provider/network failure, `5` unsupported format, `6` validation/integrity failure, `7` query failure, and `8` partial download. Do not retry validation, integrity, or unsupported-format failures unchanged. An offline cache miss must fail closed; never retry online implicitly.
>
> Do not use `--allow-insecure-http` or `--allow-private-network` for public HTTPS resources. Outputs are preserved by default: choose a new path. Use `--force` only after explicit overwrite authorization and after preserving/verifying provenance for the existing artifact.

### Scenario 2: WFS access — Improved

Evaluator: `/root/task_7_improved_evals/evaluate_wfs` (completed, read-only).
It read `opsi`, `opsi-shared`, `opsi-services`, and `opsi-provenance`.

Score: **14/14**. The response keeps the canonical reference, follows the
inspect/layers/schema sequence, selects repeatable properties, accurately
describes lexical boolean/number/string equality coercion, binds bbox to its
declared CRS, and uses finite preview/export limits. It does not infer bounds
or paging support from inspection, counts the same constrained selection,
requires overwrite authorization, rejects raw HTTP/CQL/XML/transactions, and
verifies the export. Remaining gaps and unsafe suggestions: none.

Verbatim evaluator response:

> Use the exact canonical `opsi:resource:` reference supplied by OPSI; do not invent or alter it. First set only values confirmed by subsequent outputs:
>
> ```sh
> RESOURCE='opsi:resource:REPLACE_WITH_THE_PROVIDED_REFERENCE'
> LAYER='REPLACE_WITH_A_NAME_RETURNED_BY_SERVICE_LAYERS'
> PROPERTY_1='REPLACE_WITH_A_FIELD_FROM_SCHEMA'
> PROPERTY_2='REPLACE_WITH_A_FIELD_FROM_SCHEMA'
> FILTER_FIELD='REPLACE_WITH_A_FIELD_FROM_SCHEMA'
> FILTER_VALUE='REPLACE_WITH_THE_TYPED_EQUALITY_VALUE'
> BBOX='minx,miny,maxx,maxy'
> CRS='REPLACE_WITH_THE_CRS_USED_FOR_BBOX'
> EXPORT_LIMIT=500
> OUTPUT='/absolute/path/new-bounded-wfs-export.csv'
> ```
>
> Discover the service and select only names returned by it:
>
> ```sh
> opsi --json service inspect "$RESOURCE"
> opsi --json service layers "$RESOURCE"
> opsi --json service schema "$RESOURCE" --layer "$LAYER"
> ```
>
> Choose properties and the equality filter only from the layer schema. `--filter-eq` is typed lexical equality: values are coerced as boolean, number, or string; it is not an arbitrary CQL or XSD filter. The BBOX must be finite, and `--crs` must name the CRS in which those four BBOX coordinates are expressed—do not assume `EPSG:4326`.
>
> Preview a small first page:
>
> ```sh
> opsi --json service preview "$RESOURCE" \
>   --layer "$LAYER" \
>   --limit 25 \
>   --start-index 0 \
>   --property "$PROPERTY_1" \
>   --property "$PROPERTY_2" \
>   --filter-eq "$FILTER_FIELD=$FILTER_VALUE" \
>   --bbox "$BBOX" \
>   --crs "$CRS"
> ```
>
> Count the same selection before exporting:
>
> ```sh
> opsi --json service count "$RESOURCE" \
>   --layer "$LAYER" \
>   --filter-eq "$FILTER_FIELD=$FILTER_VALUE" \
>   --bbox "$BBOX" \
>   --crs "$CRS"
> ```
>
> After checking the preview and count, export one explicitly bounded CSV batch:
>
> ```sh
> opsi --json service export "$RESOURCE" \
>   --layer "$LAYER" \
>   --output "$OUTPUT" \
>   --limit "$EXPORT_LIMIT" \
>   --start-index 0 \
>   --property "$PROPERTY_1" \
>   --property "$PROPERTY_2" \
>   --filter-eq "$FILTER_FIELD=$FILTER_VALUE" \
>   --bbox "$BBOX" \
>   --crs "$CRS"
>
> opsi provenance verify "$OUTPUT"
> ```
>
> `--start-index` is zero-based. Keep every preview and export finite with `--limit`; count is the full count of the constrained selection. Do not infer paging support from service inspection metadata. If a later page is needed, request it explicitly with a new `--start-index`, the same finite limit, and a different output filename.
>
> Choose a new output path by default. Use `--force` only when the user has explicitly authorized replacing that exact existing regular file. Do not use `curl`, raw HTTP, WFS transactions, arbitrary XML filters, raw CQL, `--allow-insecure-http`, or `--allow-private-network` unless the user explicitly accepts the specific security risk. If provenance verification reports a mismatch, report it as an integrity failure and leave the artifact unchanged.

### Scenario 3: Local state and agent refresh — Improved

Evaluator: `/root/task_7_improved_evals/evaluate_local_refresh` (PASS,
read-only). It read `opsi`, `opsi-shared`, `opsi-local-state`, and
`opsi-diagnostics`.

Initial score: **12/13**. It correctly used offline doctor, read-only cache and
configuration commands, an explicit Codex dry run, `--agent codex --yes`, the
durable internal-copy behavior (with no unsupported public `--copy` flag), and
post-install repertoire verification. It omitted `opsi providers list
--offline --json`, the single missing rubric item. The omission was
guidance-caused: `providers list` was rendered as a command but not stated in
the offline diagnostic workflow. The refactor loop below closes it.

Verbatim initial evaluator response:

> First run the local-only diagnosis:
>
> ```sh
> opsi doctor --offline --json
> ```
>
> Inspect cache state without deleting anything:
>
> ```sh
> opsi cache info --json
> opsi cache list --json
> opsi cache verify --json
> ```
>
> In `cache list` output, distinguish:
>
> - `raw`: cached source objects.
> - `duckdb-stage`: rebuildable derived stages.
>
> Do not run `opsi cache prune` or `opsi cache clear`; both delete cache data.
>
> Check the validated, non-secret configuration location and values:
>
> ```sh
> opsi config path --json
> opsi config list --json
> ```
>
> If you need to confirm an individual key returned by `config list`, use its exact dotted key:
>
> ```sh
> opsi config get '<key-from-config-list>' --json
> ```
>
> Preview the Codex-only refresh plan and its complete skill repertoire:
>
> ```sh
> opsi agent setup --agent codex --dry-run --json
> ```
>
> This is the safe host preview: it explicitly selects only `codex` and reports the planned repertoire, including `opsi-services` for WFS. Do not use `--all`, and do not omit `--agent`; a dry run deliberately does not auto-detect hosts.
>
> With the stated authorization, refresh only Codex non-interactively:
>
> ```sh
> opsi agent setup --agent codex --yes --json
> ```
>
> `--agent codex` prevents installation to other hosts; `--yes` accepts the selected host without an interactive prompt. OPSI installs durable copies of the generated skills, not symlinks—use that default copy-based installation. Do not use `generate-skills` unless you need a separate portable skill tree rather than a Codex installation.
>
> Post-install, inspect the JSON result and confirm that it reports:
>
> - only the `codex` host;
> - successful installation;
> - the installed skill repertoire includes `opsi-services`;
> - the reported installed host path contains every skill listed in that result.

## Refactor loop

Observed miss: the initial local-refresh evaluation omitted the required offline
provider inventory even though it was reading the diagnostics skill.

**RED.** Added the focused generated-content assertion for `` `opsi providers
list --offline --json` `` in `apps/cli/test/agent-skills.test.ts`. Running
`pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts` failed
exactly because the rendered diagnostics skill did not contain that command
(24 passed, 1 failed).

**GREEN.** Added the smallest renderer-registry instruction in
`apps/cli/src/agent-skills.ts`: run `opsi providers list --offline --json` to
record registered providers without turning diagnosis into a network request.
Ran `pnpm build`, regenerated the checked-in `skills/` tree with
`node apps/cli/dist/main.js generate-skills --output-dir skills --json`, and
confirmed the deterministic skill-index content remains current. The focused
unit test then passed (25/25).

Fresh re-evaluator: `/root/task_7_improved_evals/reevaluate_local_refresh`
(PASS, read-only). It read `opsi`, `opsi-shared`, `opsi-local-state`, and
`opsi-diagnostics`.

Final local-refresh score: **13/13**. The response adds the missing provider
listing and otherwise meets the original rubric. Its durable-copy explanation
is factually current: `agent setup` copies through its internal installer
argument and exposes no user-facing `--copy` option. No remaining
guidance-caused gaps or unsafe suggestions remain.

Verbatim fresh evaluator response:

> Run these offline, read-only checks first:
>
> ```sh
> opsi doctor --offline --json
> opsi providers list --offline --json
>
> opsi cache info --offline --json
> opsi cache list --offline --json
> opsi cache verify --offline --json
>
> opsi config path --offline --json
> opsi config list --offline --json
> ```
>
> `cache list` distinguishes cached source material as `raw` from rebuildable derived DuckDB stages as `duckdb-stage`. Downloads written to your chosen download destination are separate from the cache. Do not run `opsi cache prune` or `opsi cache clear`: both delete data and are not needed here.
>
> To inspect one configured value, use a dotted key returned by `config list`, for example:
>
> ```sh
> opsi config get query.rowLimit --offline --json
> ```
>
> Secrets are intentionally not persisted or displayed in configuration; provide them through environment variables only.
>
> Preview the exact Codex-only refresh plan:
>
> ```sh
> opsi agent setup --agent codex --dry-run --json
> ```
>
> Confirm its JSON includes:
>
> - `"agents": ["codex"]`
> - the complete `skills` repertoire
> - `opsi-services` (the WFS skill)
> - `"dryRun": true`
>
> This dry run deliberately does not detect or probe hosts; with `--agent codex`, it proves that Codex is the only requested target. Do not use `--all`, and do not use an unqualified `--yes`, since either can select more hosts than intended.
>
> With your explicit authorization, perform the non-interactive Codex-only refresh:
>
> ```sh
> opsi agent setup --agent codex --yes --json
> ```
>
> `--agent codex` scopes the installation, and `--yes` prevents a prompt. OPSI uses durable copies, not symlinks: its generated source is temporary and removed after setup, so symlinks would be unsafe. `opsi generate-skills` is not a substitute—it only writes a portable tree and does not install it into Codex.
>
> After a successful exit (`0`), confirm the result’s `skills` array includes all eleven skills, particularly `opsi-services`. Then inspect the installed Codex tree:
>
> ```sh
> opsi_skill_root="${CODEX_HOME:-$HOME/.codex}/skills"
>
> find "$opsi_skill_root" -maxdepth 2 -type f -name SKILL.md -print | sort
> test -f "$opsi_skill_root/opsi-services/SKILL.md"
> test ! -L "$opsi_skill_root/opsi-services"
> test ! -L "$opsi_skill_root/opsi-services/SKILL.md"
> ```
>
> The expected repertoire is `opsi`, `opsi-shared`, `opsi-catalogue`, `opsi-resources`, `opsi-download`, `opsi-validation`, `opsi-analysis`, `opsi-services`, `opsi-provenance`, `opsi-local-state`, and `opsi-diagnostics`.

## Final comparison

| Scenario | Baseline score | Improved score | Maximum | Remaining misses | Unsafe suggestions |
| --- | ---: | ---: | ---: | --- | --- |
| Acquisition and analysis | 13 | 13 | 13 | None | None |
| WFS access | 13 | 14 | 14 | None | None |
| Local state and agent refresh | 12 | 13 | 13 | None after the focused provider-inventory refactor | None |
| **Total** | **38** | **40** | **40** | **None** | **None** |

## Refactor correction and closure

The first fresh re-evaluator after the provider-inventory change
(`/root/task_7_improved_evals/reevaluate_local_refresh`) was initially
credited 13/13. A subsequent factual check found two defects in that response:
it invented a Codex skill-tree path even though setup reports only structured
`agents` and `skills`, and a later fresh evaluation omitted the
`generate-skills` distinction. Those are not accepted as correct guidance.

The initial correction re-evaluator
(`/root/task_7_improved_evals/final_reevaluate_local_refresh`, read-only) thus
scores **12/13**: it correctly avoids the path assumption and includes the
provider listing, but omits the `generate-skills`-versus-refresh distinction.

**RED.** Added two focused generated-content requirements in
`apps/cli/test/agent-skills.test.ts`: the refresh guide must say not to infer
an installed host path, and it must say that `generate-skills` does not install
or refresh Codex. Each was observed failing before its source correction.

**GREEN.** The diagnostics refresh guidance now requires verification from the
structured `agents` and `skills` fields, rejects guessed filesystem locations,
states that `generate-skills` only creates a portable tree, and removes it
from the refresh recipe. The checked-in skills were rebuilt and regenerated;
the focused unit suite passed 25/25.

Closure evaluator: `/root/task_7_improved_evals/closure_reevaluate_local_refresh`
(PASS, read-only). It read `opsi`, `opsi-shared`, `opsi-local-state`, and
`opsi-diagnostics`.

Closure score: **13/13**. It includes all required offline diagnostics and
local-state checks, explicitly scopes non-interactive setup to Codex, explains
the durable internal copy without inventing a public `--copy` option,
distinguishes `generate-skills`, and verifies `agents`/`skills` plus exit
status without guessing a host path. No unsupported fallback or unsafe
suggestion remains.

Verbatim closure evaluator response:

> Run these offline, non-mutating checks first:
>
> ```sh
> opsi doctor --offline --json
> opsi providers list --offline --json
>
> opsi cache info --offline --json
> opsi cache list --offline --json
> opsi cache verify --offline --json
>
> opsi config path --offline --json
> opsi config list --offline --json
> ```
>
> `cache list` labels cached source material as `raw` and rebuildable derived DuckDB stages as `duckdb-stage`. Files written by `opsi download` are separate destination files, not cache entries. Do not run `opsi cache prune` or `opsi cache clear`; both delete data and are not needed.
>
> To inspect a specific persisted configuration value, use a dotted key returned by `config list`, for example:
>
> ```sh
> opsi config get query.rowLimit --offline --json
> ```
>
> Secret-like values are intentionally neither persisted nor displayed; provide credentials only through environment variables.
>
> Preview the exact Codex-only refresh:
>
> ```sh
> opsi agent setup --agent codex --dry-run --json
> ```
>
> Confirm the JSON identifies only `codex`, has `dryRun: true`, and lists the complete repertoire including `opsi-services`—the WFS skill. The dry run deliberately does not auto-detect or probe hosts; explicit `--agent codex` proves the only requested target. Do not use `--all` or an unqualified `--yes`.
>
> With the stated authorization, this is the non-interactive Codex-only refresh command:
>
> ```sh
> opsi agent setup --agent codex --yes --json
> ```
>
> `--agent codex` scopes the install to Codex, and `--yes` prevents a prompt. OPSI installs durable copies, not symlinks: generated source files are temporary, so symlinks would be unsafe. There is no public `--copy` choice to add. `opsi generate-skills` only creates a portable skill tree; it does not refresh Codex.
>
> After exit code `0`, verify the structured setup output reports `codex` and includes all eleven skills, especially `opsi-services`:
>
> ```text
> opsi
> opsi-shared
> opsi-catalogue
> opsi-resources
> opsi-download
> opsi-validation
> opsi-analysis
> opsi-services
> opsi-provenance
> opsi-local-state
> opsi-diagnostics
> ```
>
> If setup exits nonzero—or reports partial success—do not treat the refresh as complete; use its structured error details rather than guessing an install path.

## Final comparison (corrected)

| Scenario | Baseline score | Improved score | Maximum | Remaining misses | Unsafe suggestions |
| --- | ---: | ---: | ---: | --- | --- |
| Acquisition and analysis | 13 | 13 | 13 | None | None |
| WFS access | 13 | 14 | 14 | None | None |
| Local state and agent refresh | 12 | 13 | 13 | None after two focused diagnostic/refresh refactors | None |
| **Total** | **38** | **40** | **40** | **None** | **None** |
