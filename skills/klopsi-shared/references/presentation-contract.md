# KLOPSI dashboard presentation contract

This reference is the normative shared contract for static and interactive HTML dashboard artifacts. The verifier is a bounded, dependency-free contract linter; it is not an HTML parser, sanitizer, browser, or security sandbox.

## 1. Input readiness and source verification

- Start from a prepared local artifact or a bounded structured result persisted through KLOPSI when that path is supported. Route invalid input to `klopsi-validation` and reshaping, projection, aggregation, or sampling to `klopsi-analysis` or `klopsi-services`.
- Run `klopsi provenance verify <artifact> --json` whenever an adjacent KLOPSI provenance record exists. Stop on verification failure. If no record exists, mark the source `verified: false`; never invent verification or lineage.
- Preserve exact source identities and compute or retain a SHA-256 digest for every presented source.

## 2. Artifact and data limits

- A complete HTML file, including embedded markup, styles, scripts, data, and geometry, must be no larger than 15 MB (15 * 1024 * 1024 bytes).
- Interactive presentation data must contain at most 10,000 prepared rows and its UTF-8 JSON script body must be no larger than 5 MB (5 * 1024 * 1024 bytes).
- Static mode embeds only the aggregate values needed by its visible views and sets `data.embeddedBytes` to `0`; it does not include an executable script or a presentation-data block.

## 3. No silent truncation and reduction disclosure

Never silently truncate. When the source exceeds a limit, aggregate or project first. Sample only when aggregation cannot answer the question, and ask before sampling when it could materially change interpretation.

When `originalRows` exceeds `presentedRows`, include at least one reduction record and explain the same reduction visibly under `data-klopsi-disclosures`. A reduction record contains `method`, `originalRows`, `presentedRows`, `groupingFields`, `exclusions`, and `sampleBasis` (null when no sampling occurred). State grouping fields, exclusions, and the sample basis plainly.

## 4. Presentation manifest

Embed exactly one non-executable block named `klopsi-presentation-manifest`:

`<script id="klopsi-presentation-manifest" type="application/json">…</script>`

Its JSON object has these exact required top-level fields:

- `schemaVersion`: the string `"1"`;
- `mode`: `"static"` or `"interactive"`;
- `generator`: the string `"klopsi-agent-skill"`;
- `generatedAt`: a canonical UTC ISO-8601 timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form;
- `title`: a nonempty presentation title;
- `sources`: a nonempty array of `identity`, 64-character lowercase hexadecimal `sha256`, boolean `verified`, and optional nonempty `provenancePath` records;
- `transformations`: an array of nonempty plain-language strings;
- `reductions`: an array of the reduction records defined above;
- `data`: nonnegative integer `originalRows`, `presentedRows`, and `embeddedBytes`, plus a nonempty `fields` array. Each field has nonempty `name` and `type`, and `unit` is a nonempty string or null;
- `geography`: one of the conditional forms below;
- `views`: 2–6 records for static mode or 2–4 for interactive mode. Every record has nonempty `id`, `question`, `population`, `unit`, `takeaway`, and a nonnegative integer `recordCount`.

Geography is conditional:

- no map: exactly `{"kind":"none","crs":null}`;
- point coordinates: exactly `kind`, `crs`, `latitudeField`, and `longitudeField`; `kind` is `"coordinates"`, `crs` is nonempty, and both field names exist in embedded data;
- embedded geometry: exactly `kind`, `crs`, and `geometryField`; `kind` is `"geometry"`, `crs` is nonempty, and the field name exists in embedded data.

Do not map data without valid embedded coordinates or geometry and known CRS information. Never geocode, guess coordinates, infer a CRS, or fetch tiles.

Interactive mode additionally embeds exactly one `klopsi-presentation-data` application/JSON script whose body is a JSON array. Its UTF-8 byte length and row count must exactly equal manifest `embeddedBytes` and `presentedRows`.

## 5. Offline and content security

The artifact is one self-contained HTML file. Opening it must not load remote scripts, styles, images, fonts, frames, media, imports, data, telemetry, APIs, map tiles, or meta-refresh navigation. Ordinary visible citation anchors may link to sources because they do not load on open.

Include a Content Security Policy meta element that at minimum sets `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`, and `form-action 'none'`, with no duplicate directives. Inline styles and the interactive inline script may be enabled explicitly. Do not use inline `on*` event handlers, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, dynamic `import()`, `eval`, `new Function`, frames, objects, or embeds.

## 6. Safe JSON and DOM text handling

Serialize JSON with every `<` escaped as `\u003c` before placing it in either application/JSON script body, so data cannot terminate the containing element. Parse only those inert JSON blocks. Render data-derived labels, cells, tooltips, and summaries with `textContent`, DOM node creation, or equivalent attribute-safe APIs; never concatenate data into `innerHTML`.

## 7. Accessibility and visual metadata

Use a document language, UTF-8 charset, viewport metadata, a descriptive title, one main landmark, and a visible level-one heading. Every presentation includes visible `data-klopsi-summary`, `data-klopsi-disclosures`, and `data-klopsi-lineage` regions.

Choose encodings from the analytical question. Every view exposes its question, population, units, relevant record count, and plain-language takeaway. Do not use color as the only information carrier, fabricate precision, make unsupported causal claims, or leave scales unlabeled. Tables use semantic headers; controls are visibly labeled and keyboard operable; SVG graphics have an accessible name and description.

Interactive dashboards also include `data-klopsi-filter-region`, `data-klopsi-record-count`, `data-klopsi-detail-table`, `data-klopsi-reset`, `data-klopsi-empty-state`, and a useful `noscript` summary. Reset restores the documented initial state and the matching count reflects the current filtered row set.

## 8. Verify before handoff

Run the shared verifier after writing or changing the dashboard:

```sh
node ../klopsi-shared/scripts/verify-dashboard.mjs <dashboard.html> --mode <static|interactive> --json
```

Exit 0 means the bounded checks found no contract violations. Exit 1 returns repairable contract findings with stable `code` and `message` values. Exit 2 means the invocation or input path is invalid. Repair every finding and rerun before handoff. A pass does not mean arbitrary HTML is safe; review the produced artifact and open it only in an appropriately isolated environment.

## 9. Presentation evidence is not provenance

The embedded manifest records presentation evidence, source digests, verification status, transformations, reductions, and visual semantics. It is not a KLOPSI provenance sidecar and passing the dashboard verifier is not official artifact provenance. Use `klopsi provenance verify` to make provenance claims.
