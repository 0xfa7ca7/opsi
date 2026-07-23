# Static dashboard encoding guide

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

Use the template's named palette—blue, cyan, green, amber, orange, magenta, and violet—to give KPI and view cards clear visual hierarchy. Reuse the `accent-*`, `mark-*`, `legend`, `legend-swatch`, `heatmap`, and `heat-cell` classes instead of inventing unrelated colors for each board.

Do not use color as the only information carrier. Pair color with position, length, pattern, labels, or symbols; preserve readable contrast in screen and print output. Use categorical colors only for distinct groups, a perceptually ordered sequential scale for magnitude, and an explicitly centered diverging scale only when a meaningful midpoint exists. Provide a labeled legend whenever color encodes data. Keep exact values adjacent and verify that borders, labels, and chart structure remain legible in grayscale print.
