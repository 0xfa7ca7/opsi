---
name: klopsi-static-dashboard
description: "Use when prepared Slovenian public data needs a concise static HTML dashboard, presentation board, printable visual summary, chart panel, heatmap, ranked list, or offline map."
---

# klopsi-static-dashboard

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before creating an artifact.

Turn a prepared local artifact into a self-contained semantic HTML and inline-SVG board that remains useful offline and without JavaScript. Generated for `klopsi` 0.0.1.

## Workflow

- Verify the prepared source, select honest encodings, copy the static template to a new HTML destination, replace every marker, embed the presentation manifest, verify the board, and hand off its absolute path.

## Capability guide

### Verify and prepare the source

- Read `../klopsi-shared/references/presentation-contract.md`. Start from a prepared local artifact and retain its exact identity and SHA-256 digest. Check for `<artifact>.provenance.json`; when it exists, run `klopsi provenance verify <artifact> --json` and stop on failure. When it does not exist, mark the source `verified: false` without inventing lineage.
- Route validation failures to `klopsi-validation`, reshaping or aggregation to `klopsi-analysis`, and bounded WFS selection or export to `klopsi-services` before presentation. Do not silently truncate, guess units, relabel measures, or hide missing-data and source limitations.

### Choose evidence-matched encodings

- Read `references/encoding-guide.md`; select each view from its analytical question and record its question, population, unit, relevant count, and plain-language takeaway in both the board and manifest.
- Create a map only from valid embedded coordinates or geometry with a known CRS. Never invent outlines, positions, boundaries, or a CRS; use a ranked list, bars, or a semantic table when spatial prerequisites are absent.

### Compose the static board

- Copy `assets/static-board.html` to a new destination; do not overwrite an existing file without authorization. Replace every `{{MARKER}}` with escaped, data-grounded content, and remove optional sections entirely instead of leaving markers.
- Keep three to five KPI cards, two to six complementary view cards, adjacent interpretation, a semantic exact-values table, visible disclosures, and lineage. Preserve script-like source strings as text and never concatenate them into markup.
- Write exactly one inert `klopsi-presentation-manifest` JSON block. Escape every less-than character as `\u003c`, describe all transformations and ordered reductions, and keep visible disclosures consistent with the manifest. For a non-map board, set `embeddedBytes` to `0` and omit presentation data. For a spatial board, add one inert `klopsi-presentation-data` block containing only the validated map rows and set its exact bytes and count in the manifest.

### Verify and hand off

- Keep the result one self-contained offline HTML file with inline styles and SVG only: no executable JavaScript, CDN, remote font, image, tile, stylesheet, script, API, or companion data file.
- Respect the 15 MB HTML limit and the shared 5 MB embedded-data and 10,000-row interactive limits. Static mode uses no executable JavaScript. It embeds aggregate display values in semantic HTML or SVG; only a valid spatial view may also use the inert spatial presentation-data evidence required by the shared contract. Do not silently truncate; disclose every aggregation, projection, exclusion, or sample.
- Run `node ../klopsi-shared/scripts/verify-dashboard.mjs <dashboard.html> --mode static --json`, repair every finding, review the rendered reading order and print layout, then hand off the absolute HTML path with the verifier JSON and source-verification status.

## Safety

- Do not claim provenance from a presentation-verifier pass; use `provenance verify` for provenance claims.
- Do not fabricate geography, units, precision, causal claims, verification, or lineage.

## Related skills

- [klopsi-analysis](../klopsi-analysis/SKILL.md)
- [klopsi-services](../klopsi-services/SKILL.md)
- [klopsi-provenance](../klopsi-provenance/SKILL.md)
