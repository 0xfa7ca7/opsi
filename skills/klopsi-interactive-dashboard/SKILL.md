---
name: klopsi-interactive-dashboard
description: "Use when prepared Slovenian public data needs a self-contained interactive HTML dashboard with filters, linked charts, maps, heatmaps, search, sorting, drill-down, or exploratory detail."
---

# klopsi-interactive-dashboard

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before creating an artifact.

Turn a bounded prepared local artifact into one offline exploratory HTML file whose useful initial overview and linked interactions share a single in-memory data flow. Generated for `klopsi` 0.0.1.

## Workflow

- Verify and bound the prepared source, copy the interactive template to a new HTML destination, replace every marker, embed safe normalized data and the presentation manifest, verify the dashboard, and hand off its absolute path.

## Capability guide

### Verify and prepare the source

- Read `../klopsi-shared/references/presentation-contract.md`. Start from a prepared local artifact and retain its exact identity and SHA-256 digest. Check for `<artifact>.provenance.json`; when it exists, run `klopsi provenance verify <artifact> --json` and stop on failure. When it does not exist, mark the source `verified: false` without inventing lineage.
- Route invalid input to `klopsi-validation`, reshaping or aggregation to `klopsi-analysis`, and bounded WFS selection or export to `klopsi-services`. Create a map only from valid embedded coordinates or geometry with a known CRS; otherwise choose a non-map view.

### Bound and disclose embedded presentation data

- Normalize the prepared rows to JSON and measure the exact UTF-8 presentation-data script body before authoring. Block when it exceeds 10,000 rows, 5 MB, or would make the complete HTML exceed 15 MB; never use a companion file, live query, or browser file picker to evade these limits.
- Do not silently truncate. Return to `klopsi-analysis` or `klopsi-services` for a deliberate aggregation, projection, or bounded selection. Use sampling only when aggregation cannot answer the question and ask first when it could change interpretation. Record and visibly disclose original and presented counts, method, grouping fields, exclusions, sample basis, and interpretive impact.

### Compose a useful initial overview

- Read `references/interaction-guide.md`. Copy `assets/interactive-dashboard.html` to a new destination without overwriting an existing file without authorization, replace every `{{MARKER}}`, and remove optional sections rather than leaving markers.
- Make the documented initial state answer the broad question before interaction. Include a concise summary, visible matching and total counts, two to four complementary linked views, a semantic detail table, definitions, reduction disclosures, lineage, and a useful static `noscript` summary.
- Serialize exactly one manifest and one presentation-data JSON block, escaping every less-than character as `\u003c`. Render every data-derived label, cell, summary, and tooltip alternative with DOM methods and `textContent`, never data-concatenated markup.

### Drive every linked view from one filtered result

- Keep one `state` object in memory. On each filter, search, range, sort, selection, or reset change, derive one filtered row array and pass it to counts, every linked view, the detail table, and the empty state so they cannot disagree.
- Use visibly labeled native controls and buttons, preserve keyboard operation and visible focus, provide one-click reset to the documented initial state, keep the matching count in an `aria-live="polite"` region, and retain reset plus a meaningful message when no rows match.

### Verify and hand off

- Keep the result one self-contained offline HTML file. Use no CDN, remote script, stylesheet, font, image, tile, API, telemetry, network constructor, dynamic import, browser storage, arbitrary expression, inline event handler, `eval`, or `new Function`.
- Run `node ../klopsi-shared/scripts/verify-dashboard.mjs <dashboard.html> --mode interactive --json`, repair every finding, then review the useful initial state, linked counts and views, keyboard order, reset, sorting, empty state, responsive layout, and offline opening before handoff.
- Hand off the absolute HTML path, verifier JSON, exact embedded row and byte counts, reduction disclosure when applicable, and source-verification status. A verifier pass is presentation evidence, not official artifact provenance.

## Safety

- Do not claim provenance from a presentation-verifier pass; use `provenance verify` for provenance claims.
- Do not fabricate geography, units, precision, causal claims, verification, lineage, or reduction details.

## Related skills

- [klopsi-analysis](../klopsi-analysis/SKILL.md)
- [klopsi-services](../klopsi-services/SKILL.md)
- [klopsi-provenance](../klopsi-provenance/SKILL.md)
