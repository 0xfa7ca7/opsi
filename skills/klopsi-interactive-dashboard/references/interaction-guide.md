# Interactive dashboard interaction guide

The initial state must already answer the broad question. Add interaction to explore related aspects, not to conceal the only useful result.

## Allowed controls and single data flow

Use only labeled categorical filters, numeric ranges, date ranges, text search, sorting, selection, linked highlighting, tooltips with non-hover alternatives, focused drill-down, and Reset. Keep one in-memory state object and derive one filtered row set after every change. That same row set drives the matching count, all linked views, the semantic detail table, and the empty state.

Do not independently filter a chart or table. A visual selection may update shared state and then trigger the same full render flow. Keep total-record count fixed, update matching-record count immediately, and announce that count through the polite live region.

## Reset, keyboard, and focus

Use native inputs, selects, and buttons so filters, sorting, selection, and Reset work with the keyboard. Keep visible focus styles. Reset restores every filter, range, search term, sort order, selection, and drill-down to the documented initial state, rerenders all consumers, and moves focus to the first useful control. Never require page reload.

## Empty state and detail

When no rows match, show a meaningful empty state that names the situation and suggests Reset or broader filters. Keep the matching count, controls, and reset available. Do not leave a blank chart as the only signal.

The detail table uses real table headers and exposes the filtered result without pointer interaction. Sorting controls state the field and direction. If rendering every matching detail row would impair use, first reshape the presentation data through the analysis workflow; do not silently impose a display-only cap. Any bounded detail rows must have an explicit progressive disclosure control and matching-count explanation that makes omitted display rows discoverable without changing the underlying filtered set.

## Views, selection, and tooltip alternatives

Use two to four complementary views. Every view states its question, population, unit, relevant count, and takeaway. Pair linked highlighting with labels, patterns, or symbols so color is not the only signal. Any tooltip value must also be reachable by keyboard focus, selection text, an adjacent list, or the semantic detail table. Keep focused drill-down reversible and preserve a clear path back to the initial overview.

## Geography and disclosure

Map only valid embedded coordinates or geometry with a known CRS. Never geocode names, invent positions or outlines, infer a CRS, or load tiles. When spatial prerequisites are absent, use bars, a ranked list, heatmap, or semantic table.

Disclose each aggregation, projection, selection, exclusion, or sample with original and presented counts, rules, grouping fields, sample basis, and interpretive impact. State explicitly that a verifier pass is presentation evidence rather than official artifact provenance.
