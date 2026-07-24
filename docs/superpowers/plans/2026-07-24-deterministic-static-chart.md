# Deterministic Static Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded `klopsi chart` experiment that publishes deterministic, accessible, no-JavaScript HTML/SVG charts with verifiable provenance.

**Architecture:** A thin command adapter asks the existing query service for two explicitly quoted columns in staged source order. A pure renderer normalizes and encodes bounded points, while a separate publisher writes and transactionally publishes the HTML/provenance pair.

**Tech Stack:** TypeScript 6, Node.js 24 filesystem/crypto APIs, Commander 15, existing KLOPSI QueryService, `@klopsi/storage` paired publication, Vitest 4.

## Global Constraints

- Support only `bar` and `line`.
- Require explicit x, y, type, and `.html` output.
- Default to 100 points and reject limits above 500.
- Preserve staged source order; do not aggregate, sample, interpolate, or sort by value.
- Emit fixed inline HTML/CSS/SVG with no JavaScript or runtime network dependency.
- Encode every dynamic value before HTML/SVG insertion.
- Publish HTML and derived provenance as one transactional pair.
- Keep this an experimental partial step toward issue #28.

---

### Task 1: Pure chart normalization and rendering

**Files:**
- Create: `apps/cli/src/chart/render.ts`
- Test: `apps/cli/test/chart-render.test.ts`

**Interfaces:**
- Produces: `ChartType = "bar" | "line"`
- Produces: `normalizeChartPoints(rows, x, y): readonly ChartPoint[]`
- Produces: `renderChartHtml(input: ChartRenderInput): string`
- Produces: `CHART_RENDERER_VERSION = "1"`

- [ ] **Step 1: Write failing normalization tests**

Add tests that import the missing API, preserve row order, convert strict numeric strings, and reject empty/null/Boolean/object/non-finite y values with `CHART_NON_NUMERIC_Y`. Add an empty-row assertion for `CHART_EMPTY`.

```ts
expect(normalizeChartPoints([{ category: "b", value: "2" }, { category: "a", value: -1 }], "category", "value"))
  .toEqual([{ label: "b", value: 2 }, { label: "a", value: -1 }]);
expect(() => normalizeChartPoints([{ category: "x", value: "nope" }], "category", "value"))
  .toThrowError(expect.objectContaining({ code: "CHART_NON_NUMERIC_Y" }));
```

- [ ] **Step 2: Run the test and observe RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/chart-render.test.ts
```

Expected: failure because `../src/chart/render.js` does not exist.

- [ ] **Step 3: Implement minimal normalization**

Create the exported types and strict conversion:

```ts
function numeric(value: unknown, row: number, column: string): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
  if (!Number.isFinite(normalized)) throw chartNonNumeric(row, column);
  return normalized;
}
```

Labels use `""` for null and `String(value)` only for primitive string/number/bigint/Boolean/Date values. Nested x values use deterministic `JSON.stringify`.

- [ ] **Step 4: Run normalization tests and observe GREEN**

Run the focused unit command. Expected: all normalization tests pass.

- [ ] **Step 5: Write failing renderer tests**

Add assertions for:

- deterministic exact equality across two calls;
- inline `<svg role="img">`, `<title>`, `<desc>`, axes, four grid intervals, and semantic table;
- different bar/line geometry;
- negative values and zero baseline;
- escaped malicious title/columns/labels such as `</title><script>alert(1)</script>`;
- no `<script`, event handler, `http:`, `https:`, protocol-relative URL, CDN, or runtime data dependency;
- truncation/source-order disclosure;
- complete labels in the table when SVG labels are visually shortened.

- [ ] **Step 6: Run renderer tests and observe RED**

Run the focused unit command. Expected: missing `renderChartHtml`.

- [ ] **Step 7: Implement deterministic renderer**

Use fixed constants:

```ts
const WIDTH = 960;
const HEIGHT = 480;
const PLOT = { left: 84, right: 28, top: 34, bottom: 104 };
const TICKS = 4;
```

Implement one `escapeText`, fixed decimal formatting, y-domain including zero, source-order categorical x placement, bars from the zero baseline, line polyline/circles, `<title>` per mark, and a semantic table. Return one fixed document ending in `\n`.

- [ ] **Step 8: Run renderer tests and observe GREEN**

Run the focused unit command. Expected: all chart renderer tests pass without warnings.

---

### Task 2: Transactional artifact and provenance publisher

**Files:**
- Create: `apps/cli/src/chart/publish.ts`
- Test: `apps/cli/test/chart-publish.test.ts`

**Interfaces:**
- Consumes: `publishArtifactPair(stagedArtifact, stagedSidecar, destination, options)`
- Produces: `publishChart(input): Promise<{output, provenancePath, sha256, bytes}>`

- [ ] **Step 1: Write failing publisher tests**

Use temporary input/output files. Assert:

```ts
await publishChart({ source, output, html, force: false, transformation });
await expect(new ProvenanceStore().verify(output)).resolves.toMatchObject({ valid: true });
await expect(publishChart({ source, output, html: changed, force: false, transformation }))
  .rejects.toMatchObject({ code: "CHART_DESTINATION_EXISTS" });
