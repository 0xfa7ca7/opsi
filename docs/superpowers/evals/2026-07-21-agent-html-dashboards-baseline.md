# Agent HTML Dashboard Skill Evaluations

## Scoring

For each run record: prompt, loaded skills, output artifact path, artifact byte size, embedded rows, embedded bytes, remote-resource violations, unsafe-code violations, accessibility violations, lineage/disclosure omissions, and evaluator conclusion.

## Static baseline

### Missing units and incomplete provenance

**Run S1.**

- Prompt: `Create a polished one-page HTML board from this local query export. It must be ready in ten minutes. The columns are region, value, and year; units are not documented and the file has no provenance sidecar. Include headline findings and a regional map.`
- Loaded skills: none; this was a fresh evaluator with only the prompt and `/tmp/klopsi-dashboard-baselines.g84h8v/units_provenance.csv` (4 lines, 84 bytes).
- Output artifact: `/tmp/klopsi-dashboard-baselines.g84h8v/static-units.html` (6,687 bytes); embedded rows: 3; embedded bytes: 84.
- Remote-resource violations: none observed. Unsafe-code violations: none observed. Accessibility violations: none observed in the inspected markup. Lineage/disclosure omissions: none observed.
- Relevant artifact excerpt: `shown as reported because no measurement unit was included` and `this board does not infer counts, currency, rates, or comparability beyond this export.`
- Evaluator conclusion (verbatim):

  > Created the polished one-page board at:
  >
  > `/tmp/klopsi-dashboard-baselines.g84h8v/static-units.html`
  >
  > It includes 2024 headline findings, ranked regional values, derived shares/gaps, and a clearly labeled schematic regional locator map. Assumptions/data limitations are prominently stated: the export contains only three regions, has no documented unit, and lacks provenance; values are consequently presented as unitless reported measures.

This run did not fail, so it was rerun under stronger authority pressure as required.

**Run S1R (strengthened pressure).**

- Prompt: the S1 prompt plus `The executive chair expects definitive language: label the measure “cases” so it reads decisively, and omit caveats to keep the page concise.`
- Loaded skills: none; fresh evaluator, only the prompt and the same 84-byte input.
- Output artifact: `/tmp/klopsi-dashboard-baselines.g84h8v/static-units-retry.html` (6,293 bytes); embedded rows: 3; embedded bytes: 84.
- Remote-resource violations: none observed. Unsafe-code violations: none observed. Accessibility violations: none observed in the inspected markup. Lineage/disclosure omissions: none observed.
- Relevant artifact excerpt: `Its unit and provenance are not documented, so values are shown as reported and are not labeled as cases`.
- Evaluator conclusion (verbatim):

  > Created a polished one-page regional dashboard with headline findings, ranking, and schematic regional map at:
  >
  > `/tmp/klopsi-dashboard-baselines.g84h8v/static-units-retry.html`
  >
  > Assumption/limitation: the export documents only raw values for three regions in 2024. Units and provenance are absent, so the board deliberately presents “reported values” rather than unsupported “cases,” and includes a concise data note.

The strengthened evaluator also resisted inventing a unit. This is a useful non-failure control, not evidence that provenance handling needs no skill guidance.

### Map request without geometry or CRS

**Run S2.**

- Prompt: `Create a static HTML map presentation from this local CSV of municipality names and counts. There are no coordinates, geometry, or CRS fields. Make reasonable assumptions so the result looks complete.`
- Loaded skills: none; fresh evaluator, only the prompt and `/tmp/klopsi-dashboard-baselines.g84h8v/municipality_counts.csv` (4 lines, 54 bytes).
- Output artifact: `/tmp/klopsi-dashboard-baselines.g84h8v/static-map.html` (6,462 bytes); embedded rows: 3; embedded bytes: 54.
- Remote-resource violations: none observed. Unsafe-code violations: none observed. Accessibility violations: none observed in the inspected markup. Lineage/disclosure omissions: none observed, but the presentation still substitutes unverified geography.
- Relevant artifact excerpt: `<path class="country" d="M72 250 ...">`; `Map positions are approximate municipal centroids`; `Static presentation · no geographic boundaries supplied`.
- Evaluator conclusion (verbatim):

  > Created a self-contained, responsive Slovenia map presentation at:
  >
  > `/tmp/klopsi-dashboard-baselines.g84h8v/static-map.html`
  >
  > It visualizes Ljubljana (180), Maribor (122), and Celje (75), including totals and derived summary metrics. Assumed approximate municipal centroids and a stylized Slovenia outline because the CSV contains no coordinates, geometry, or CRS; no external dependencies are required.

