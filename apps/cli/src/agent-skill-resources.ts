export interface AgentSkillResource {
  readonly path: string;
  readonly content: string;
}

const PRESENTATION_CONTRACT = `# KLOPSI dashboard presentation contract

This reference is the normative shared contract for static and interactive HTML dashboard artifacts. The verifier is a bounded, dependency-free contract linter; it is not an HTML parser, sanitizer, browser, or security sandbox.

## 1. Input readiness and source verification

- Start from a prepared local artifact or a bounded structured result persisted through KLOPSI when that path is supported. Route invalid input to \`klopsi-validation\` and reshaping, projection, aggregation, or sampling to \`klopsi-analysis\` or \`klopsi-services\`.
- Run \`klopsi provenance verify <artifact> --json\` whenever an adjacent KLOPSI provenance record exists. Stop on verification failure. If no record exists, mark the source \`verified: false\`; never invent verification or lineage.
- Preserve exact source identities and compute or retain a SHA-256 digest for every presented source.

## 2. Artifact and data limits

- A complete HTML file, including embedded markup, styles, scripts, data, and geometry, must be no larger than 15 MB (15 * 1024 * 1024 bytes).
- Every presentation-data JSON body must be no larger than 5 MB (5 * 1024 * 1024 bytes), and interactive presentation data must contain at most 10,000 prepared rows.
- Static mode embeds only aggregate values needed by visible views. A non-map board sets \`data.embeddedBytes\` to \`0\` and has no presentation-data block. A static map embeds exactly one inert presentation-data JSON block containing only its prepared spatial rows; the verifier checks its exact bytes, row count, coordinates or geometry, CRS, and exclusions. Static mode never includes executable JavaScript.

## 3. No silent truncation and reduction disclosure

Never silently truncate. When the source exceeds a limit, aggregate or project first. Sample only when aggregation cannot answer the question, and ask before sampling when it could materially change interpretation.

When \`originalRows\` equals \`presentedRows\`, \`reductions\` is empty, including the explicit zero-row case. When the count decreases, reductions form one ordered, strictly decreasing chain: the first \`originalRows\` equals the overall original count, each next original count equals the previous presented count, and the final presented count equals the overall presented count. Explain the same reductions visibly under \`data-klopsi-disclosures\`. Each exact reduction object contains only \`method\`, \`originalRows\`, \`presentedRows\`, \`groupingFields\`, \`exclusions\`, and \`sampleBasis\` (null when no sampling occurred). State grouping fields, exclusions, and the sample basis plainly.

## 4. Presentation manifest

Embed exactly one non-executable block named \`klopsi-presentation-manifest\`:

\`<script id="klopsi-presentation-manifest" type="application/json">…</script>\`

Its JSON object has these exact required top-level fields:

- \`schemaVersion\`: the string \`"1"\`;
- \`mode\`: \`"static"\` or \`"interactive"\`;
- \`generator\`: the string \`"klopsi-agent-skill"\`;
- \`generatedAt\`: a canonical UTC ISO-8601 timestamp in \`YYYY-MM-DDTHH:mm:ss.sssZ\` form;
- \`title\`: a nonempty presentation title;
- \`sources\`: a nonempty array of exact objects containing only \`identity\`, 64-character lowercase hexadecimal \`sha256\`, boolean \`verified\`, and optional nonempty \`provenancePath\`;
- \`transformations\`: an array of nonempty plain-language strings;
- \`reductions\`: an array of the reduction records defined above;
- \`data\`: an exact object containing nonnegative integer \`originalRows\`, \`presentedRows\`, and \`embeddedBytes\`, plus a nonempty \`fields\` array. Each exact field object contains only nonempty \`name\`, nonempty \`type\`, and \`unit\` as a nonempty string or null;
- \`geography\`: one of the conditional forms below;
- \`views\`: 2–6 exact records for static mode or 2–4 for interactive mode. Every record contains only nonempty \`id\`, \`question\`, \`population\`, \`unit\`, \`takeaway\`, and a nonnegative integer \`recordCount\`.

Every manifest object uses only the keys defined here, recursively. Put non-row transformations in \`transformations\`; do not create a zero-effect reduction.

Geography is conditional:

- no map: exactly \`{"kind":"none","crs":null}\`;
- point coordinates: exactly \`kind\`, \`crs\`, \`latitudeField\`, \`longitudeField\`, \`validRecords\`, and \`excludedRecords\`; \`kind\` is \`"coordinates"\`, CRS is \`EPSG:4326\`, both field names exist in \`data.fields\`, and every embedded row has finite latitude −90…90 and longitude −180…180;
- embedded geometry: exactly \`kind\`, \`crs\`, \`geometryField\`, \`validRecords\`, and \`excludedRecords\`; \`kind\` is \`"geometry"\`, CRS is one of \`EPSG:4326\`, \`EPSG:3794\`, or \`OGC:CRS84\`, the field exists in \`data.fields\`, and every embedded row contains structurally valid GeoJSON geometry with finite positions and geographic ranges when applicable.

For either spatial form, \`validRecords\` equals the embedded row count. A nonzero \`excludedRecords\` must be covered by an ordered reduction with visible, nonempty exclusion reasons. Do not map data without validated embedded spatial rows and a listed CRS. Never geocode, guess coordinates, infer a CRS, or fetch tiles. If validation cannot be supplied, use \`{"kind":"none","crs":null}\` and a non-map view.

Interactive mode, and static mode only when geography is spatial, embeds exactly one \`klopsi-presentation-data\` application/JSON script whose body is a JSON array. Its UTF-8 byte length and row count exactly equal manifest \`embeddedBytes\` and \`presentedRows\`.

## 5. Offline and content security

The artifact is one self-contained HTML file. Opening it must not load any companion or remote script, style, image, font, frame, object, embed, media, form target, import, data file, API, telemetry, tile, relative/root/file/blob URL, CSS import/URL, or meta-refresh navigation. Ordinary visible citation anchors may link to sources because they do not load on open. Safe embedded raster/audio/video \`data:\` resources and fragment-only SVG references are allowed only in the elements appropriate to those media. Active \`javascript:\`, \`vbscript:\`, and HTML/XML \`data:\` URLs are forbidden.

Include exactly one Content Security Policy meta element. Static mode uses exactly \`default-src 'none'\`, \`connect-src 'none'\`, \`object-src 'none'\`, \`base-uri 'none'\`, \`form-action 'none'\`, \`img-src data:\`, and \`style-src 'unsafe-inline'\`. Interactive mode adds exactly \`script-src 'unsafe-inline'\`. Do not add fallback or element/attribute-specific directives, duplicate directive names, or \`self\`, remote, file, or blob sources. Do not use inline \`on*\` handlers, network APIs, dynamic imports, \`eval\`, \`new Function\`, \`innerHTML\`, \`outerHTML\`, \`insertAdjacentHTML\`, \`document.write\`/\`writeln\`, \`DOMParser\`, contextual fragments, HTML documents, \`srcdoc\`, frames, objects, or embeds.

## 6. Safe JSON and DOM text handling

Serialize JSON with every \`<\` escaped as \`\\u003c\` before placing it in either application/JSON script body, so data cannot terminate the containing element. Parse only those inert JSON blocks. Render data-derived labels, cells, tooltips, and summaries with \`textContent\`, DOM node creation, or equivalent attribute-safe APIs; never concatenate data into \`innerHTML\`.

## 7. Accessibility and visual metadata

Use an HTML doctype, nonempty document language, UTF-8 charset, device-width/initial-scale viewport, one nonempty title, exactly one nonhidden main landmark, and exactly one nonhidden nonempty level-one heading. Every presentation includes exactly one visible, nonempty \`data-klopsi-summary\`, \`data-klopsi-disclosures\`, and \`data-klopsi-lineage\` region. Comments and script text never satisfy structure or unresolved-marker checks.

Choose encodings from the analytical question. Every view exposes its question, population, units, relevant record count, and plain-language takeaway. Do not use color as the only information carrier, fabricate precision, make unsupported causal claims, or leave scales unlabeled. Tables use semantic headers; controls are visibly labeled and keyboard operable; SVG graphics have an accessible name and description.

Interactive dashboards also include a named filter region with visibly labeled, enabled, visible, keyboard-reachable native controls; a visible polite live \`data-klopsi-record-count\`; an enabled, visible, keyboard-reachable native reset button; a semantic \`table\` with \`thead\` and \`th\`; a useful nonempty empty-state region; and a useful nonempty \`noscript\` summary. Reset restores the documented initial state and the matching count reflects the current filtered row set.

## 8. Verify before handoff

Run the shared verifier after writing or changing the dashboard:

\`\`\`sh
node ../klopsi-shared/scripts/verify-dashboard.mjs <dashboard.html> --mode <static|interactive> --json
\`\`\`

Exit 0 means the bounded checks found no contract violations. Exit 1 returns repairable contract findings with stable \`code\` and \`message\` values. Exit 2 means the invocation or input path is invalid. Repair every finding and rerun before handoff. A pass does not mean arbitrary HTML is safe; review the produced artifact and open it only in an appropriately isolated environment.

## 9. Presentation evidence is not provenance

The embedded manifest records presentation evidence, source digests, verification status, transformations, reductions, and visual semantics. It is not a KLOPSI provenance sidecar and passing the dashboard verifier is not official artifact provenance. Use \`klopsi provenance verify\` to make provenance claims.
`;

