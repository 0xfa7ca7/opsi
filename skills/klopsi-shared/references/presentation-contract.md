# KLOPSI dashboard presentation contract

This reference is the normative shared contract for static and interactive HTML dashboard artifacts. The verifier is a bounded, dependency-free contract linter; it is not an HTML parser, sanitizer, browser, or security sandbox.

## 1. Input readiness and source verification

- Start from a prepared local artifact or a bounded structured result persisted through KLOPSI when that path is supported. Route invalid input to `klopsi-validation` and reshaping, projection, aggregation, or sampling to `klopsi-analysis` or `klopsi-services`.
- Run `klopsi provenance verify <artifact> --json` whenever an adjacent KLOPSI provenance record exists. Stop on verification failure. If no record exists, mark the source `verified: false`; never invent verification or lineage.
- Preserve exact source identities and compute or retain a SHA-256 digest for every presented source.

## 2. Artifact and data limits

- A complete HTML file, including embedded markup, styles, scripts, data, and geometry, must be no larger than 15 MB (15 * 1024 * 1024 bytes).
- Every presentation-data JSON body must be no larger than 5 MB (5 * 1024 * 1024 bytes), and interactive presentation data must contain at most 10,000 prepared rows.
- Static mode embeds only aggregate values needed by visible views. A non-map board sets `data.embeddedBytes` to `0` and has no presentation-data block. A static map embeds exactly one inert presentation-data JSON block containing only its prepared spatial rows; the verifier checks its exact bytes, row count, coordinates or geometry, CRS, and exclusions. Static mode never includes executable JavaScript.

## 3. No silent truncation and reduction disclosure

Never silently truncate. When the source exceeds a limit, aggregate or project first. Sample only when aggregation cannot answer the question, and ask before sampling when it could materially change interpretation.

When `originalRows` equals `presentedRows`, `reductions` is empty, including the explicit zero-row case. When the count decreases, reductions form one ordered, strictly decreasing chain: the first `originalRows` equals the overall original count, each next original count equals the previous presented count, and the final presented count equals the overall presented count. Explain the same reductions visibly under `data-klopsi-disclosures`. Each exact reduction object contains only `method`, `originalRows`, `presentedRows`, `groupingFields`, `exclusions`, and `sampleBasis` (null when no sampling occurred). State grouping fields, exclusions, and the sample basis plainly.

## 4. Presentation manifest

Embed exactly one non-executable block named `klopsi-presentation-manifest`:

`<script id="klopsi-presentation-manifest" type="application/json">…</script>`

Its JSON object has these exact required top-level fields:

- `schemaVersion`: the string `"1"`;
- `mode`: `"static"` or `"interactive"`;
- `generator`: the string `"klopsi-agent-skill"`;
- `generatedAt`: a canonical UTC ISO-8601 timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form;
- `title`: a nonempty presentation title;
- `sources`: a nonempty array of exact objects containing only `identity`, 64-character lowercase hexadecimal `sha256`, boolean `verified`, and optional nonempty `provenancePath`;
- `transformations`: an array of nonempty plain-language strings;
- `reductions`: an array of the reduction records defined above;
- `data`: an exact object containing nonnegative integer `originalRows`, `presentedRows`, and `embeddedBytes`, plus a nonempty `fields` array. Each exact field object contains only nonempty `name`, nonempty `type`, and `unit` as a nonempty string or null;
- `geography`: one of the conditional forms below;
- `views`: 2–6 exact records for static mode or 2–4 for interactive mode. Every record contains only nonempty `id`, `question`, `population`, `unit`, `takeaway`, and a nonnegative integer `recordCount` no larger than `data.originalRows`. Because interactive views operate on the embedded prepared rows, their counts also cannot exceed `data.presentedRows`; static aggregated views may describe a source population larger than their presented aggregate rows.

Every manifest object uses only the keys defined here, recursively. Put non-row transformations in `transformations`; do not create a zero-effect reduction.

Geography is conditional:

- no map: exactly `{"kind":"none","crs":null}`;
- point coordinates: exactly `kind`, `crs`, `latitudeField`, `longitudeField`, `validRecords`, and `excludedRecords`; `kind` is `"coordinates"`, CRS is `EPSG:4326`, both field names exist in `data.fields`, and every embedded row has finite latitude −90…90 and longitude −180…180;
- embedded geometry: exactly `kind`, `crs`, `geometryField`, `validRecords`, and `excludedRecords`; `kind` is `"geometry"`, CRS is one of `EPSG:4326`, `EPSG:3794`, or `OGC:CRS84`, the field exists in `data.fields`, and every embedded row contains structurally valid GeoJSON geometry with finite positions and geographic ranges when applicable.