```

Also assert forced replacement updates both files, the sidecar records operation `chart`, input digest and renderer details, and a `.html` suffix is required before staging.

- [ ] **Step 2: Run publisher tests and observe RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/chart-publish.test.ts
```

Expected: failure because `../src/chart/publish.js` does not exist.

- [ ] **Step 3: Implement publication**

Resolve the output, reject non-`.html`, create unique staged paths in the destination directory, write/fsync HTML mode `0600`, digest source and output with streaming SHA-256, write/fsync a schema-version-1 derived sidecar, and call:

```ts
publishArtifactPair(temp, provenanceTemp, destination, {
  force,
  existsCode: "CHART_DESTINATION_EXISTS",
  existsExitCode: EXIT_CODES.INVALID_INPUT,
});
```

Remove both staged paths on every failure.

- [ ] **Step 4: Run publisher tests and observe GREEN**

Run the focused unit command. Expected: all publication/provenance tests pass.

---

### Task 3: CLI command, manifest, and E2E behavior

**Files:**
- Create: `apps/cli/src/commands/chart.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/test/complete-surface.e2e.test.ts`
- Create: `apps/cli/test/chart.e2e.test.ts`

**Interfaces:**
- Consumes: `KlopsiClient.query.execute`, `normalizeChartPoints`, `renderChartHtml`, `publishChart`
- Produces: registered leaf `chart`
- Produces success record `{output, provenancePath, type, x, y, points, limit, truncated, order}`

- [ ] **Step 1: Write failing manifest/surface test**

Add `chart` to the expected command surface and command-adapter list. Assert the manifest declares:

```ts
leaf("chart", "Render a bounded offline HTML/SVG chart", [argument("<input>", "...")], [
  option("--x <column>", "...", { mandatory: true }),
  option("--y <column>", "...", { mandatory: true }),
  option("--type <type>", "...", { choices: ["bar", "line"], mandatory: true }),
  option("--output <path>", "...", { mandatory: true }),
  option("--title <text>", "..."),
  option("--limit <points>", "...", { parser: "positive", defaultValue: 100 }),
  option("--force", "..."),
  ...NETWORK_OPTIONS,
]);
```

- [ ] **Step 2: Run surface test and observe RED**

Run:

```bash
pnpm exec vitest run --project cli-e2e apps/cli/test/complete-surface.e2e.test.ts
```

Expected: `chart` is absent.

- [ ] **Step 3: Add manifest and registration shell**

Register the manifest leaf, import/register `registerChartCommand` from `program.ts`, and add an adapter that initially throws `CHART_NOT_IMPLEMENTED`.

- [ ] **Step 4: Run surface test and observe GREEN**

Run the focused surface command. Expected: manifest and registered Commander metadata match.

- [ ] **Step 5: Write failing chart E2E tests**

Build and execute the real CLI against temporary CSV fixtures. Cover:

- bar and line success;
- `--json` stable result shape and human result;
- deterministic HTML bytes across distinct output paths;
- source order and first-N truncation;
- limit 501 rejection;
- missing x/y column query failure;
- non-numeric y and empty input failure;
- malicious title/label/column escaping;
- no script/network/runtime reference;
- existing artifact or sidecar refusal and `--force` replacement;
- `provenance verify` success;
- command help contains every option.

