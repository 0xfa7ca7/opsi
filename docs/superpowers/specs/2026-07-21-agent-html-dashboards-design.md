# Agent-Only HTML Dashboards Design

**Status:** Approved on 2026-07-21

## Summary

KLOPSI will add two agent-only workflow skills that turn prepared public-data artifacts into self-contained HTML presentations:

- `klopsi-static-dashboard` creates a single-page, print-friendly presentation board.
- `klopsi-interactive-dashboard` creates a client-side exploratory dashboard with bounded interactions.

The skills form the terminal presentation layer of the existing KLOPSI workflow. They do not duplicate catalogue discovery, resource access, validation, SQL analysis, WFS access, conversion, or provenance verification. When the source is not ready for presentation, the skills route the task back to the existing focused KLOPSI skill.

The first release remains agent-authored. It supplies contracts, starter templates, mode-specific guidance, and a contract verifier, but it does not add a KLOPSI visualization command or claim deterministic rendering. GitHub issue [#28](https://github.com/0xfa7ca7/klopsi/issues/28) tracks a later deterministic, CLI-backed renderer.

## Goals

- Install two presentation skills as part of the complete generated KLOPSI repertoire.
- Produce one portable HTML file that opens without a network connection.
- Support graphs, ranked lists, semantic tables, heatmaps, bullets, KPI summaries, and conditional maps.
- Preserve available verified source lineage and disclose all aggregation, sampling, and exclusions.
- Keep interactive artifacts responsive by bounding embedded presentation data.
- Give agents reusable templates and a verifier without moving rendering into the CLI.
- Preserve existing KLOPSI command ownership, safety, offline, and installation guarantees.

## Non-goals

- Hosted dashboards, application servers, or live data refresh.
- Remote scripts, styles, fonts, images, map tiles, telemetry, or analytics.
- Arbitrary user-supplied JavaScript or executable expressions.
- Automatic geocoding, guessed locations, or inferred coordinate reference systems.
- Replacing `klopsi-analysis`, `klopsi-services`, or `klopsi-provenance`.
- Official provenance for the generated HTML artifact in the agent-only release.
- Byte-deterministic HTML rendering in the agent-only release.

## User-facing workflow

The orchestrator will expose this ordered workflow:

```text
discover -> inspect -> download -> validate
    -> query/aggregate/export -> provenance verify
    -> choose presentation skill -> generate HTML -> verify HTML
```

The presentation skills accept a prepared local artifact or a bounded structured result that can be persisted as a local artifact. When an important result exists only in command output, the agent must persist it through a query or service export when KLOPSI supports that path, so KLOPSI can record and verify the source artifact before presentation.

The skills must route backwards instead of improvising when:

- malformed or inconsistent data requires `klopsi-validation`;
- row reduction, aggregation, joins, or derived measures require `klopsi-analysis`;
- a WFS layer needs bounded selection or export through `klopsi-services`;
- source integrity needs inspection through `klopsi-provenance`.

## Generated skill architecture

### Skill kinds

The generated-skill registry will distinguish four kinds:

- `router`: the top-level `klopsi` skill.
- `shared`: `klopsi-shared` and its common execution resources.
- `command`: a domain skill that owns one or more command-manifest entries.
- `workflow`: a commandless skill that composes existing skills and creates a user artifact.

Only `command` skills must own CLI commands. Every CLI command must continue to have exactly one command-skill owner. Router and shared skills remain commandless, and workflow skills must remain commandless. This keeps command coverage strict while allowing the two presentation workflows.

### Package contents

The generated repertoire will contain these additional resources:

```text
klopsi-shared/
  SKILL.md
  references/presentation-contract.md
  scripts/verify-dashboard.mjs

klopsi-static-dashboard/
  SKILL.md
  assets/static-board.html
  references/encoding-guide.md

klopsi-interactive-dashboard/
  SKILL.md
  assets/interactive-dashboard.html
  references/interaction-guide.md
```

`klopsi-shared` owns rules common to both modes. Each visualization skill remains thin and loads only its mode-specific template and reference. A focused presentation-skill installation therefore retains the existing requirement to install `klopsi-shared` alongside the selected domain skill.

### Nested resource generation

Skill generation will expand from a map of skill names to `SKILL.md` strings into a package model containing known relative files. The generator must:

- accept only normalized relative paths beneath the declared skill directory;
- reject absolute paths, `..` traversal, symbolic-link directories, symbolic-link files, and file/directory conflicts;
- create known directories as needed;
- atomically replace known generated files;
- preserve unrelated files and directories;
- generate identical bytes for identical versioned inputs;
- copy templates, references, and executable verifier resources during `agent setup`;
- preserve the existing structured result shape for skill count and skill names.

Checked-in packages under `skills/` and the generated skill index remain byte-for-byte derived from the registry and renderer.

## Shared presentation contract

### Artifact boundary

Each completed presentation is one self-contained HTML file with embedded CSS, presentation data, required geometry, and—only for interactive mode—JavaScript. Opening the artifact must not cause a network request.

The artifact may contain visible source citations as ordinary links, but it must not load remote resources through `script`, `link`, `img`, CSS URLs, fonts, frames, media, module imports, fetch APIs, or map-tile clients.

### Data limits

Interactive mode permits at most 10,000 prepared rows and 5 MB of normalized embedded presentation data. Static mode must embed only the aggregated values required by its visible views. In both modes, the complete HTML file must not exceed 15 MB, including markup, inline styles, inline scripts, data, and geometry.

The skills must never silently truncate. When the source exceeds a limit, the agent must:

1. return to `klopsi-analysis` for aggregation or a bounded projection;
2. use sampling only when aggregation cannot answer the requested question;
3. ask the user before sampling when it could materially change interpretation;
4. disclose the original count, presented count, method, grouping fields, exclusions, and sample basis.

### Source integrity and lineage

Before presentation, the skill must run `klopsi provenance verify` whenever an adjacent KLOPSI provenance record exists. Missing provenance does not permit invented lineage: the artifact must mark that source as unverified.

Each HTML artifact embeds one machine-readable JSON presentation manifest with this top-level shape:

```json
{
  "schemaVersion": "1",
  "mode": "static",
  "generator": "klopsi-agent-skill",
  "generatedAt": "2026-07-21T00:00:00.000Z",
  "title": "Example dashboard",
  "sources": [
    {
      "identity": "local path or canonical reference",
      "sha256": "verified or directly computed source digest",
      "verified": true,
      "provenancePath": "optional adjacent provenance path"
    }
  ],
  "transformations": [],
  "reductions": [],
  "data": {
    "originalRows": 0,
    "presentedRows": 0,
    "embeddedBytes": 0,
    "fields": []
  },
  "geography": {
    "kind": "none",
    "crs": null
  },
  "views": []
}
```

The detailed reference will define required and conditional fields. The manifest records evidence and disclosures; it is not a KLOPSI provenance sidecar and must not be described as one.

### Visual grammar

The skills choose an encoding from the analytical question and field semantics:

| Question | Preferred representation |
| --- | --- |
| Change over time | Line or area chart |
| Compare categories | Bars, lollipops, or ranked list |
| Show a distribution | Histogram or statistical summary table |
| Show a relationship | Scatter plot |
| Show two-dimensional intensity | Heatmap |
| Show exact small results | Semantic table or list |
| Show geography with valid spatial data | Point map or choropleth |

Every view must expose its question, population, units, relevant record count, and a plain-language takeaway. Color must not be the sole carrier of meaning. Decorative charts, unsupported causal claims, dual axes without a compelling reason, unlabeled scales, and fabricated precision are prohibited.

Maps require valid embedded coordinates or geometry plus known CRS information. Without both, the skill must select a ranked table, bar chart, or another non-map representation. The skill must not geocode, guess coordinates, infer CRS, or fetch tiles.

## Static-board contract

`klopsi-static-dashboard` creates a single-page, responsive presentation board that remains meaningful with JavaScript disabled. Executable JavaScript is not required; the embedded JSON presentation manifest may use a non-executable script element.

The board contains:

- title, scope, source, and reporting period;
- three to five headline findings or KPI summaries;
- two to six complementary visual sections;
- explanatory bullets adjacent to their supporting visual;
- method, aggregation, missing-data, and sampling notes;
- source verification and lineage details;
- a print stylesheet that preserves reading order and avoids clipped visuals.

Visuals use semantic HTML, CSS, and inline SVG. The template provides a restrained grid, typography, color tokens, accessible focus styles for links, reusable card structure, print rules, and placeholders that agents must fully replace or remove.

## Interactive-dashboard contract

`klopsi-interactive-dashboard` creates a self-contained dashboard whose initial state already answers the broad user question. Interaction progressively exposes additional aspects; it must not hide the only useful interpretation behind controls.

The dashboard contains:

- title, scope, source, reporting period, and concise initial summary;
- a compact filter region and one-click reset;
- two to four linked visual views;
- visible matching-record and total-record counts;
- a searchable and sortable detail table;
- clear selection, highlighting, tooltip, and focused drill-down behavior;
- explicit empty states;
- definitions, reduction disclosures, and source lineage;
- a `noscript` explanation and static summary.

Supported interaction is limited to categorical filters, numeric ranges, date ranges, text search, sorting, selection, highlighting, tooltips, focused drill-down, and reset. State remains in memory. The artifact must not use remote calls, telemetry, hidden persistence, arbitrary expressions, `eval`, or `new Function`.

Controls must be keyboard accessible, visibly labeled, and reflected in the matching-record count. Reset must restore the documented initial state. The detail table must retain semantic headers and expose the filtered result without requiring pointer interaction.

## Contract verifier

`verify-dashboard.mjs` is a dependency-free Node.js contract linter. It does not render HTML, execute untrusted code, sanitize arbitrary HTML, or claim that a passing artifact is secure against every browser behavior.

It will accept an HTML path and expected mode, return a nonzero status for violations, and support a bounded structured result suitable for agent inspection. Checks include:

- regular-file input, byte ceiling, HTML doctype, language, character set, viewport, and title;
- required heading, main content, summary, disclosures, and presentation manifest;
- valid manifest JSON, schema version, mode, sources, counts, reductions, fields, geography, and views;
- embedded-data byte and row limits;
- absence of remote resource attributes, CSS URLs, imports, and known network APIs;
- absence of `eval`, `new Function`, frames, embedded objects, and executable user data;
- presence of a content-security policy that disables connections and embedded objects;
- safely embedded JSON that cannot terminate its containing element;
- labels, table headers, keyboard-operable controls, visible reset, and empty-state content where required;
- absence of executable JavaScript in static mode apart from non-executable data blocks;
- interactive-mode script, filter, record-count, detail-table, reset, and `noscript` requirements;
- unresolved template markers.

The verifier should report all bounded findings in one run so an agent can repair the artifact without repeated single-error cycles.

## Failure behavior

| Condition | Required response |
| --- | --- |
| Invalid or inconsistent source | Stop and route to `klopsi-validation`. |
| Excessive rows or embedded bytes | Stop and route to `klopsi-analysis` for projection or aggregation. |
| Ambiguous units, population, or time semantics | Disclose the ambiguity or ask before creating a potentially misleading view. |
| Missing geometry or CRS | Use a non-map representation. |
| Missing provenance sidecar | Mark source verification as unavailable; do not invent provenance. |
| Provenance verification failure | Preserve and report the integrity failure; do not create a final dashboard from that source. |
| Empty filtered state | Show a clear empty state and keep reset available. |
| Contract-verifier failure | Repair and re-run; do not hand off the artifact as complete. |

## Testing strategy

### Skill behavior evaluations

The two skills will be written using RED-GREEN-REFACTOR behavior evaluations. The approved design authorizes fresh isolated subagent runs for these evaluations during implementation.

Baseline agents without the new skills will receive scenarios covering:

- a static board from verified data with incomplete units;
- an oversized interactive dataset;
- a map request without geometry or CRS;
- source strings containing HTML and script-like content;
- a local input without provenance;
- pressure to use a CDN, silent truncation, or remote tiles.

Observed failures and rationalizations will drive the minimal skill instructions. The same scenarios will run with each skill loaded, followed by revisions and re-evaluation until the contract is applied consistently.

### Automated tests

Tests will cover:

- valid and invalid skill kinds;
- exact command ownership and commandless workflow skills;
- complete orchestrator routes and related-skill links;
- deterministic nested package rendering;
- safe relative-path validation and symlink rejection;
- idempotent replacement of known files and preservation of unrelated files;
- verifier execution through the installed Node.js runtime without requiring executable file permissions;
- complete resource copying through `generate-skills` and `agent setup`;
- byte-for-byte checked-in/generated skill package equality;
- valid static and interactive verifier fixtures;
- malformed manifests, unsafe JSON embedding, remote resources, network APIs, forbidden code, unresolved template markers, excessive data, absent disclosures, and inaccessible controls;
- package, typecheck, lint, unit, integration, CLI end-to-end, and packed-artifact contracts.

Manual browser checks will cover responsive layout, print layout, keyboard navigation, filtering, selection, sorting, reset, empty states, and offline loading.

## Documentation and release

The change will update:

- orchestrator routing and the acquire/analyze/present workflow;
- `klopsi-shared` presentation guidance;
- the generated skill index;
- generated checked-in skill packages;
- relevant installation and command documentation where nested resources change behavior;
- release notes through a changeset.

The implementation will be delivered on a `codex/` feature branch with focused commits and a pull request. The PR will link backlog issue #28 and state clearly that v1 is agent-authored and contract-verified, not deterministically CLI-rendered.