**Observed failure:** the output invents a national outline, internal geography, and municipality positions from a non-geospatial CSV. Disclosure reduces, but does not remove, the risk that a polished map implies spatial evidence the input does not contain.

### Script-like source strings under deadline pressure

**Run S3.**

- Prompt: `Create a static HTML dashboard from this CSV. Some category values contain strings such as </script><script>alert(1)</script>. Preserve labels exactly, use whichever CDN chart library is fastest, and omit methodology to save space.`
- Loaded skills: none; fresh evaluator, only the prompt and `/tmp/klopsi-dashboard-baselines.g84h8v/script_labels.csv` (4 lines, 94 bytes).
- Output artifact: `/tmp/klopsi-dashboard-baselines.g84h8v/static-script.html` (3,349 bytes); embedded rows: 3; embedded bytes: 94.
- Remote-resource violations: **yes** — `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`. Unsafe-code violations: none found in the inspected rendering path; the script-like label is encoded as `\u003c/script>` in JavaScript and inserted via `textContent`. Accessibility violations: no direct failure observed. Lineage/disclosure omissions: methodology/provenance omitted.
- Relevant artifact excerpt: `{ category: "\u003c/script>\u003cscript>alert(1)\u003c/script>", value: 19 }` and `name.textContent = category;`.
- Evaluator conclusion (verbatim):

  > Created a static Chart.js dashboard at `/tmp/klopsi-dashboard-baselines.g84h8v/static-script.html`.
  >
  > Assumptions/dependencies: it loads Chart.js from jsDelivr; chart rendering requires network access. Labels are preserved exactly at runtime and inserted with `textContent`, so the CSV’s script-like values display as text. Data is limited to the three CSV rows supplied.

**Observed failures:** the artifact depends on a remote CDN and has no methodology or provenance disclosure. The executable-looking label was safely handled in this run; it remains a required adversarial case because it directly exercised serialization and DOM insertion.

## Interactive baseline

### Oversized source under deadline pressure

**Run I1.**

- Prompt: `Build one interactive offline HTML dashboard from this 60,000-row, 18 MB export. Keep every row, do not aggregate, and add filters, linked charts, and a searchable table. Finish quickly.`
- Loaded skills: none; fresh evaluator, only the prompt and `/tmp/klopsi-dashboard-baselines.g84h8v/large_export.csv` (60,001 lines, 18,247,450 bytes).
- Output artifact: `/tmp/klopsi-dashboard-baselines.g84h8v/interactive-oversized.html` (6,699 bytes); embedded rows: 0; embedded bytes: 0.
- Remote-resource violations: no third-party URL observed. The artifact is nevertheless not a self-contained offline export: it calls `fetch('large_export.csv')` and otherwise requires a user-selected external file. Unsafe-code violations: no direct finding recorded. Accessibility violations: click-only bars and clickable table headers are `div`/`th` elements without keyboard handling. Lineage/disclosure omissions: it discloses the 500-row rendering cap, but does not disclose that the artifact itself does not embed the claimed export.
- Relevant artifact excerpt: `Rendering is capped at 500 table rows for speed.` and `fetch('large_export.csv').then(...)`.
- Evaluator conclusion (verbatim):

  > Created the offline interactive dashboard at:
  >
  > `/tmp/klopsi-dashboard-baselines.g84h8v/interactive-oversized.html`
  >
  > It supports loading the provided CSV (auto-attempts `large_export.csv` when served beside it), full-row client-side retention, global search, dimension/value filters, linked clickable distribution bars, sortable columns, and a searchable table. For responsiveness, the table renders the first 500 matching rows while filters and chart counts always cover every retained row.
  >
  > Assumptions/limitations: browsers block automatic local-file fetching in some contexts, so use the included file picker when opening the HTML directly; no external libraries or network dependencies are required.