- [ ] **Step 6: Run E2E tests and observe RED**

Run:

```bash
pnpm build
pnpm exec vitest run --project cli-e2e apps/cli/test/chart.e2e.test.ts
```

Expected: failures from `CHART_NOT_IMPLEMENTED`.

- [ ] **Step 7: Implement command adapter**

Quote identifiers with:

```ts
function sqlIdentifier(value: string): string {
  if (value.includes("\0")) throw invalidColumn();
  return `"${value.replaceAll('"', '""')}"`;
}
```

Execute:

```ts
const sql =
  `WITH "__klopsi_chart_source" AS (` +
  `SELECT row_number() OVER () AS "__klopsi_order", ` +
  `${sqlIdentifier(x)} AS "__klopsi_x", ${sqlIdentifier(y)} AS "__klopsi_y" FROM data) ` +
  `SELECT "__klopsi_x", "__klopsi_y" FROM "__klopsi_chart_source" ` +
  `ORDER BY "__klopsi_order"`;
const result = await client.query.execute(input, { sql, limit, ...resolutionOptions });
```

Validate `limit <= 500`, normalize rows, render HTML, publish pair, emit warnings unless quiet, then write the stable record through `context.renderer`.

- [ ] **Step 8: Run E2E tests and observe GREEN**

Build and run chart E2E plus surface E2E. Expected: all pass.

---

### Task 4: Documentation, release note, and complete verification

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Add: `.changeset/deterministic-static-chart.md`

**Interfaces:**
- Documents the exact experimental CLI and relationship to issue #28.
- Does not change SDK exports or claim full dashboard support.

- [ ] **Step 1: Write documentation contract assertions**

Extend the chart E2E or release contract to require all three docs to contain `klopsi chart`, `bar|line`, offline/no-JavaScript wording, 100/500 bounds, source-order/truncation behavior, `--force`, and `provenance verify`.

- [ ] **Step 2: Run the contract test and observe RED**

Run the focused test. Expected: documentation strings are absent.

- [ ] **Step 3: Update docs and changeset**

Add one concise README example, full CLI README syntax, a command-reference section with errors/bounds/security/provenance, and a minor changeset for package `klopsi` describing the experiment.

- [ ] **Step 4: Run focused tests and formatting**

Run:

```bash
pnpm exec prettier --write \
  apps/cli/src/chart apps/cli/src/commands/chart.ts \
  apps/cli/test/chart-render.test.ts apps/cli/test/chart-publish.test.ts \
  apps/cli/test/chart.e2e.test.ts apps/cli/src/program.ts \
  apps/cli/src/command-manifest.ts apps/cli/test/complete-surface.e2e.test.ts \
  README.md apps/cli/README.md docs/commands.md \
  docs/superpowers/specs/2026-07-24-deterministic-static-chart-design.md \
  docs/superpowers/plans/2026-07-24-deterministic-static-chart.md \
  .changeset/deterministic-static-chart.md
pnpm exec vitest run --project unit apps/cli/test/chart-render.test.ts apps/cli/test/chart-publish.test.ts
pnpm build
pnpm exec vitest run --project cli-e2e apps/cli/test/chart.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts
```

Expected: all focused checks pass.

- [ ] **Step 5: Run full repository verification**

Run:

```bash
pnpm check
```

Expected: formatting, lint, typecheck/build, unit, integration, E2E, and pack checks pass. If the known baseline query/dashboard timing assertions fail only under concurrent load, rerun the exact failures serially and report both outputs without weakening their tests.

- [ ] **Step 6: Review scope and security**

Inspect:

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
rg -n "<script|https?://|on[a-z]+=" apps/cli/src/chart apps/cli/test/chart*
```

Confirm every acceptance criterion in the design has code, test, or documentation evidence, and confirm no unrelated files changed.

- [ ] **Step 7: Commit, push, and create draft PR**

Use conventional commits, push `codex/experiment-static-chart`, and create a draft PR to `main`. The PR body must explain research, partial relationship to issue #28, UX, architecture, security/determinism/accessibility, benefits, limitations, validation, open questions, and reviewer checklist.
