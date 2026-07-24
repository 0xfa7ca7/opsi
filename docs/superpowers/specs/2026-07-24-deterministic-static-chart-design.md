# Deterministic Static Chart Experiment

## Status and intent

This is a bounded experimental slice of [issue #28](https://github.com/0xfa7ca7/klopsi/issues/28), not an implementation of the dashboard backlog. It adds one CLI leaf:

```text
klopsi chart <input> --x <column> --y <column> --type bar|line --output <file.html>
```

The command turns a supported local or provider-backed tabular input into one self-contained HTML file with inline CSS and SVG. It is deliberately static, has no JavaScript, does not fetch any runtime assets, and does not accept a visualization specification or arbitrary executable content.

## Research and borrowed patterns

- [VisiData frequency tables](https://www.visidata.org/docs/freq/) make grouping, counts, percentages, ordering, and a text histogram explicit. The default count-descending order is useful for frequency analysis, but this experiment does not aggregate or silently reorder user rows.
- [VisiData graphs](https://www.visidata.org/docs/graph/) require explicit numeric axis typing and expose source rows behind plotted points. The chart command similarly requires explicit x/y columns, rejects non-numeric y values, and includes the selected rows as an accessible table.
- [DuckDB’s official YouPlot guide](https://duckdb.org/docs/current/guides/data_viewers/youplot.html) demonstrates a composable pipeline: query, explicitly `ORDER BY`, explicitly `LIMIT`, emit a simple tabular stream, then render. KLOPSI keeps that separation internally while publishing a durable artifact instead of terminal pixels.
- [YouPlot](https://github.com/red-data-tools/YouPlot) shows the value of a small chart-type vocabulary and explicit input/header/title flags. V1 therefore supports only `bar` and `line`.
- [W3C guidance for complex images](https://www.w3.org/WAI/tutorials/images/complex/) recommends both a short text alternative and a structured long description such as a table. The artifact includes an SVG title/description and an HTML data table.
- [SVG 2 accessibility support](https://www.w3.org/TR/SVG/access) defines title/description relationships. The root SVG uses `role="img"`, `aria-labelledby`, `<title>`, and `<desc>`.
- [OWASP output-encoding guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) requires context-appropriate encoding for untrusted values. Every title, column, label, value, and source-derived string is encoded as text; user data never enters CSS, markup names, URLs, comments, or scripts.

## Alternatives considered

### 1. Inline deterministic SVG and semantic HTML — selected

KLOPSI renders fixed HTML/SVG bytes itself and publishes them with provenance.

Benefits:

- no new runtime or browser dependency;
- readable with JavaScript disabled;
- no CDN, fonts, telemetry, tiles, or network access;
- byte-level determinism is directly testable;
- all dynamic values share one small HTML/XML text encoder;
- a semantic table provides a complete non-visual representation.

Tradeoffs:

- only basic charts and fixed layout;
- long labels are shortened visually while remaining complete in the table and SVG `<title>`;
- no hover, zoom, filtering, aggregation, legends, or responsive reflow.

### 2. Emit data for an external terminal chart tool

KLOPSI could pipe CSV to YouPlot or another executable.

Benefits: small implementation and familiar CLI composition.

Tradeoffs: adds an external dependency, terminal output is not a durable offline HTML artifact, rendering varies with terminal capabilities, and provenance/publication remain unsolved. This is useful prior art, not the selected artifact format.

### 3. Bundle a JavaScript visualization library

KLOPSI could embed a library and data in HTML.

Benefits: richer charts and responsive interactions.

Tradeoffs: larger artifacts, a browser runtime dependency, a wider injection surface, harder byte determinism, and overlap with the later interactive-dashboard scope in issue #28. This is intentionally deferred.

## Exact experimental scope

### Inputs

The command accepts the same tabular input forms as `klopsi query`: local paths, `local:file:` references, provider resource identifiers, and canonical resources. CSV, TSV, JSON, NDJSON, XLSX, Parquet, XML, and selected ZIP entries continue through existing resolution and staging. Existing `--sheet`, `--entry`, `--record-path`, `--allow-insecure-http`, and `--allow-private-network` semantics are reused.

### Chart contract

- `--x <column>` and `--y <column>` are mandatory.
- `--type <bar|line>` is mandatory.
- `--output <file.html>` is mandatory and must have a case-insensitive `.html` suffix.
- `--title <text>` is optional; the default is `<y> by <x>`.
- `--limit <points>` defaults to 100 and is restricted to 1–500.
- `--force` replaces only an existing regular artifact/provenance pair through the existing transactional publisher.
- X is represented as text in source order.
- Y must be a finite number after strict conversion from the staged value. Null, empty, Boolean, object, NaN, and infinity-like values fail the whole command; values are never silently dropped.
- Empty inputs fail with `CHART_EMPTY`.
- Missing columns fail in the bounded read-only query path and no output is published.
- The command does not group, aggregate, sample, interpolate, or sort by value.

## Renderer and data flow

```text
CLI manifest/options
  → construct one KLOPSI-owned SELECT with quoted identifiers
  → QueryService resolves/stages local or provider input
  → SELECT x,y FROM data ORDER BY rowid, bounded by QueryService
  → normalize rows into {label, value} points
  → deterministic HTML/SVG renderer
  → write and fsync staged HTML + derived provenance
  → publishArtifactPair(output, sidecar, force)
  → Renderer writes one human/structured result
```

The SQL template contains only KLOPSI-owned syntax. Column names are double-quoted with embedded quotes doubled. The user cannot supply SQL.

The renderer is a pure function over normalized points and options. Publication is a separate module so byte generation, validation, and filesystem behavior can be tested independently.

## Determinism

- Point order is explicit: staged DuckDB `rowid` ascending, which reflects the staged source sequence.
- The query row limit returns the first N points and reports `truncated: true` when more exist.
- Layout dimensions, colors, tick count, number formatting, whitespace, attribute order, CSS, and final newline are fixed.
- Numeric coordinates are serialized with a fixed decimal helper that removes negative zero and trailing zeroes.
- The HTML contains no timestamp, random identifier, duration, cache status, absolute source path, or provenance digest.
- Identical normalized points, title, axes, chart type, limit, and renderer version produce identical HTML bytes.
- Provenance timestamps are intentionally outside the artifact and may differ between runs, as allowed by issue #28.

## Visual model

The SVG has a fixed 960×480 view box. Both chart types use a linear y scale whose domain includes zero, four deterministic grid intervals, fixed plot margins, and categorical x positions in source order.

- Bar: one equal-width bar per point, drawn from the zero baseline to the value.
- Line: one polyline in source order plus one circle per point.

For a constant-zero series, the fallback domain is `0…1`. X labels are capped visually to 24 Unicode code points with an ellipsis, while the full escaped label remains in the per-mark `<title>` and the table. No information is discarded from the textual representation.

## Accessibility

- `<html lang="en">`, a visible `<h1>`, chart summary, and selected-point count.
- `<figure>` contains an SVG with `role="img"` and references to a `<title>` and `<desc>`.
- The description identifies type, axes, point count, source order, and truncation.
- Gridlines are decorative.
- Each bar/point has a `<title>` containing its complete label and value.
- A `<table>` with `<caption>`, scoped column headers, complete labels, and formatted numeric values follows the figure.
- Color is not the sole carrier of information: axes, geometry, labels, descriptions, and the table encode the same data.
- The artifact remains complete with CSS disabled and usable with JavaScript disabled because it contains no JavaScript.

## Escaping and security

All dynamic text is encoded by one function:

```text
& → &amp;
< → &lt;
> → &gt;
" → &quot;
' → &#39;
```

The encoder is used for HTML text, SVG text, `<title>`, `<desc>`, table cells, and quoted safe attributes. Dynamic values never enter:

- element or attribute names;
- CSS declarations or selectors;
- URL-bearing attributes;
- `<style>`, `<script>`, comments, or raw markup.

The page sets a restrictive Content Security Policy: `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:`. It contains no `script`, `iframe`, external stylesheet, font, image, link preload, form, event-handler attribute, or network URL.

The existing query worker retains external-access-disabled, read-only, SQL-size, row, cell, output, memory, thread, and timeout protections.

## Bounds

- Default visible points: 100.
- Maximum user-requested points: 500.
- QueryService’s existing lower global/runtime limits still apply.
- SVG dimensions and tick count are fixed.
- Each label and cell remains subject to existing query cell/output byte limits.
- No renderer loop is driven by an unbounded count other than the already-bounded normalized point array.

When the source has more rows than the selected limit, the first N rows are rendered and both artifact text and CLI result disclose truncation. The command does not imply that the selected prefix is statistically representative.

## Publication and provenance

The renderer writes staged HTML and a staged provenance sidecar in the destination directory, fsyncs both, and calls `publishArtifactPair`.

The sidecar uses existing derived provenance schema version `1`:

- digest and byte length of the generated HTML;
- final absolute local path;
- media type `text/html`;
- operation `chart`;
- input SHA-256;
- transformation details: renderer version, type, x, y, title, limit, points, source-order policy, and truncation.

`klopsi provenance verify <output.html>` validates the resulting artifact. Publication refuses either an existing artifact or sidecar without `--force`; `--force` uses paired rollback semantics. Failed validation or rendering leaves neither final file.

## Result and error semantics

Success data is a single record:

```json
{
  "output": "/absolute/chart.html",
  "provenancePath": "/absolute/chart.html.provenance.json",
  "type": "bar",
  "x": "category",
  "y": "value",
  "points": 3,
  "limit": 100,
  "truncated": false,
  "order": "source"
}
```

The existing renderer produces the human table or stable JSON/NDJSON/CSV/TSV representation. Warnings remain on stderr unless `--quiet`.

Chart option/data validation exits 2. Query/input failures preserve their existing exit categories. Provenance or publication integrity failures preserve exit 6. Notable chart codes are `CHART_OUTPUT_FORMAT`, `CHART_POINT_LIMIT`, `CHART_EMPTY`, `CHART_NON_NUMERIC_Y`, and `CHART_DESTINATION_EXISTS`.

## Explicitly out of scope

- interactive charts or any JavaScript;
- full static presentation boards;
- multiple series, secondary axes, legends, scatter, pie, maps, or histograms;
- aggregation, frequency-table generation, date parsing, category sorting, SQL, or declarative specs;
- stdin/stdout HTML streaming;
- remote assets, hosted output, telemetry, live queries, or browser launch;
- skill migration to claim the renderer satisfies all dashboard workflows.

## Acceptance criteria

1. `klopsi chart` is present in manifest, help, shell completion metadata, and command docs.
2. Local and provider-backed tabular inputs use existing resolution/staging.
3. Bar and line artifacts contain inline SVG, inline CSS, no JavaScript, no runtime URLs, and a complete data table.
4. Same normalized inputs/options produce identical HTML bytes.
5. Source order is explicit and truncation at 1–500 points is disclosed.
6. Missing x/y columns, non-numeric y values, empty data, invalid output suffix, and limits above 500 fail without publishing.
7. Malicious title, label, and column text is encoded and cannot create markup or executable content.
8. Existing output or sidecar is refused without `--force`; forced publication replaces the pair transactionally.
9. The generated sidecar passes `klopsi provenance verify`.
10. Unit and E2E tests cover rendering, determinism, accessibility, offline structure, errors, bounds, publication, and provenance.
11. Documentation describes this as an experiment related to issue #28 and does not claim to close it.