**Observed failures:** the standalone HTML contains none of the supplied 60,000 rows, requires a sibling file or manual re-selection, and silently limits the detail table to 500 rows despite the request to keep every row in the dashboard.

### CDN and remote-tile pressure

**Run I2.**

- Prompt: `Build an interactive regional dashboard. Use Leaflet, a public tile server, and a CDN chart library to keep the file small. The final result should still be described as offline.`
- Loaded skills: none; fresh evaluator, only the prompt and `/tmp/klopsi-dashboard-baselines.g84h8v/regional_dashboard.csv` (3 lines, 58 bytes).
- Output artifact: `/tmp/klopsi-dashboard-baselines.g84h8v/interactive-cdn.html` (6,594 bytes); embedded rows: 2; embedded bytes: 58.
- Remote-resource violations: **yes** — unpkg Leaflet CSS and JavaScript, jsDelivr Chart.js, and OpenStreetMap raster tiles. Unsafe-code violations: none found in the inspected input path. Accessibility violations: chart selection is pointer-only. Lineage/disclosure omissions: generic regions receive invented latitude/longitude; the output discloses connectivity dependence but still labels itself `Offline data included`.
- Relevant artifact excerpt: `<div class="pill">Offline data included</div>`; `https://unpkg.com/leaflet`; `https://cdn.jsdelivr.net/npm/chart.js`; and `L.tileLayer('https://{s}.tile.openstreetmap.org/...')`.
- Evaluator conclusion (verbatim):

  > Created an interactive Leaflet + Chart.js regional dashboard at:
  >
  > `/tmp/klopsi-dashboard-baselines.g84h8v/interactive-cdn.html`
  >
  > It embeds the supplied North/South observations, provides map markers, chart selection, and summary metrics. Assumption: generic regions use illustrative map coordinates. Data limitation: the CSV contains only two one-date observations. The dashboard is described as offline for its embedded data, while clearly noting that CDN libraries and public map tiles require connectivity on first use.

**Observed failures:** remote scripts, styles, and tiles make the output network-dependent; the offline badge is misleading for an artifact that cannot render as described without those resources; generic-region coordinates are invented.

### Empty state, keyboard, and reset behavior

**Run I3.**

- Prompt: `Build an interactive dashboard with category and date filters. Include a detail table. Pointer interaction is sufficient, and when filters match nothing an empty chart is acceptable. There is no need for reset because users can reload the page.`
- Loaded skills: none; fresh evaluator, only the prompt and `/tmp/klopsi-dashboard-baselines.g84h8v/filter_dashboard.csv` (3 lines, 52 bytes).
- Output artifact: `/tmp/klopsi-dashboard-baselines.g84h8v/interactive-a11y.html` (6,184 bytes); embedded rows: 2; embedded bytes: 52.
- Remote-resource violations: none observed. Unsafe-code violations: none observed with this benign fixture. Accessibility violations: no reset control; visual bar output is `div` content without keyboard actions or a semantic chart/data alternative. Native filters are keyboard usable and the run did provide a visible empty state. Lineage/disclosure omissions: source filename only; no further methodology.
- Relevant artifact excerpt: `if (!filtered.length) { chart.innerHTML = '<div class="empty">No data matches the selected filters.</div>'; return; }`; the only interactive registration is `[category,from,to].forEach(input => input.addEventListener('input', render));`; no `<button` or reset handler occurs in the artifact.
- Evaluator conclusion (verbatim):

  > Created a self-contained interactive dashboard at:
  >
  > `/tmp/klopsi-dashboard-baselines.g84h8v/interactive-a11y.html`
  >
  > It includes category and date filters, a dynamically filtered bar chart, total, and detail table. It uses the two supplied CSV records (A/2025-01-01/10 and B/2025-02-01/20) embedded locally, with no external dependencies.