const STATIC_BOARD_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; style-src 'unsafe-inline'">
  <title>{{TITLE}}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17202a;
      --muted: #52606d;
      --paper: #f7f5ef;
      --card: #ffffff;
      --line: #d7dce2;
      --accent: #075985;
      --accent-soft: #dff2fa;
      --highlight: #a33a18;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
    main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 2.5rem 0 3rem; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { max-width: 22ch; font-size: clamp(2rem, 5vw, 4.5rem); line-height: 1; letter-spacing: -0.04em; }
    h2 { font-size: 1.25rem; }
    .eyebrow { color: var(--accent); font-size: .8rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .lede { max-width: 72ch; font-size: 1.15rem; }
    .meta { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; color: var(--muted); }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .kpi, .view, .notes, .details { background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 28px rgb(23 32 42 / 6%); }
    .kpi { min-height: 140px; padding: 1.1rem; }
    .kpi strong { display: block; font-size: 2rem; font-variant-numeric: tabular-nums; }
    .view-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1rem; }
    .view { grid-column: span 6; padding: 1.25rem; }
    .view--wide { grid-column: 1 / -1; }
    .view-meta { color: var(--muted); font-size: .88rem; }
    .takeaway { border-left: 4px solid var(--highlight); padding-left: .8rem; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .axis { stroke: var(--ink); stroke-width: 1; }
    .mark { fill: var(--accent); }
    .mark-secondary { fill: var(--accent-soft); stroke: var(--accent); }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    caption { padding-bottom: .75rem; text-align: left; font-weight: 700; }
    th, td { border-bottom: 1px solid var(--line); padding: .65rem; text-align: left; vertical-align: top; }
    th { background: var(--accent-soft); }
    .details, .notes { margin-top: 1rem; padding: 1.25rem; }
    a { color: var(--accent); text-underline-offset: .2em; }
    a:focus-visible { outline: 3px solid var(--highlight); outline-offset: 3px; }
    @media (max-width: 760px) { .view { grid-column: 1 / -1; } }
    @media print {
      @page { margin: 12mm; }
      body { background: #fff; font-size: 10pt; }
      main { width: 100%; padding: 0; }
      .kpi, .view, .notes, .details, table, svg { break-inside: avoid; box-shadow: none; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Static evidence board</p>
      <h1>{{TITLE}}</h1>
      <p class="lede" data-klopsi-summary>{{SUMMARY}}</p>
      <p class="meta"><span><strong>Scope:</strong> {{SCOPE}}</span><span><strong>Period:</strong> {{PERIOD}}</span><span><strong>Source:</strong> {{SOURCE}}</span></p>
    </header>

    <!-- Replace KPI_CARDS with three to five article.kpi elements. -->
    <section class="kpi-grid" aria-label="Headline findings">
      {{KPI_CARDS}}
    </section>

    <!-- Replace VIEW_CARDS with two to six article.view elements. An accessible inline-SVG pattern follows:
    <article class="view"><h2>View heading</h2><p class="view-meta">Question · population · unit · record count</p>
      <svg role="img" aria-labelledby="view-title view-desc" viewBox="0 0 640 320">
        <title id="view-title">Descriptive chart title</title><desc id="view-desc">Chart type, axes, population, unit, and principal pattern.</desc>
        <line class="axis" x1="48" y1="280" x2="620" y2="280"></line><rect class="mark" x="80" y="120" width="72" height="160"></rect>
      </svg><p class="takeaway">Plain-language takeaway.</p></article>
    -->
    <section class="view-grid" aria-label="Analytical views">
      {{VIEW_CARDS}}
    </section>

    <section class="details">
      <h2>Exact values</h2>
      <table>
        <caption>{{DETAIL_CAPTION}}</caption>
        <thead><tr>{{DETAIL_HEADERS}}</tr></thead>
        <tbody>{{DETAIL_ROWS}}</tbody>
      </table>
    </section>

    <section class="notes" data-klopsi-disclosures>
      <h2>Method and disclosures</h2>
      {{DISCLOSURES}}
    </section>

    <section class="notes" data-klopsi-lineage>
      <h2>Source verification and lineage</h2>
      {{LINEAGE}}
    </section>
  </main>

  <script id="klopsi-presentation-manifest" type="application/json">{{PRESENTATION_MANIFEST_JSON}}</script>
</body>
</html>
`;

const STATIC_ENCODING_GUIDE = `# Static dashboard encoding guide

Choose the visual form from the analytical question and the prepared fields, not from decoration or a requested library.

| Question | Encoding | Non-map or compact fallback |
| --- | --- | --- |
| Change over time | Line or area chart with a labeled time axis | Exact-values table or ordered change list |
| Compare categories | Bars, lollipops, or ranked list | Semantic ranked table |
| Show a distribution | Histogram or statistical summary table | Quantile and range table |
| Show a relationship | Scatter plot with both axes labeled | Paired-value table |
| Show two-dimensional intensity | Heatmap with labeled rows, columns, and legend | Grouped exact-values table |
| Show exact small results | Semantic table or list | Definition list |
| Show geography with valid spatial data | Point map or choropleth | Ranked list, bars, or table |

## View evidence

For every view, state the analytical question, population, unit, relevant record count, and a plain-language takeaway adjacent to the visual. A missing or undocumented unit must remain visibly unknown; do not turn a measure into counts, currency, rates, or percentages. Distinguish source rows from the population represented after filtering or aggregation. Keep counts consistent with the manifest and exact-values table.

Use only precision supported by the source and transformation. Do not add decimal places, causal claims, or confidence that the evidence does not support. Label scales and baselines; avoid dual axes unless the question truly requires them.

## Inline SVG accessibility

Every analytical SVG uses role="img", a unique accessible title and description, and aria-labelledby pointing to both. The title names the view. The description identifies the chart form, axes or spatial encoding, population, unit, and principal pattern. Keep exact values in adjacent semantic HTML, and never rely on SVG geometry or hover alone.

## Geography prerequisites

Map only valid embedded coordinates or geometry with known CRS information. Coordinate and geometry field names must occur in the manifest fields, and the geography manifest object must match the shared contract. Never geocode names, guess locations or boundaries, infer a CRS, draw an illustrative national outline, or fetch tiles. When prerequisites are missing, use the non-map fallback: a ranked list, bar chart, heatmap when two dimensions are real, or semantic table.

## Color and legibility

Do not use color as the only information carrier. Pair color with position, length, pattern, labels, or symbols; preserve readable contrast in screen and print output. Use a restrained categorical palette, a perceptually ordered sequential scale for magnitude, and an explicitly centered diverging scale only when a meaningful midpoint exists. Provide a labeled legend whenever color encodes data.
`;

const INTERACTIVE_DASHBOARD_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>{{TITLE}}</title>
  <style>
    :root { color-scheme: light; --ink: #17202a; --muted: #52606d; --paper: #f4f7f8; --card: #fff; --line: #d7dce2; --accent: #075985; --accent-soft: #dff2fa; --highlight: #a33a18; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
    main { width: min(1240px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 3rem; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { max-width: 24ch; font-size: clamp(2rem, 5vw, 4rem); line-height: 1.05; letter-spacing: -.035em; }
    .eyebrow { color: var(--accent); font-size: .8rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
    .lede { max-width: 75ch; font-size: 1.1rem; }
    .meta, .count { color: var(--muted); }
    .filter-panel, .view, .details, .notes { background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 28px rgb(23 32 42 / 6%); }
    .filter-panel { margin: 1.5rem 0; padding: 1rem; }
    .filters { display: flex; flex-wrap: wrap; align-items: end; gap: .8rem; }
    .control { display: grid; gap: .25rem; min-width: 12rem; }
    label { font-weight: 700; }
    input, select, button { min-height: 44px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: inherit; font: inherit; padding: .55rem .7rem; }
    button { cursor: pointer; font-weight: 700; }
    button:hover { border-color: var(--accent); }
    :focus-visible { outline: 3px solid var(--highlight); outline-offset: 3px; }
    .view-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1rem; }
    .view { grid-column: span 6; min-height: 220px; padding: 1rem; }
    .view--wide { grid-column: 1 / -1; }
    .view-meta { color: var(--muted); font-size: .9rem; }
    .details, .notes { margin-top: 1rem; padding: 1rem; overflow-x: auto; }
    .empty { border: 2px dashed var(--line); border-radius: 10px; margin: 1rem 0; padding: 1rem; }
    [hidden] { display: none !important; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    caption { padding-bottom: .75rem; text-align: left; font-weight: 700; }
    th, td { border-bottom: 1px solid var(--line); padding: .65rem; text-align: left; vertical-align: top; }
    th { background: var(--accent-soft); }
    a { color: var(--accent); text-underline-offset: .2em; }
    @media (max-width: 760px) { .view { grid-column: 1 / -1; } .control { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Interactive evidence dashboard</p>
      <h1>{{TITLE}}</h1>
      <p class="lede" data-klopsi-summary>{{SUMMARY}}</p>
      <p class="meta"><span><strong>Scope:</strong> {{SCOPE}}</span> · <span><strong>Period:</strong> {{PERIOD}}</span> · <span><strong>Source:</strong> {{SOURCE}}</span></p>
    </header>

    <section class="filter-panel" aria-labelledby="filter-heading" data-klopsi-filter-region>
      <h2 id="filter-heading">Explore the data</h2>
      <form class="filters">
        {{FILTER_CONTROLS}}
        <button type="button" data-klopsi-reset>Reset filters</button>
      </form>
      <p class="count" aria-live="polite" aria-atomic="true" data-klopsi-record-count><strong>{{INITIAL_MATCHING_COUNT}}</strong> of {{TOTAL_COUNT}} records match.</p>
    </section>

    <!-- Replace VIEW_CARDS with two to four linked article.view elements. Give data-derived labels dedicated elements and update them with textContent. -->
    <section class="view-grid" aria-label="Linked analytical views">
      {{VIEW_CARDS}}
    </section>

    <p class="empty" data-klopsi-empty-state hidden>No records match the current filters. Reset filters or broaden the selection.</p>

    <section class="details">
      <h2>Matching detail</h2>
      <table data-klopsi-detail-table>
        <caption>{{DETAIL_CAPTION}}</caption>
        <!-- Replace DETAIL_HEADERS with semantic sortable headers. Keep data-field on each th so row rendering uses the same field:
        <th scope="col" data-field="category" aria-sort="none"><button type="button" data-sort-field="category" data-sort-label="Category">Category</button></th>
        -->
        <thead><tr>{{DETAIL_HEADERS}}</tr></thead>
        <tbody></tbody>
      </table>
    </section>

    <section class="notes" data-klopsi-disclosures><h2>Method and disclosures</h2>{{DISCLOSURES}}</section>
    <section class="notes" data-klopsi-lineage><h2>Source verification and lineage</h2>{{LINEAGE}}</section>
  </main>

  <noscript>{{NOSCRIPT_SUMMARY}}</noscript>
  <script id="klopsi-presentation-manifest" type="application/json">{{PRESENTATION_MANIFEST_JSON}}</script>
  <script id="klopsi-presentation-data" type="application/json">{{PRESENTATION_DATA_JSON}}</script>
  <script>
    (() => {
      "use strict";
      const rows = JSON.parse(document.querySelector("#klopsi-presentation-data").textContent);
      const form = document.querySelector("[data-klopsi-filter-region] form");
      const resetButton = document.querySelector("[data-klopsi-reset]");
      const count = document.querySelector("[data-klopsi-record-count]");
      const table = document.querySelector("[data-klopsi-detail-table]");
      const tableBody = table.querySelector("tbody");
      const emptyState = document.querySelector("[data-klopsi-empty-state]");
      const state = { filters: {}, sortField: null, sortDirection: "ascending", selection: null };
      const initialState = JSON.parse(JSON.stringify(state));

      function readFilters() {
        state.filters = {};
        for (const control of form.querySelectorAll("[data-filter-field]")) state.filters[control.dataset.filterField] = control.value;
      }

      function getFilteredRows() {
        const filtered = rows.filter((row) => Object.entries(state.filters).every(([field, value]) => value === "" || String(row[field] ?? "").toLocaleLowerCase().includes(value.toLocaleLowerCase())));
        if (state.sortField === null) return filtered;
        return filtered.slice().sort((left, right) => {
          const result = String(left[state.sortField] ?? "").localeCompare(String(right[state.sortField] ?? ""), undefined, { numeric: true });
          return state.sortDirection === "ascending" ? result : -result;
        });
      }

      function renderCounts(filteredRows) { count.textContent = String(filteredRows.length) + " of " + String(rows.length) + " records match."; }
      function renderViews(filteredRows) {
        for (const target of document.querySelectorAll("[data-view-count]")) target.textContent = String(filteredRows.length);
      }
      function renderTable(filteredRows) {
        tableBody.replaceChildren();
        const fields = Array.from(table.querySelectorAll("thead [data-field]"), (header) => header.dataset.field);
        for (const row of filteredRows) {
          const tableRow = document.createElement("tr");
          for (const field of fields) {
            const cell = document.createElement("td");
            cell.textContent = String(row[field] ?? "");
            tableRow.append(cell);
          }
          tableBody.append(tableRow);
        }
      }
      function renderEmptyState(filteredRows) {
        const isEmpty = filteredRows.length === 0;
        emptyState.hidden = !isEmpty;
        table.hidden = isEmpty;
      }
      function renderSortState() {
        for (const button of document.querySelectorAll("[data-sort-field]")) {
          const field = button.dataset.sortField;
          const header = button.closest("th");
          const direction = field === state.sortField ? state.sortDirection : "none";
          header.setAttribute("aria-sort", direction);
          const fieldLabel = button.dataset.sortLabel || button.textContent.trim() || field;
          const nextDirection = direction === "ascending" ? "descending" : "ascending";
          const label = direction === "none"
            ? "Sort " + fieldLabel + " ascending; currently not sorted"
            : "Sort " + fieldLabel + " " + nextDirection + "; currently " + direction;
          button.setAttribute("aria-label", label);
        }
      }
      function update() {
        const filteredRows = getFilteredRows();
        renderCounts(filteredRows);
        renderViews(filteredRows);
        renderTable(filteredRows);
        renderEmptyState(filteredRows);
        renderSortState();
      }

      form.addEventListener("input", () => { readFilters(); update(); });
      form.addEventListener("change", () => { readFilters(); update(); });
      for (const sortButton of document.querySelectorAll("[data-sort-field]")) {
        sortButton.addEventListener("click", () => {
          const field = sortButton.dataset.sortField;
          state.sortDirection = state.sortField === field && state.sortDirection === "ascending" ? "descending" : "ascending";
          state.sortField = field;
          update();
        });
      }
      resetButton.addEventListener("click", () => {
        form.reset();
        state.filters = { ...initialState.filters };
        state.sortField = initialState.sortField;
        state.sortDirection = initialState.sortDirection;
        state.selection = initialState.selection;
        readFilters();
        update();
        form.querySelector("input, select, button")?.focus();
      });
      readFilters();
      update();
    })();
  </script>
</body>
</html>
`;

const INTERACTIVE_INTERACTION_GUIDE = `# Interactive dashboard interaction guide

The initial state must already answer the broad question. Add interaction to explore related aspects, not to conceal the only useful result.

## Allowed controls and single data flow

Use only labeled categorical filters, numeric ranges, date ranges, text search, sorting, selection, linked highlighting, tooltips with non-hover alternatives, focused drill-down, and Reset. Keep one in-memory state object and derive one filtered row set after every change. That same row set drives the matching count, all linked views, the semantic detail table, and the empty state.

Do not independently filter a chart or table. A visual selection may update shared state and then trigger the same full render flow. Keep total-record count fixed, update matching-record count immediately, and announce that count through the polite live region.

## Reset, keyboard, and focus

Use native inputs, selects, and buttons so filters, sorting, selection, and Reset work with the keyboard. Keep visible focus styles. Reset restores every filter, range, search term, sort order, selection, and drill-down to the documented initial state, rerenders all consumers, and moves focus to the first useful control. Never require page reload.

## Empty state and detail

When no rows match, show a meaningful empty state that names the situation and suggests Reset or broader filters. Keep the matching count, controls, and reset available. Do not leave a blank chart as the only signal.

The detail table uses real table headers and exposes the filtered result without pointer interaction. Put each sort button inside its column header, set \`aria-sort\` on every sortable header to \`none\`, \`ascending\`, or \`descending\`, and give each button an accessible name that states the field, current direction, and next action. Render sort state from the same in-memory state on initial display and after every update. Reset must restore the default sort field and direction and immediately remove every stale header direction and button label. If rendering every matching detail row would impair use, first reshape the presentation data through the analysis workflow; do not silently impose a display-only cap. Any bounded detail rows must have an explicit progressive disclosure control and matching-count explanation that makes omitted display rows discoverable without changing the underlying filtered set.

Put \`data-field="<row-key>"\` on every rendered \`th\`, matching the row property exactly, and put \`data-sort-field="<row-key>"\` on its native sort button. The starter script reads \`data-field\` to build cells and \`data-sort-field\` to sort the same filtered rows; omitting either produces an empty or unsortable column.

## Views, selection, and tooltip alternatives

Use two to four complementary views. Every view states its question, population, unit, relevant count, and takeaway. Pair linked highlighting with labels, patterns, or symbols so color is not the only signal. Any tooltip value must also be reachable by keyboard focus, selection text, an adjacent list, or the semantic detail table. Keep focused drill-down reversible and preserve a clear path back to the initial overview.

## Geography and disclosure

Map only valid embedded coordinates or geometry with a known CRS. Never geocode names, invent positions or outlines, infer a CRS, or load tiles. When spatial prerequisites are absent, use bars, a ranked list, heatmap, or semantic table.

Disclose each aggregation, projection, selection, exclusion, or sample with original and presented counts, rules, grouping fields, sample basis, and interpretive impact. State explicitly that a verifier pass is presentation evidence rather than official artifact provenance.
`;

export const DASHBOARD_VERIFIER_SOURCE = String.raw`/* global Buffer, process */
import { readFile, stat } from 'node:fs/promises';

const MAX_HTML_BYTES = 15 * 1024 * 1024;
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const MAX_INTERACTIVE_ROWS = 10_000;

function finding(code, message) {
  return { code, message };
}

function add(findings, condition, code, message) {
  if (condition) findings.push(finding(code, message));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function attributeValue(tag, name) {
  const pattern = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", 'iu');
  const match = pattern.exec(tag);
  return match === null ? undefined : (match[1] ?? match[2] ?? match[3]);
}

function openingTags(html) {
  return html.match(/<[a-z][^>]*>/giu) ?? [];
}

function markupOnly(html) {
  return html
    .replace(/<!--[\s\S]*?-->/gu, (comment) => ' '.repeat(comment.length))
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/giu, (_match, opening, body, closing) => opening + ' '.repeat(body.length) + closing);
}

function extractJsonScripts(html, id) {
  const source = html.replace(/<!--[\s\S]*?-->/gu, (comment) => ' '.repeat(comment.length));
  const blocks = [];
  const pattern = /<script\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const tag = match[0];
    const matches = attributeValue(tag, 'id') === id;
    const type = attributeValue(tag, 'type')?.trim().toLowerCase();
    const closeStart = source.toLowerCase().indexOf('</script', pattern.lastIndex);
    if (closeStart < 0) {
      if (matches) blocks.push({ body: undefined, type });
      break;
    }
    const closeEnd = source.indexOf('>', closeStart);
    if (closeEnd < 0) {
      if (matches) blocks.push({ body: undefined, type });
      break;
    }
    if (matches) blocks.push({ body: source.slice(pattern.lastIndex, closeStart), type });
    pattern.lastIndex = closeEnd + 1;
  }
  return blocks;
}

function parseJsonBlock(block) {
  if (block.body === undefined) return { value: undefined, parsed: false, unsafe: false };
  const unsafe = block.body.includes('<');
  try {
    return { value: JSON.parse(block.body), parsed: true, unsafe };
  } catch {
    return { value: undefined, parsed: false, unsafe };
  }
}

function validSource(source) {
  return isObject(source)
    && hasExactKeys(source, source.provenancePath === undefined
      ? ['identity', 'sha256', 'verified']
      : ['identity', 'sha256', 'verified', 'provenancePath'])
    && isNonemptyString(source.identity)
    && typeof source.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(source.sha256)
    && typeof source.verified === 'boolean'
    && (source.provenancePath === undefined || isNonemptyString(source.provenancePath));
}

function validField(field) {
  return isObject(field)
    && hasExactKeys(field, ['name', 'type', 'unit'])
    && isNonemptyString(field.name)
    && isNonemptyString(field.type)
    && (field.unit === null || isNonemptyString(field.unit));
}

function validReduction(reduction) {
  return isObject(reduction)
    && hasExactKeys(reduction, ['method', 'originalRows', 'presentedRows', 'groupingFields', 'exclusions', 'sampleBasis'])
    && isNonemptyString(reduction.method)
    && isCount(reduction.originalRows)
    && isCount(reduction.presentedRows)
    && Array.isArray(reduction.groupingFields)
    && reduction.groupingFields.every(isNonemptyString)
    && Array.isArray(reduction.exclusions)
    && reduction.exclusions.every(isNonemptyString)
    && (reduction.sampleBasis === null || isNonemptyString(reduction.sampleBasis))
    && reduction.originalRows > reduction.presentedRows;
}

function validGeography(geography, fields) {
  if (!isObject(geography)) return false;
  if (geography.kind === 'none') {
    return hasExactKeys(geography, ['kind', 'crs']) && geography.crs === null;
  }
  const fieldNames = new Set(fields.map((field) => field.name));
  if (geography.kind === 'coordinates') {
    return hasExactKeys(geography, ['kind', 'crs', 'latitudeField', 'longitudeField', 'validRecords', 'excludedRecords'])
      && geography.crs === 'EPSG:4326'
      && isNonemptyString(geography.latitudeField)
      && isNonemptyString(geography.longitudeField)
      && isCount(geography.validRecords)
      && isCount(geography.excludedRecords)
      && fieldNames.has(geography.latitudeField)
      && fieldNames.has(geography.longitudeField);
  }
  if (geography.kind === 'geometry') {
    return hasExactKeys(geography, ['kind', 'crs', 'geometryField', 'validRecords', 'excludedRecords'])
      && ['EPSG:4326', 'EPSG:3794', 'OGC:CRS84'].includes(geography.crs)
      && isNonemptyString(geography.geometryField)
      && isCount(geography.validRecords)
      && isCount(geography.excludedRecords)
      && fieldNames.has(geography.geometryField);
  }
  return false;
}

function validManifest(manifest) {
  if (!isObject(manifest)) return false;
  if (!hasExactKeys(manifest, [
    'schemaVersion',
    'mode',
    'generator',
    'generatedAt',
    'title',
    'sources',
    'transformations',
    'reductions',
    'data',
    'geography',
    'views',
  ])
    || manifest.schemaVersion !== '1'
    || (manifest.mode !== 'static' && manifest.mode !== 'interactive')
    || manifest.generator !== 'klopsi-agent-skill'
    || !isCanonicalTimestamp(manifest.generatedAt)
    || !isNonemptyString(manifest.title)
    || !Array.isArray(manifest.sources)
    || manifest.sources.length === 0
    || !manifest.sources.every(validSource)
    || !Array.isArray(manifest.transformations)
    || !manifest.transformations.every(isNonemptyString)
    || !Array.isArray(manifest.reductions)
    || !manifest.reductions.every(validReduction)
    || !isObject(manifest.data)
    || !hasExactKeys(manifest.data, ['originalRows', 'presentedRows', 'embeddedBytes', 'fields'])
    || !isCount(manifest.data.originalRows)
    || !isCount(manifest.data.presentedRows)
    || !isCount(manifest.data.embeddedBytes)
    || manifest.data.originalRows < manifest.data.presentedRows
    || !Array.isArray(manifest.data.fields)
    || manifest.data.fields.length === 0
    || !manifest.data.fields.every(validField)
    || !validGeography(manifest.geography, manifest.data.fields)
    || !Array.isArray(manifest.views)
    || !manifest.views.every(validView)) return false;
  if (manifest.reductions.length === 0) {
    if (manifest.data.originalRows !== manifest.data.presentedRows) return false;
  } else {
    if (manifest.reductions[0].originalRows !== manifest.data.originalRows
      || manifest.reductions.at(-1).presentedRows !== manifest.data.presentedRows) return false;
    for (let index = 1; index < manifest.reductions.length; index += 1) {
      if (manifest.reductions[index - 1].presentedRows !== manifest.reductions[index].originalRows) return false;
    }
  }
  return true;
}

function validView(view) {
  return isObject(view)
    && hasExactKeys(view, ['id', 'question', 'population', 'unit', 'recordCount', 'takeaway'])
    && isNonemptyString(view.id)
    && isNonemptyString(view.question)
    && isNonemptyString(view.population)
    && isNonemptyString(view.unit)
    && isCount(view.recordCount)
    && isNonemptyString(view.takeaway);
}

function executableScriptBodies(html) {
  const source = html.replace(/<!--[\s\S]*?-->/gu, (comment) => ' '.repeat(comment.length));
  const bodies = [];
  const pattern = /<script\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const tag = match[0];
    const closeStart = source.toLowerCase().indexOf('</script', pattern.lastIndex);
    if (closeStart < 0) break;
    const type = attributeValue(tag, 'type')?.toLowerCase();
    if (type !== 'application/json') bodies.push(source.slice(pattern.lastIndex, closeStart));
    const closeEnd = source.indexOf('>', closeStart);
    pattern.lastIndex = closeEnd < 0 ? source.length : closeEnd + 1;
  }
  return bodies;
}

function eventHandlerBodies(html) {
  const bodies = [];
  for (const tag of openingTags(markupOnly(html))) {
    const pattern = /\son[a-z][a-z0-9_-]*(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?(?=\s|>)/giu;
    let match;
    while ((match = pattern.exec(tag)) !== null) bodies.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return bodies;
}

function isSafeEmbeddedData(value, tagName, attribute) {
  value = normalizedUrl(value);
  if (!/^data:/iu.test(value)) return false;
  if ((tagName === 'img' && attribute === 'src') || (tagName === 'image' && attribute === 'href') || attribute === 'poster') {
    return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  if (tagName === 'source' && attribute === 'src') {
    return /^data:(?:audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  if (tagName === 'audio' && attribute === 'src') {
    return /^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  if (tagName === 'video' && attribute === 'src') {
    return /^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  return false;
}

function hasActiveUrl(html) {
  const active = /^(?:javascript|vbscript):|^data:text\/(?:html|xml)|^data:application\/(?:xhtml\+xml|xml)/iu;
  for (const tag of openingTags(markupOnly(html))) {
    for (const name of ['href', 'src', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href']) {
      const value = attributeValue(tag, name);
      if (value !== undefined && active.test(normalizedUrl(value))) return true;
    }
  }
  const styleBodies = [...markupOnly(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map((match) => match[1] ?? '');
  return styleBodies.some((body) => [...body.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/giu)]
    .some((match) => active.test(normalizedUrl(match[2] ?? ''))));
}

function hasCompanionResource(html) {
  const markup = markupOnly(html);
  for (const tag of openingTags(markup)) {
    const tagName = /^<([a-z][a-z0-9:-]*)/iu.exec(tag)?.[1]?.toLowerCase();
    if (tagName === undefined) continue;
    for (const name of ['src', 'srcset', 'poster', 'data', 'action', 'formaction', 'background']) {
      const value = attributeValue(tag, name);
      if (value === undefined || normalizedUrl(value) === '') continue;
      if (isSafeEmbeddedData(value, tagName, name)) continue;
      return true;
    }
    if (tagName !== 'a') {
      const href = attributeValue(tag, 'href');
      if (href !== undefined && normalizedUrl(href) !== '' && !normalizedUrl(href).startsWith('#')
        && !isSafeEmbeddedData(href, tagName, 'href')) return true;
      const xlinkHref = attributeValue(tag, 'xlink:href');
      if (xlinkHref !== undefined && normalizedUrl(xlinkHref) !== '' && !normalizedUrl(xlinkHref).startsWith('#')) return true;
    }
    const inlineStyle = attributeValue(tag, 'style');
    if (inlineStyle !== undefined && hasUnsafeCssReference(inlineStyle)) return true;
  }
  const styleBodies = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map((match) => match[1] ?? '');
  return styleBodies.some(hasUnsafeCssReference);
}

function hasUnsafeCssReference(css) {
  if (/@import\b/iu.test(css) || /\\(?:[0-9a-f]{1,6}\s?|.)/iu.test(css)) return true;
  for (const match of css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/giu)) {
    const value = normalizedUrl(match[2] ?? '');
    if (value.startsWith('#')) continue;
    if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/iu.test(value)) continue;
    return true;
  }
  return false;
}

function normalizedUrl(value) {
  return value
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (_match, hexadecimal, decimal) => String.fromCodePoint(Number.parseInt(hexadecimal ?? decimal, hexadecimal === undefined ? 10 : 16)))
    .replace(/&(?:Tab|NewLine);/gu, '')
    .replace(/&colon;/giu, ':')
    .split('')
    .filter((character) => character.codePointAt(0) > 0x20)
    .join('')
    .trim();
}

function hasUnsafeElement(html) {
  return openingTags(markupOnly(html)).some((tag) => /^<(?:iframe|object|embed)\b/iu.test(tag));
}

function hasMetaRefresh(html) {
  return openingTags(markupOnly(html)).some((tag) =>
    /^<meta\b/iu.test(tag) && attributeValue(tag, 'http-equiv')?.trim().toLowerCase() === 'refresh');
}

function hasValidCsp(html, mode) {
  const tags = openingTags(markupOnly(html)).filter((candidate) =>
    /^<meta\b/iu.test(candidate)
      && attributeValue(candidate, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (tags.length !== 1) return false;
  const tag = tags[0];
  const content = attributeValue(tag, 'content');
  if (content === undefined) return false;
  const directives = new Map();
  for (const part of content.split(';')) {
    const tokens = part.trim().split(/\s+/u).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (name === undefined) continue;
    if (directives.has(name)) return false;
    directives.set(name, tokens.slice(1).map((token) => token.toLowerCase()));
  }
  const expected = new Map([
    ['default-src', ["'none'"]],
    ['connect-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
    ['img-src', ['data:']],
    ['style-src', ["'unsafe-inline'"]],
  ]);
  if (mode === 'interactive') expected.set('script-src', ["'unsafe-inline'"]);
  if (directives.size !== expected.size) return false;
  for (const [name, expectedValues] of expected) {
    const values = directives.get(name);
    if (values === undefined || values.length !== expectedValues.length
      || values.some((value, index) => value !== expectedValues[index])) return false;
  }
  return true;
}

function hasTemplateMarker(html) {
  const visibleMarkup = markupOnly(html).replace(/\/\*[\s\S]*?\*\//gu, (comment) => ' '.repeat(comment.length));
  return /\{\{[A-Z0-9_ -]+\}\}|\[\[[A-Z0-9_ -]+\]\]|__[A-Z][A-Z0-9_ -]+__/u.test(visibleMarkup);
}

function elementBlocks(html, selector) {
  const markup = markupOnly(html);
  const blocks = [];
  const pattern = /<([a-z][a-z0-9:-]*)\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(markup)) !== null) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    if (!selector(tagName, tag)) continue;
    const closing = new RegExp('<\\/' + tagName + '\\s*>', 'giu');
    closing.lastIndex = pattern.lastIndex;
    const close = closing.exec(markup);
    blocks.push({ tagName, tag, body: close === null ? '' : markup.slice(pattern.lastIndex, close.index) });
  }
  return blocks;
}

function isHiddenTag(tag) {
  return /\shidden(?:\s|=|>)/iu.test(tag)
    || attributeValue(tag, 'aria-hidden')?.trim().toLowerCase() === 'true'
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attributeValue(tag, 'style') ?? '');
}

function isUnavailableControl(tag) {
  return isHiddenTag(tag)
    || hasNamedAttribute(tag, 'disabled')
    || hasNamedAttribute(tag, 'inert')
    || attributeValue(tag, 'aria-disabled')?.trim().toLowerCase() === 'true'
    || attributeValue(tag, 'type')?.trim().toLowerCase() === 'hidden'
    || attributeValue(tag, 'tabindex')?.trim() === '-1';
}

function visibleText(body) {
  return body.replace(/<[^>]*>/gu, ' ').replace(/&(?:nbsp|#160|#x0*a0);/giu, ' ').trim();
}

function validVisibleRegion(html, attribute) {
  const blocks = elementBlocks(html, (_tagName, tag) => attributeValue(tag, attribute) !== undefined || new RegExp('\\s' + attribute + '(?=\\s|>)', 'iu').test(tag));
  return blocks.length === 1 && !isHiddenTag(blocks[0].tag) && visibleText(blocks[0].body).length > 0;
}

function validDocumentStructure(html) {
  const markup = markupOnly(html);
  const htmlTag = openingTags(markup).find((tag) => /^<html\b/iu.test(tag));
  const charset = openingTags(markup).some((tag) => /^<meta\b/iu.test(tag) && attributeValue(tag, 'charset')?.trim().toLowerCase() === 'utf-8');
  const viewport = openingTags(markup).some((tag) => /^<meta\b/iu.test(tag)
    && attributeValue(tag, 'name')?.trim().toLowerCase() === 'viewport'
    && /(?:^|,)\s*width\s*=\s*device-width(?:\s*,|$)/iu.test(attributeValue(tag, 'content') ?? '')
    && /(?:^|,)\s*initial-scale\s*=\s*1(?:\.0+)?(?:\s*,|$)/iu.test(attributeValue(tag, 'content') ?? ''));
  const head = elementBlocks(markup, (tagName) => tagName === 'head');
  const title = head.length === 1 ? elementBlocks(head[0].body, (tagName) => tagName === 'title') : [];
  const mains = elementBlocks(markup, (tagName) => tagName === 'main').filter((block) => !isHiddenTag(block.tag));
  const headings = elementBlocks(markup, (tagName) => tagName === 'h1').filter((block) => !isHiddenTag(block.tag) && visibleText(block.body).length > 0);
  return {
    doctype: /^\s*<!doctype\s+html\s*>/iu.test(markup),
    language: htmlTag !== undefined && isNonemptyString(attributeValue(htmlTag, 'lang')),
    charset,
    viewport,
    title: title.length === 1 && visibleText(title[0].body).length > 0,
    main: mains.length === 1,
    heading: headings.length === 1,
  };
}

function validInteractiveStructure(html) {
  const filter = elementBlocks(html, (_tagName, tag) => hasNamedAttribute(tag, 'data-klopsi-filter-region'));
  let filterValid = filter.length === 1 && !isHiddenTag(filter[0].tag)
    && (isNonemptyString(attributeValue(filter[0].tag, 'aria-label')) || isNonemptyString(attributeValue(filter[0].tag, 'aria-labelledby')));
  if (filterValid) {
    const controls = openingTags(filter[0].body).filter((tag) => /^<(?:input|select|textarea|button)\b/iu.test(tag));
    const customControls = openingTags(filter[0].body).some((tag) => /\srole\s*=\s*(?:"|')?(?:button|checkbox|combobox|listbox|radio|slider|spinbutton|textbox)/iu.test(tag));
    filterValid = controls.length > 0 && !customControls && controls.every((tag) => {
      if (isUnavailableControl(tag)) return false;
      if (/^<button\b/iu.test(tag)) return isNonemptyString(attributeValue(tag, 'aria-label')) || /<button\b[^>]*>[\s\S]*?\S[\s\S]*?<\/button>/iu.test(filter[0].body);
      const id = attributeValue(tag, 'id');
      return isNonemptyString(attributeValue(tag, 'aria-label'))
        || isNonemptyString(attributeValue(tag, 'aria-labelledby'))
        || (isNonemptyString(id) && elementBlocks(filter[0].body, (tagName, labelTag) => tagName === 'label' && attributeValue(labelTag, 'for') === id)
          .some((label) => visibleText(label.body).length > 0));
    });
  }
  const reset = elementBlocks(html, (tagName, tag) => tagName === 'button' && hasNamedAttribute(tag, 'data-klopsi-reset'));
  const count = elementBlocks(html, (_tagName, tag) => hasNamedAttribute(tag, 'data-klopsi-record-count'));
  const table = elementBlocks(html, (tagName, tag) => tagName === 'table' && hasNamedAttribute(tag, 'data-klopsi-detail-table'));
  const empty = elementBlocks(html, (_tagName, tag) => hasNamedAttribute(tag, 'data-klopsi-empty-state'));
  const noscript = elementBlocks(html, (tagName) => tagName === 'noscript');
  return {
    filter: filterValid,
    reset: reset.length === 1 && !isUnavailableControl(reset[0].tag) && visibleText(reset[0].body).length > 0 && attributeValue(reset[0].tag, 'type')?.toLowerCase() === 'button',
    count: count.length === 1 && !isHiddenTag(count[0].tag) && attributeValue(count[0].tag, 'aria-live')?.toLowerCase() === 'polite' && visibleText(count[0].body).length > 0,
    table: table.length === 1 && /<thead\b[^>]*>[\s\S]*<th\b[^>]*>[\s\S]*<\/thead>/iu.test(table[0].body),
    empty: empty.length === 1 && visibleText(empty[0].body).length > 0,
    noscript: noscript.length === 1 && visibleText(noscript[0].body).length > 0,
  };
}

function hasNamedAttribute(tag, name) {
  return attributeValue(tag, name) !== undefined || new RegExp('\\s' + name + '(?=\\s|>)', 'iu').test(tag);
}

function hasAccessibleSvgs(html) {
  return elementBlocks(html, (tagName) => tagName === 'svg').every((svg) => {
    const labels = (attributeValue(svg.tag, 'aria-labelledby') ?? '').trim().split(/\s+/u);
    const titles = elementBlocks(svg.body, (tagName) => tagName === 'title')
      .filter((title) => visibleText(title.body).length > 0);
    const descriptions = elementBlocks(svg.body, (tagName) => tagName === 'desc')
      .filter((description) => visibleText(description.body).length > 0);
    const titleId = titles.length === 1 ? attributeValue(titles[0].tag, 'id') : undefined;
    const descriptionId = descriptions.length === 1 ? attributeValue(descriptions[0].tag, 'id') : undefined;
    return attributeValue(svg.tag, 'role')?.toLowerCase() === 'img'
      && titleId !== undefined && descriptionId !== undefined
      && labels.includes(titleId) && labels.includes(descriptionId);
  });
}

function validPosition(value, crs) {
  if (!Array.isArray(value) || value.length < 2 || !value.every(Number.isFinite)) return false;
  if (crs === 'EPSG:4326' || crs === 'OGC:CRS84') {
    return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
  }
  return true;
}

function equalPosition(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validLineString(value, crs) {
  return Array.isArray(value) && value.length >= 2 && value.every((position) => validPosition(position, crs));
}

function validLinearRing(value, crs) {
  return Array.isArray(value) && value.length >= 4
    && value.every((position) => validPosition(position, crs))
    && equalPosition(value[0], value.at(-1));
}

function validGeometry(value, crs) {
  if (!isObject(value) || !isNonemptyString(value.type)) return false;
  if (value.type === 'GeometryCollection') {
    return hasExactKeys(value, ['type', 'geometries'])
      && Array.isArray(value.geometries)
      && value.geometries.every((geometry) => validGeometry(geometry, crs));
  }
  if (!hasExactKeys(value, ['type', 'coordinates'])) return false;
  if (value.type === 'Point') return validPosition(value.coordinates, crs);
  if (value.type === 'MultiPoint') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((position) => validPosition(position, crs));
  if (value.type === 'LineString') return validLineString(value.coordinates, crs);
  if (value.type === 'MultiLineString') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((line) => validLineString(line, crs));
  if (value.type === 'Polygon') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((ring) => validLinearRing(ring, crs));
  if (value.type === 'MultiPolygon') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) => validLinearRing(ring, crs)));
  return false;
}

function validSpatialRows(manifest, rows) {
  const geography = manifest.geography;
  if (geography.kind === 'none') return true;
  if (!Array.isArray(rows) || geography.validRecords !== rows.length) return false;
  if (geography.excludedRecords > 0) {
    const disclosed = manifest.reductions
      .filter((reduction) => reduction.exclusions.length > 0)
      .reduce((total, reduction) => total + reduction.originalRows - reduction.presentedRows, 0);
    if (disclosed !== geography.excludedRecords) return false;
  }
  if (geography.kind === 'coordinates') {
    return rows.every((row) => isObject(row)
      && Number.isFinite(row[geography.latitudeField])
      && Number.isFinite(row[geography.longitudeField])
      && row[geography.latitudeField] >= -90 && row[geography.latitudeField] <= 90
      && row[geography.longitudeField] >= -180 && row[geography.longitudeField] <= 180);
  }
  return rows.every((row) => isObject(row) && validGeometry(row[geography.geometryField], geography.crs));
}

function output(result, exitCode, jsonRequested) {
  if (jsonRequested) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (result.findings.length > 0) {
    for (const item of result.findings) process.stderr.write(item.code + ': ' + item.message + '\n');
  }
  process.exitCode = exitCode;
}

function invalidInvocation(message, mode, jsonRequested) {
  const result = { valid: false, mode: mode ?? null, findings: [finding('INVALID_INVOCATION', message)] };
  output(result, 2, jsonRequested);
}

async function main() {
  const args = process.argv.slice(2);
  const jsonRequested = args.includes('--json');
  let inputPath;
  let mode;
  let invalid;
  let jsonSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      if (jsonSeen) {
        invalid = 'Duplicate argument: --json';
        break;
      }
      jsonSeen = true;
      continue;
    }
    if (argument === '--mode') {
      if (mode !== undefined) {
        invalid = 'Duplicate argument: --mode';
        break;
      }
      const value = args[index + 1];
      if (value !== 'static' && value !== 'interactive') {
        invalid = 'Expected --mode static or --mode interactive.';
        break;
      }
      mode = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('-') || inputPath !== undefined) {
      invalid = 'Unknown or duplicate argument: ' + argument;
      break;
    }
    inputPath = argument;
  }
  if (invalid !== undefined || inputPath === undefined || mode === undefined) {
    invalidInvocation(invalid ?? 'Usage: verify-dashboard.mjs <dashboard.html> --mode <static|interactive> [--json]', mode, jsonRequested);
    return;
  }

  let metadata;
  try {
    metadata = await stat(inputPath);
  } catch {
    invalidInvocation('Dashboard input does not exist or cannot be inspected.', mode, jsonRequested);
    return;
  }
  if (!metadata.isFile()) {
    invalidInvocation('Dashboard input must be a regular file.', mode, jsonRequested);
    return;
  }
  if (metadata.size > MAX_HTML_BYTES) {
    const findings = [finding('HTML_TOO_LARGE', 'Dashboard HTML exceeds the 15 MB file limit.')];
    output({ valid: false, mode, findings }, 1, jsonRequested);
    return;
  }

  let html;
  try {
    html = await readFile(inputPath, 'utf8');
  } catch {
    invalidInvocation('Dashboard input could not be read.', mode, jsonRequested);
    return;
  }

  const findings = [];
  const manifestBlocks = extractJsonScripts(html, 'klopsi-presentation-manifest');
  const manifestBlock = manifestBlocks.find((block) => block.type === 'application/json')
    ?? manifestBlocks[0]
    ?? { body: undefined, type: undefined };
  const parsedManifest = parseJsonBlock(manifestBlock);
  add(findings, manifestBlocks.length === 0, 'MANIFEST_MISSING', 'A presentation manifest JSON block is required.');
  add(findings, manifestBlocks.length > 0 && (manifestBlocks.length !== 1 || manifestBlocks[0].type !== 'application/json'), 'MANIFEST_INVALID', 'Dashboards require exactly one presentation manifest script with type="application/json".');
  add(findings, manifestBlocks.length > 0 && !parsedManifest.parsed, 'MANIFEST_INVALID', 'The presentation manifest must contain valid JSON.');
  add(findings, manifestBlocks.some((block) => block.body?.includes('<') === true), 'JSON_EMBEDDING_UNSAFE', 'JSON script bodies must escape every less-than character as \\u003c.');

  const manifest = parsedManifest.value;
  const manifestValid = parsedManifest.parsed && validManifest(manifest);
  add(findings, parsedManifest.parsed && !manifestValid, 'MANIFEST_INVALID', 'The presentation manifest does not match the required schema.');

  const manifestObject = isObject(manifest) ? manifest : undefined;
  const manifestData = manifestObject !== undefined && isObject(manifestObject.data)
    ? manifestObject.data
    : undefined;
  const manifestViews = manifestObject !== undefined && Array.isArray(manifestObject.views)
    ? manifestObject.views
    : undefined;
  const manifestReductions = manifestObject !== undefined && Array.isArray(manifestObject.reductions)
    ? manifestObject.reductions
    : undefined;
  if (manifestObject !== undefined) {
    add(findings, typeof manifestObject.mode === 'string' && manifestObject.mode !== mode, 'MODE_MISMATCH', 'The manifest mode does not match the expected presentation mode.');
    const minimumViews = 2;
    const maximumViews = mode === 'static' ? 6 : 4;
    add(findings, manifestViews === undefined || manifestViews.length < minimumViews || manifestViews.length > maximumViews || !manifestViews.every(validView), 'VIEW_METADATA_INVALID', 'Views must have the required count and complete analytical metadata.');
  }
  if (manifestData !== undefined) {
    add(findings, isCount(manifestData.embeddedBytes) && manifestData.embeddedBytes > MAX_DATA_BYTES, 'DATA_TOO_LARGE', 'Embedded presentation data exceeds the 5 MB limit.');
    add(findings, mode === 'interactive' && isCount(manifestData.presentedRows) && manifestData.presentedRows > MAX_INTERACTIVE_ROWS, 'ROW_LIMIT_EXCEEDED', 'Interactive presentation data exceeds 10,000 rows.');
    add(findings, isCount(manifestData.originalRows) && isCount(manifestData.presentedRows) && manifestData.originalRows > manifestData.presentedRows && (manifestReductions === undefined || manifestReductions.length === 0), 'REDUCTION_UNDISCLOSED', 'A row reduction requires at least one manifest reduction record.');
  }

  const dataBlocks = extractJsonScripts(html, 'klopsi-presentation-data');
  const dataBlock = dataBlocks.find((block) => block.type === 'application/json')
    ?? dataBlocks[0]
    ?? { body: undefined, type: undefined };
  const parsedData = parseJsonBlock(dataBlock);
  add(findings, dataBlocks.some((block) => block.body?.includes('<') === true), 'JSON_EMBEDDING_UNSAFE', 'JSON script bodies must escape every less-than character as \\u003c.');
  add(findings, dataBlocks.some((block) => block.body !== undefined && Buffer.byteLength(block.body, 'utf8') > MAX_DATA_BYTES), 'DATA_TOO_LARGE', 'Embedded presentation data exceeds the 5 MB limit.');
  const spatialMode = manifestObject !== undefined
    && isObject(manifestObject.geography)
    && (manifestObject.geography.kind === 'coordinates' || manifestObject.geography.kind === 'geometry');
  if (mode === 'interactive' || spatialMode) {
    add(findings, dataBlocks.length !== 1 || dataBlocks[0].type !== 'application/json', 'MANIFEST_INVALID', 'Interactive and spatial static dashboards require exactly one presentation-data script with type="application/json".');
    add(findings, dataBlocks.length > 0 && (!parsedData.parsed || !Array.isArray(parsedData.value)), 'MANIFEST_INVALID', 'Presentation-data must be a valid JSON array.');
    if (dataBlock.body !== undefined && parsedData.parsed && Array.isArray(parsedData.value)) {
      const embeddedBytes = Buffer.byteLength(dataBlock.body, 'utf8');
      add(findings, mode === 'interactive' && parsedData.value.length > MAX_INTERACTIVE_ROWS, 'ROW_LIMIT_EXCEEDED', 'Interactive presentation data exceeds 10,000 rows.');
      if (manifestData !== undefined) {
        add(findings, manifestData.embeddedBytes !== embeddedBytes || manifestData.presentedRows !== parsedData.value.length, 'MANIFEST_INVALID', 'Manifest data counts must exactly match the embedded presentation-data body.');
      }
      if (manifestValid && manifestObject !== undefined && spatialMode) {
        add(findings, !validSpatialRows(manifestObject, parsedData.value), 'MANIFEST_INVALID', 'Spatial presentation rows must match declared fields, CRS ranges, geometry structure, and exclusion disclosures.');
      }
    }
  } else if (manifestData !== undefined) {
    add(findings, manifestData.embeddedBytes !== 0 || dataBlocks.length > 0, 'MANIFEST_INVALID', 'Static dashboards must not embed a presentation-data block.');
  }

  const structure = validDocumentStructure(html);
  add(findings, !structure.doctype, 'DOCTYPE_MISSING', 'Dashboards require an HTML doctype.');
  add(findings, !structure.language, 'LANGUAGE_MISSING', 'Dashboards require a nonempty document language.');
  add(findings, !structure.charset, 'CHARSET_MISSING', 'Dashboards require a UTF-8 charset declaration.');
  add(findings, !structure.viewport, 'VIEWPORT_MISSING', 'Dashboards require a responsive device-width viewport.');
  add(findings, !structure.title, 'TITLE_MISSING', 'Dashboards require one nonempty document title.');
  add(findings, !structure.main, 'MAIN_INVALID', 'Dashboards require exactly one nonhidden main landmark.');
  add(findings, !structure.heading, 'HEADING_INVALID', 'Dashboards require exactly one nonhidden, nonempty level-one heading.');
  add(findings, hasCompanionResource(html) || hasMetaRefresh(html), 'REMOTE_RESOURCE', 'Dashboards must not load companion or remote resources when opened.');
  const executableScripts = executableScriptBodies(html);
  const eventHandlers = eventHandlerBodies(html);
  const executable = [...executableScripts, ...eventHandlers].join('\n');
  add(findings, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\.sendBeacon\s*\(|\bimport\s*\(/u.test(executable), 'NETWORK_API', 'Dashboard scripts must not use network APIs or dynamic imports.');
  const htmlProducingAssignment = /(?:\.\s*(?:innerHTML|outerHTML|srcdoc)|\[\s*(['"])(?:innerHTML|outerHTML|srcdoc)\1\s*\])\s*(?:\?\?=|\|\|=|&&=|\*\*=|>>>=|<<=|>>=|[+\-*/%&|^]=|=(?!=))/u;
  add(findings, eventHandlers.length > 0
    || hasUnsafeElement(html)
    || hasActiveUrl(html)
    || htmlProducingAssignment.test(executable)
    || /(?:javascript|vbscript):|data:text\/(?:html|xml)|\beval\s*\(|\bnew\s+Function\s*\(|(?:\?\.|\.)\s*(?:insertAdjacentHTML|setHTMLUnsafe|createContextualFragment|createHTMLDocument|parseHTMLUnsafe)\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(|\bDOMParser\b/u.test(executable), 'UNSAFE_CODE', 'Dashboards must not use executable URL schemes, HTML parsing or injection sinks, inline handlers, dynamic code, frames, objects, or embeds.');
  add(findings, !hasValidCsp(html, mode), 'CSP_INVALID', 'The dashboard requires the mode-constrained offline Content Security Policy directives.');
  add(findings, !validVisibleRegion(html, 'data-klopsi-summary'), 'SUMMARY_MISSING', 'Dashboards require one visible nonempty plain-language summary.');
  add(findings, !validVisibleRegion(html, 'data-klopsi-disclosures'), 'DISCLOSURES_MISSING', 'Dashboards require one visible nonempty transformation and reduction disclosure region.');
  add(findings, !validVisibleRegion(html, 'data-klopsi-lineage'), 'LINEAGE_MISSING', 'Dashboards require one visible nonempty source lineage and verification region.');
  add(findings, !hasAccessibleSvgs(html), 'SVG_ACCESSIBILITY_INVALID', 'Every SVG requires a role, title, description, and matching accessible references.');
  add(findings, mode === 'static' && (executableScripts.length > 0 || eventHandlers.length > 0), 'STATIC_SCRIPT_FORBIDDEN', 'Static dashboards must not contain executable scripts.');
  const interactiveStructure = mode === 'interactive' ? validInteractiveStructure(html) : undefined;
  add(findings, mode === 'interactive' && !interactiveStructure.filter, 'FILTER_REGION_MISSING', 'Interactive dashboards require a labeled region containing labeled native controls.');
  add(findings, mode === 'interactive' && !interactiveStructure.count, 'RECORD_COUNT_MISSING', 'Interactive dashboards require a visible polite live matching-record count.');
  add(findings, mode === 'interactive' && !interactiveStructure.table, 'DETAIL_TABLE_MISSING', 'Interactive dashboards require a semantic detail table with a header group and headers.');
  add(findings, mode === 'interactive' && !interactiveStructure.reset, 'RESET_MISSING', 'Interactive dashboards require a visible native reset button.');
  add(findings, mode === 'interactive' && !interactiveStructure.empty, 'EMPTY_STATE_MISSING', 'Interactive dashboards require a useful nonempty empty-state region.');
  add(findings, mode === 'interactive' && !interactiveStructure.noscript, 'NOSCRIPT_MISSING', 'Interactive dashboards require a useful noscript summary.');
  add(findings, hasTemplateMarker(html), 'TEMPLATE_MARKER_UNRESOLVED', 'Dashboard templates must not contain unresolved markers.');

  const boundedFindings = findings.slice(0, 100);
  const result = { valid: boundedFindings.length === 0, mode, findings: boundedFindings };
  output(result, result.valid ? 0 : 1, jsonRequested);
}

main().catch(() => {
  invalidInvocation('Dashboard verification failed before contract checks completed.', undefined, process.argv.includes('--json'));
});
`;

const RESOURCES = new Map<string, readonly AgentSkillResource[]>([
  [
    "klopsi-shared",
    [
      {
        path: "references/presentation-contract.md",
        content: PRESENTATION_CONTRACT,
      },
      {
        path: "scripts/verify-dashboard.mjs",
        content: DASHBOARD_VERIFIER_SOURCE,
      },
    ],
  ],
  [
    "klopsi-static-dashboard",
    [
      {
        path: "assets/static-board.html",
        content: STATIC_BOARD_TEMPLATE,
      },
      {
        path: "references/encoding-guide.md",
        content: STATIC_ENCODING_GUIDE,
      },
    ],
  ],
  [
    "klopsi-interactive-dashboard",
    [
      {
        path: "assets/interactive-dashboard.html",
        content: INTERACTIVE_DASHBOARD_TEMPLATE,
      },
      {
        path: "references/interaction-guide.md",
        content: INTERACTIVE_INTERACTION_GUIDE,
      },
    ],
  ],
]);

export function resourcesForAgentSkill(name: string): readonly AgentSkillResource[] {
  return RESOURCES.get(name) ?? [];
}