For either spatial form, `validRecords` equals the embedded row count. A nonzero `excludedRecords` must be covered by an ordered reduction with visible, nonempty exclusion reasons. Do not map data without validated embedded spatial rows and a listed CRS. Never geocode, guess coordinates, infer a CRS, or fetch tiles. If validation cannot be supplied, use `{"kind":"none","crs":null}` and a non-map view.

Interactive mode, and static mode only when geography is spatial, embeds exactly one `klopsi-presentation-data` application/JSON script whose body is a JSON array. Its UTF-8 byte length and row count exactly equal manifest `embeddedBytes` and `presentedRows`.

## 5. Offline and content security

The artifact is one self-contained HTML file. Opening it must not load any companion or remote script, style, image, font, frame, object, embed, media, form target, import, data file, API, telemetry, tile, relative/root/file/blob URL, CSS import/URL/image-set reference, or meta-refresh navigation. Ordinary visible citation anchors may link to sources because they do not load on open, but cannot use active URL forms. Safe embedded raster/audio/video `data:` resources and fragment-only SVG references are allowed only in the elements appropriate to those media. Active `javascript:`, `vbscript:`, HTML, XML, and SVG `data:` URLs are forbidden.

Include exactly one Content Security Policy meta element inside the sole `head`, before the `body` and before any active content. Static mode uses exactly `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `img-src data:`, and `style-src 'unsafe-inline'`. Interactive mode adds exactly `script-src 'unsafe-inline'`. Do not add fallback or element/attribute-specific directives, duplicate directive names, or `self`, remote, file, or blob sources. Do not use inline `on*` handlers, network APIs, dynamic imports, `eval`, `new Function`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`/`writeln`, `DOMParser`, contextual fragments, HTML documents, `srcdoc`, frames, objects, or embeds. Dot and quoted-bracket property calls are equally prohibited.

## 6. Safe JSON and DOM text handling

Serialize JSON with every `<` escaped as `\u003c` before placing it in either application/JSON script body, so data cannot terminate the containing element. Parse only those inert JSON blocks. Render data-derived labels, cells, tooltips, and summaries with `textContent`, DOM node creation, or equivalent attribute-safe APIs; never concatenate data into `innerHTML`.

## 7. Accessibility and visual metadata

Use an HTML doctype, nonempty document language, UTF-8 charset, device-width/initial-scale viewport, one nonempty title, exactly one nonhidden main landmark, and exactly one nonhidden nonempty level-one heading. Every presentation includes exactly one visible, nonempty `data-klopsi-summary`, `data-klopsi-disclosures`, and `data-klopsi-lineage` region. Comments and script text never satisfy structure or unresolved-marker checks.

Choose encodings from the analytical question. Every view exposes its question, population, units, relevant record count, and plain-language takeaway. Do not use color as the only information carrier, fabricate precision, make unsupported causal claims, or leave scales unlabeled. Tables use semantic headers; controls are visibly labeled and keyboard operable; SVG graphics have an accessible name and description.

Interactive dashboards also include a named filter region with visibly labeled, enabled, visible, keyboard-reachable native controls; a visible polite live `data-klopsi-record-count`; an enabled, visible, keyboard-reachable native reset button; a semantic `table` with `thead` and `th`; a useful nonempty empty-state region; and a useful nonempty `noscript` summary. Hidden, inert, or `aria-hidden` ancestors and disabled ancestor fieldsets make their descendant controls unavailable. Every button in the main interactive contract scope must individually have a nonempty accessible name and remain operable; one valid reset cannot compensate for another unnamed or unavailable button. Reset restores the documented initial state and the matching count reflects the current filtered row set.

## 8. Verify before handoff

Run the shared verifier after writing or changing the dashboard:

```sh
node ../klopsi-shared/scripts/verify-dashboard.mjs <dashboard.html> --mode <static|interactive> --json
```

Exit 0 means the bounded checks found no contract violations. Exit 1 returns repairable contract findings with stable `code` and `message` values. Exit 2 means the invocation or input path is invalid. Repair every finding and rerun before handoff. A pass does not mean arbitrary HTML is safe; review the produced artifact and open it only in an appropriately isolated environment.

## 9. Presentation evidence is not provenance

The embedded manifest records presentation evidence, source digests, verification status, transformations, reductions, and visual semantics. It is not a KLOPSI provenance sidecar and passing the dashboard verifier is not official artifact provenance. Use `klopsi provenance verify` to make provenance claims.