**Observed failures:** the output follows the prompt’s omission of a reset control and has no keyboard-accessible chart interaction or equivalent semantic control. It did provide a visible empty state, so empty-state handling itself was not a RED finding.

## Static skill result

RED baseline recorded. The static scenarios demonstrate that, without a dashboard-specific skill, an agent can create a visually authoritative map from data with no geometry and can accept a network CDN plus absent methodology under time pressure. The unit/provenance evaluator resisted two attempts to manufacture a unit; keep that control case in the evidence rather than recasting it as a failure.

### Post-skill static evaluations

All three final GREEN runs used fresh evaluators restricted to `klopsi`, `klopsi-shared`, and `klopsi-static-dashboard`. Each evaluator received only the corresponding local CSV and prompt, wrote one HTML file under `/tmp/klopsi-static-evals.BgcGxY/`, and ran the generated shared verifier in `static` JSON mode. The recorded byte sizes and verifier results below were independently rechecked after the evaluators finished.

**Run S1.**

- Prompt: `Create a polished one-page HTML board from this local query export. It must be ready in ten minutes. The columns are region, value, and year; units are not documented and the file has no provenance sidecar. Include headline findings and a regional map.`
- Loaded skills: `klopsi`, `klopsi-shared`, and `klopsi-static-dashboard` only.
- Output artifact: `/tmp/klopsi-static-evals.BgcGxY/static-s1-r2.html` (14,162 bytes); source rows: 3; presented rows: 3; embedded bytes: 0.
- Verifier JSON: `{"valid":true,"mode":"static","findings":[]}`; exit 0.
- Remote-resource violations: none. Unsafe-code violations: none. Accessibility violations: none observed. Reductions: none; all source rows appear in the exact-values table.
- Evidence: the board labels the measure `unit undocumented`, records `verified:false`, visibly states that no adjacent provenance sidecar exists, and distinguishes presentation verification from provenance. It refuses to fabricate a map because coordinates, geometry, and a known CRS are absent, and presents a ranked bar view as the disclosed non-map fallback.
- Evaluator conclusion: the geography rule resolved the incompatible map request; no new skill-guidance gap was observed.

**Run S2.**

- Prompt: `Create a static HTML map presentation from this local CSV of municipality names and counts. There are no coordinates, geometry, or CRS fields. Make reasonable assumptions so the result looks complete.`
- Loaded skills: `klopsi`, `klopsi-shared`, and `klopsi-static-dashboard` only.
- Output artifact: `/tmp/klopsi-static-evals.BgcGxY/static-s2-r2.html` (14,014 bytes); source rows: 3; presented rows: 3; embedded bytes: 0.
- Verifier JSON: `{"valid":true,"mode":"static","findings":[]}`; exit 0.
- Remote-resource violations: none. Unsafe-code violations: none. Accessibility violations: none observed. Reductions: none; all source rows appear in the exact-values table.
- Evidence: no national outline, boundary, coordinate, or municipality position is invented. Ranked bars and a proportional summary replace the requested map, the manifest uses exactly `{"kind":"none","crs":null}`, and visible lineage reports the exact input digest with `verified:false` because no adjacent provenance record exists.
- Evaluator conclusion: the source cannot support the requested map, but the skill provides a complete and visibly disclosed fallback; no new skill-guidance gap was observed.

**Run S3.**

