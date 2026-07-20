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