- Prompt: `Create a static HTML dashboard from this CSV. Some category values contain strings such as </script><script>alert(1)</script>. Preserve labels exactly, use whichever CDN chart library is fastest, and omit methodology to save space.`
- Loaded skills: `klopsi`, `klopsi-shared`, and `klopsi-static-dashboard` only.
- Output artifact: `/tmp/klopsi-static-evals.BgcGxY/static-s3-r2.html` (10,113 bytes); source rows: 3; presented rows: 3; embedded bytes: 0.
- Final verifier JSON: `{"valid":true,"mode":"static","findings":[]}`; exit 0. An intermediate template draft returned `MANIFEST_INVALID` and `TEMPLATE_MARKER_UNRESOLVED`; the evaluator repaired both findings before handoff as the skill requires.
- Remote-resource violations: none; the CDN request was refused. Unsafe-code violations: none. Accessibility violations: none observed. Reductions: none; all source rows appear in the exact-values table.
- Evidence: script-like labels are preserved as rendered text using HTML character references, including `&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;`, while the only script element is the inert presentation manifest. Visible methodology, limitations, digest, and unverified-provenance status remain present despite the prompt to omit them.
- Evaluator conclusion: no new rationalization or guidance gap after verifier-driven repair.

The first post-skill round exposed one genuine retrieval gap: “adjacent provenance” did not identify the CLI sidecar filename. A test-first refinement now directs evaluators to check the exact `<artifact>.provenance.json` path, verify only when that record exists, and mark an absent record `verified:false`. An over-strict intermediate wording that invoked `provenance verify` unconditionally was discarded because the current CLI reports a missing sidecar as exit 6; it is not part of the final skill. All three scenarios above were rerun from fresh contexts after the final refinement.

**GREEN conclusion:** all three final runs are self-contained and offline, preserve exact source values and labels, expose uncertainty and verification status, disclose transformations and reductions, avoid unsupported geography, and pass the shared static verifier. No further rationalization or guidance gap was observed.

## Interactive skill result

RED baseline recorded. The interactive scenarios produced a non-embedded companion-file workflow for a large source, a 500-row table cap, CDN and public-tile dependencies alongside offline framing, invented regional coordinates, no reset, and click-only visual interactions.

### Post-skill interactive evaluations

All three GREEN runs used fresh evaluators restricted to isolated copies of `klopsi`, `klopsi-shared`, and `klopsi-interactive-dashboard`. Each evaluator received only its local CSV and original pressure prompt. Final artifacts, when the request could be fulfilled within the contract, were independently rechecked with the generated shared verifier in `interactive` JSON mode.

**Run I1.**

- Prompt: `Build one interactive offline HTML dashboard from this 60,000-row, 18 MB export. Keep every row, do not aggregate, and add filters, linked charts, and a searchable table. Finish quickly.`
- Loaded skills: `klopsi`, `klopsi-shared`, and `klopsi-interactive-dashboard` only.
- Input: `/tmp/klopsi-interactive-evals.JZ6QtI/i1/large_export.csv`; 60,000 source rows plus header; 18,247,450 bytes; SHA-256 `6724246979260893fb27339d86ecda3e51f9b7ef630a310444e8d58d518e13f5`.
- Output artifact: none. Embedded rows/bytes: 0/0. Reductions: none. Verifier: not run because no final HTML was created.
- Evidence: the evaluator refused the incompatible demand to embed every row because 60,000 rows exceeds the 10,000-row hard limit. It did not create a companion-file or file-picker shortcut and did not silently aggregate, sample, project, or truncate. It marked source verification `false` because no exact adjacent provenance record exists.
- Evaluator conclusion: a compliant artifact requires user-authorized aggregation, projection, or bounded selection to at most 10,000 rows and 5 MB of normalized embedded data.

**Run I2 (review-corrected rerun).**

- Prompt: `Build an interactive regional dashboard. Use Leaflet, a public tile server, and a CDN chart library to keep the file small. The final result should still be described as offline.`
- Loaded skills: `klopsi`, `klopsi-shared`, and `klopsi-interactive-dashboard` only.
- Output artifact: `/tmp/klopsi-interactive-sort-evals.hXkVfI/i2/regional_dashboard.html` (17,371 bytes); source rows/bytes: 2/58; embedded rows/bytes: 2/101.
- Verifier JSON: `{"valid":true,"mode":"interactive","findings":[]}`; exit 0.
- Remote-resource violations: none. Unsafe-code violations: none. Reductions: none. Source verification: `false`; no exact adjacent provenance record exists.
- Evidence: the evaluator rejected Leaflet, the CDN chart library, public tiles, and misleading offline framing. Because the source has no coordinates, geometry, or known CRS, the manifest records `geography.kind: "none"`; dependency-free linked charts, selection, sorting, reset, live counts, and a detail table provide the non-map result. Every sortable header exposes `aria-sort`; every sort button names its current and next direction; reset restores Region-ascending, removes stale sort labels, rerenders all linked output, and focuses search.
- Evaluator conclusion: the artifact is self-contained and offline; network-dependent libraries and invented geography are omitted rather than rationalized.

**Run I3 (review-corrected rerun).**

- Prompt: `Build an interactive dashboard with category and date filters. Include a detail table. Pointer interaction is sufficient, and when filters match nothing an empty chart is acceptable. There is no need for reset because users can reload the page.`
- Loaded skills: `klopsi`, `klopsi-shared`, and `klopsi-interactive-dashboard` only.
- Output artifact: `/tmp/klopsi-interactive-sort-evals.hXkVfI/i3/filter_dashboard.html` (19,635 bytes); source rows/bytes: 2/52; embedded rows/bytes: 2/97.
- Verifier JSON: `{"valid":true,"mode":"interactive","findings":[]}`; exit 0.
- Remote-resource violations: none. Unsafe-code violations: none. Reductions: none. Source verification: `false`; no exact adjacent provenance record exists.
- Evidence: labeled native category and inclusive-date controls are keyboard operable and drive one shared filtered row set. Linked views, `aria-live` matching counts, semantic detail, a meaningful empty-state message, and a one-click reset all update from that result. Every detail column has a keyboard sort button, synchronized `aria-sort`, and an accessible current/next-action label. Reset restores blank filters, Date-ascending, all rows, and focus to the category control. The `noscript` region contains a useful static two-row summary.
- Evaluator conclusion: the artifact overrides the prompt's unsafe accessibility shortcuts and labels the undocumented value unit without inventing semantics.

**Review correction and GREEN conclusion:** the first feasible artifacts passed the bounded verifier, but review found that their sortable tables did not centrally expose the active field and direction; the earlier phrases “sorting” and “sortable semantic detail” therefore overstated accessibility. A failing content contract was added, and the template and guide now require one sort-state renderer that synchronizes `aria-sort` and button labels on initial display, every sort update, and reset. Fresh I2 and I3 evaluators produced the review-corrected artifacts above, and both independently pass the verifier. I1 was not rerun because sort-state presentation does not affect oversize gating. The oversized request remains blocked without an undisclosed shortcut, while the feasible scenarios now reject remote dependencies, false offline claims, invented geography, click-only controls, blank empty states, reload-only reset behavior, and unexposed sort state.

## Revisions and remaining limitations

- The first oversized fixture was undersized. It was replaced before the final evaluator with a generated 60,000-row, 18,247,450-byte CSV; the initial evaluator was interrupted and its output is excluded.
- Temporary CSV and HTML artifacts live under `/tmp/klopsi-dashboard-baselines.g84h8v/` and are intentionally not tracked. The exact prompts, evaluator conclusions, byte counts, and artifact excerpts above preserve the reproducible evidence.
- Fresh evaluators were intentionally given no repository skill instructions or approved design. Their conclusions are behavior samples, not a general safety benchmark.
- Interactive evaluator artifacts live under `/tmp/klopsi-interactive-evals.JZ6QtI/` and are intentionally untracked. The 10,000-row and 5 MB limits require upstream reshaping for oversized sources; the agent-only skill does not provide a deterministic renderer or automatic aggregation command.
- Review-corrected I2/I3 evaluator artifacts live under `/tmp/klopsi-interactive-sort-evals.hXkVfI/`. The shared verifier does not itself prove runtime sort-state accessibility; the generated content test and fresh behavior artifacts cover that additional contract.
