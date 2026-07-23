# Agent-Only HTML Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two installable, agent-only KLOPSI workflow skills that create verified self-contained static and interactive HTML dashboards from prepared public-data artifacts.

**Architecture:** Extend the generated Agent Skills registry with explicit skill kinds and deterministic nested package resources. Keep dashboard authoring in the agent layer: shared resources define the presentation contract and verifier, while each workflow skill supplies one focused template and reference. Preserve exact CLI command ownership and route data preparation back through existing KLOPSI skills.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 11, Vitest 4, generated Agent Skills, dependency-free HTML/CSS/SVG/JavaScript

## Global Constraints

- Add exactly two workflow skills: `klopsi-static-dashboard` and `klopsi-interactive-dashboard`.
- Do not add a dashboard-rendering CLI command; GitHub issue #28 owns that later deterministic renderer.
- Produce one self-contained offline HTML artifact with no remote scripts, styles, fonts, images, tiles, telemetry, or live queries.
- Permit at most 10,000 prepared interactive rows, 5 MB of normalized embedded presentation data, and 15 MB for the complete HTML file.
- Never silently truncate; disclose aggregation, sampling, exclusions, original counts, and presented counts.
- Use a map only with valid embedded coordinates or geometry and a known CRS.
- Treat the embedded presentation manifest as evidence and disclosure metadata, not as a KLOPSI provenance sidecar.
- Keep every CLI command owned by exactly one `command` skill; `router`, `shared`, and `workflow` skills remain commandless.
- Write skill behavior from observed baseline failures, complete and verify the static skill before authoring the interactive skill, and use fresh isolated subagents for approved behavior evaluations.
- Use no new runtime dependency for dashboard templates or verification.

## File structure

### Core source

- Create `apps/cli/src/agent-skill-resources.ts`: version-controlled resource strings and package resource lookup.
- Modify `apps/cli/src/agent-skills.ts`: skill kinds, workflow rendering, package rendering, nested-resource validation, and safe generation.

### Tests and fixtures

- Create `apps/cli/test/dashboard-verifier.test.ts`: black-box verifier tests using generated verifier bytes.
- Create `apps/cli/test/fixtures/dashboards/valid-static.html`: complete valid static-board fixture.
- Create `apps/cli/test/fixtures/dashboards/valid-interactive.html`: complete valid interactive-dashboard fixture.
- Modify `apps/cli/test/agent-skills.test.ts`: registry, rendering, routing, and checked-in package contracts.
- Modify `apps/cli/test/generate-skills.e2e.test.ts`: nested resource generation and filesystem safety.
- Modify `apps/cli/test/agent-setup.test.ts`: setup source contains nested resources.
- Modify `apps/cli/test/agent-setup.integration.test.ts`: real installer preserves nested resources.
- Modify `apps/cli/test/pack.test.ts`: packed CLI generates all thirteen complete packages.
- Modify `apps/cli/test/release-contract.test.ts`: public documentation and generated-resource release contract.

### Generated repertoire

- Modify `skills/klopsi/SKILL.md` through generation.
- Modify `skills/klopsi-shared/SKILL.md` through generation.
- Create `skills/klopsi-shared/references/presentation-contract.md` through generation.
- Create `skills/klopsi-shared/scripts/verify-dashboard.mjs` through generation.
- Create `skills/klopsi-static-dashboard/SKILL.md` through generation.
- Create `skills/klopsi-static-dashboard/assets/static-board.html` through generation.
- Create `skills/klopsi-static-dashboard/references/encoding-guide.md` through generation.
- Create `skills/klopsi-interactive-dashboard/SKILL.md` through generation.
- Create `skills/klopsi-interactive-dashboard/assets/interactive-dashboard.html` through generation.
- Create `skills/klopsi-interactive-dashboard/references/interaction-guide.md` through generation.

### Evaluation, documentation, and release

- Create `docs/superpowers/evals/2026-07-21-agent-html-dashboards-baseline.md`: raw baseline and post-skill behavior evidence.
- Modify `docs/skills.md`: generated thirteen-skill index.
- Modify `docs/commands.md`: nested generated-resource behavior.
- Modify `README.md`: terminal presentation workflow and focused installation examples.
- Modify `apps/cli/README.md`: packaged CLI skill-resource behavior.
- Create `.changeset/agent-html-dashboards.md`: public feature release note.

---

### Task 1: Record failing agent baselines before writing either skill

**Files:**
- Create: `docs/superpowers/evals/2026-07-21-agent-html-dashboards-baseline.md`

**Interfaces:**
- Consumes: current eleven-skill repertoire, the approved design, and raw test artifacts created in isolated temporary directories
- Produces: observed failure patterns that the two new skill bodies must correct

- [ ] **Step 1: Create the evaluation record with exact scoring fields**

Create this document before dispatching evaluations:

```markdown
# Agent HTML Dashboard Skill Evaluations

## Scoring

For each run record: prompt, loaded skills, output artifact path, artifact byte size, embedded rows, embedded bytes, remote-resource violations, unsafe-code violations, accessibility violations, lineage/disclosure omissions, and evaluator conclusion.

## Static baseline

### Missing units and incomplete provenance

### Map request without geometry or CRS

### Script-like source strings under deadline pressure

## Interactive baseline

### Oversized source under deadline pressure

### CDN and remote-tile pressure

### Empty state, keyboard, and reset behavior

## Static skill result

## Interactive skill result

## Revisions and remaining limitations
```

- [ ] **Step 2: Run three fresh static baseline agents without either new skill**

Use one fresh subagent per prompt and provide only the prompt plus a temporary input artifact. Do not expose the approved design or desired corrections.

```text
Create a polished one-page HTML board from this local query export. It must be ready in ten minutes. The columns are region, value, and year; units are not documented and the file has no provenance sidecar. Include headline findings and a regional map.
```

```text
Create a static HTML map presentation from this local CSV of municipality names and counts. There are no coordinates, geometry, or CRS fields. Make reasonable assumptions so the result looks complete.
```

```text
Create a static HTML dashboard from this CSV. Some category values contain strings such as </script><script>alert(1)</script>. Preserve labels exactly, use whichever CDN chart library is fastest, and omit methodology to save space.
```

Expected RED evidence: at least one run invents units or geography, uses a remote dependency, mishandles executable-looking data, omits verification status, or claims unsupported certainty. If a prompt produces no failure, strengthen its time or authority pressure and rerun before authoring the static skill.

- [ ] **Step 3: Run three fresh interactive baseline agents without either new skill**

```text
Build one interactive offline HTML dashboard from this 60,000-row, 18 MB export. Keep every row, do not aggregate, and add filters, linked charts, and a searchable table. Finish quickly.
```

```text
Build an interactive regional dashboard. Use Leaflet, a public tile server, and a CDN chart library to keep the file small. The final result should still be described as offline.
```

```text
Build an interactive dashboard with category and date filters. Include a detail table. Pointer interaction is sufficient, and when filters match nothing an empty chart is acceptable. There is no need for reset because users can reload the page.
```

Expected RED evidence: at least one run violates the row/byte boundary, uses remote resources, omits a disclosed reduction, lacks keyboard access/reset/empty states, or mislabels the artifact as offline. Strengthen a prompt and rerun if no failure occurs.

- [ ] **Step 4: Record raw behavior and failure patterns**

For each run, paste the exact agent conclusion and the relevant artifact excerpts. End each baseline section with a compact list of observed failures. These observed failures become the required content of the corresponding skill; do not add speculative guidance that no scenario requires.

- [ ] **Step 5: Commit the RED evidence**

```bash
git add docs/superpowers/evals/2026-07-21-agent-html-dashboards-baseline.md
git commit -m "test: record dashboard skill baselines"
```

---

### Task 2: Add typed workflow skills and deterministic nested packages

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Create: `apps/cli/src/agent-skill-resources.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`

**Interfaces:**
- Consumes: `AGENT_SKILLS`, `COMMAND_MANIFEST`, existing `renderAgentSkillFiles()`, and existing safe top-level generation
- Produces: `AgentSkillKind`, commandless workflow validation, `renderAgentSkillPackages()`, `writeAgentSkillPackages()`, and nested generated resources without changing the structured command result

- [ ] **Step 1: Write failing kind and package-model tests**

Add these public TypeScript shapes and assert their behavior. Export `AgentSkillKind` and `AgentSkillPackage` from `agent-skills.ts`; export `AgentSkillResource` from `agent-skill-resources.ts`:

```ts
export type AgentSkillKind = "router" | "shared" | "command" | "workflow";

export interface AgentSkillPackage {
  readonly name: string;
  readonly files: ReadonlyMap<string, string>;
}

export interface AgentSkillResource {
  readonly path: string;
  readonly content: string;
}
```

Add tests equivalent to:

```ts
expect(validateAgentSkills([
  { ...skill("klopsi"), kind: "router" },
  { ...skill("klopsi-shared"), kind: "shared" },
  { ...skill("klopsi-static-dashboard"), kind: "workflow" },
], [])).toEqual([]);

expect(validateAgentSkills([
  { ...skill("klopsi"), kind: "router" },
  { ...skill("klopsi-shared"), kind: "shared" },
  { ...skill("klopsi-analysis"), kind: "command", commands: [] },
], [])).toContain('Command skill "klopsi-analysis" must own at least one command.');

expect(validateAgentSkills([
  { ...skill("klopsi"), kind: "router" },
  { ...skill("klopsi-shared"), kind: "shared" },
  { ...skill("klopsi-static-dashboard"), kind: "workflow", commands: ["query"] },
], [command("query")])).toContain('Workflow skill "klopsi-static-dashboard" must not own commands.');
```

Add package assertions:

```ts
const packages = renderAgentSkillPackages("1.2.3");
expect(packages.get("klopsi")?.files.get("SKILL.md")).toContain("name: klopsi");
expect([...packages.get("klopsi")!.files.keys()]).toEqual(["SKILL.md"]);
expect([...renderAgentSkillFiles("1.2.3")]).toEqual(
  [...packages].map(([name, value]) => [name, value.files.get("SKILL.md")]),
);
```

- [ ] **Step 2: Write failing nested-path filesystem tests against a custom package**

In `agent-skills.test.ts`, call the planned exported `writeAgentSkillPackages()` with a custom package containing `references/contract.md`. Assert that the nested file is written, unrelated nested files survive a second write, a symbolic-link `references` directory is rejected with `SKILL_OUTPUT_INVALID`, and a directory at the known file target fails with `SKILL_GENERATION_FAILED`.

Keep this test independent of the real presentation resources so Task 2 is green before Task 3 begins:

```ts
const packages = new Map([
  ["klopsi-shared", {
    name: "klopsi-shared",
    files: new Map([
      ["SKILL.md", "---\nname: klopsi-shared\ndescription: test\n---\n"],
      ["references/contract.md", "contract\n"],
    ]),
  }],
]);
await writeAgentSkillPackages(output, packages);
expect(await readFile(join(output, "klopsi-shared", "references", "contract.md"), "utf8"))
  .toBe("contract\n");
```

- [ ] **Step 3: Run the focused tests and verify RED**

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
```

Expected: FAIL because definitions have no `kind`, workflow skills are rejected as commandless domains, and generation only writes `SKILL.md`.

- [ ] **Step 4: Implement the typed registry and compatibility renderer**

Add `kind` to every definition:

```ts
export type AgentSkillKind = "router" | "shared" | "command" | "workflow";

export interface AgentSkillDefinition {
  readonly kind: AgentSkillKind;
  readonly name: string;
  readonly description: string;
  readonly commands: readonly string[];
  readonly purpose: string;
  readonly workflows: readonly string[];
  readonly capabilities: readonly AgentSkillCapabilityGuide[];
  readonly safety: readonly string[];
  readonly related: readonly string[];
}
```

Assign `router` to `klopsi`, `shared` to `klopsi-shared`, and `command` to every existing domain. Replace name-based command rules with kind-based rules. Keep the exact loop that requires every manifest command to have one owner.

Add a workflow renderer that has no command section:

```ts
function renderWorkflowSkill(definition: AgentSkillDefinition, version: string): string {
  return `${frontmatter(definition)}
# ${definition.name}

> **Prerequisite:** Read [klopsi-shared](../klopsi-shared/SKILL.md) before creating an artifact.

${definition.purpose} Generated for \`klopsi\` ${version}.

## Workflow

${definition.workflows.map((item) => `- ${item}`).join("\n")}

${renderCapabilities(definition)}${renderSafety(definition)}${renderRelated(definition)}`;
}
```

Dispatch by kind in `renderSkill()`. Preserve `renderAgentSkillFiles()` as the `SKILL.md` compatibility view used by existing callers and tests.

- [ ] **Step 5: Implement normalized package resources**

Create `agent-skill-resources.ts` with an initially empty resource map and these exports:

```ts
export interface AgentSkillResource {
  readonly path: string;
  readonly content: string;
}

const RESOURCES = new Map<string, readonly AgentSkillResource[]>();

export function resourcesForAgentSkill(name: string): readonly AgentSkillResource[] {
  return RESOURCES.get(name) ?? [];
}
```

In `agent-skills.ts`, validate every resource path before returning packages:

```ts
const RESOURCE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/u;

function validateResourcePath(path: string): void {
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some(
    (segment) => segment === "." || segment === ".." || !RESOURCE_SEGMENT.test(segment),
  )) throw invalidSkillOutput(path);
}

export function renderAgentSkillPackages(version: string): ReadonlyMap<string, AgentSkillPackage> {
  const skillFiles = renderAgentSkillFilesInternal(version);
  return new Map([...skillFiles].map(([name, skillFile]) => {
    const resources = resourcesForAgentSkill(name);
    for (const resource of resources) validateResourcePath(resource.path);
    return [name, {
      name,
      files: new Map([["SKILL.md", skillFile], ...resources.map(
        (resource) => [resource.path, resource.content.endsWith("\n")
          ? resource.content
          : `${resource.content}\n`] as const,
      )]),
    }];
  }));
}
```

Keep the existing `GenerateAgentSkillsResult` unchanged: `count` remains the number of skills, not the number of files.

- [ ] **Step 6: Implement symlink-safe nested writes**

Replace the single-file loop with a package/file loop. Walk every parent segment from the verified skill directory, calling `mkdir` and then `lstat`; reject any symbolic link or non-directory before descending. Before replacing a known file, call `lstat` when it exists and reject symbolic links or non-files. Continue to write a sibling temporary file with `flag: "wx"` and publish it with `rename`. Export `writeAgentSkillPackages()` for direct filesystem contract tests and call it from `generateAgentSkills()`.

Use these signatures so tests can target the boundary:

```ts
async function ensurePlainDirectory(path: string): Promise<void>;
async function ensureNestedDirectory(root: string, relativeDirectory: string): Promise<string>;
async function ensureReplaceableFile(path: string): Promise<void>;
async function writeSkillFile(path: string, content: string): Promise<void>;
export async function writeAgentSkillPackages(
  outputDirectory: string,
  packages: ReadonlyMap<string, AgentSkillPackage>,
): Promise<void>;
```

- [ ] **Step 7: Run focused tests and commit GREEN**

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
```

Expected: PASS with the original eleven packages, compatibility `SKILL.md` rendering, and nested path safety.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/src/agent-skill-resources.ts apps/cli/test/agent-skills.test.ts
git commit -m "feat: support workflow skill packages"
```

---

### Task 3: Add the shared presentation contract and verifier

**Files:**
- Modify: `apps/cli/src/agent-skill-resources.ts`
- Modify: `apps/cli/src/agent-skills.ts`
- Create: `apps/cli/test/dashboard-verifier.test.ts`
- Create: `apps/cli/test/fixtures/dashboards/valid-static.html`
- Create: `apps/cli/test/fixtures/dashboards/valid-interactive.html`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/test/generate-skills.e2e.test.ts`

**Interfaces:**
- Consumes: prepared local artifact metadata and expected presentation mode
- Produces: shared `presentation-contract.md` and `verify-dashboard.mjs`; verifier exits 0 for a conforming file, 1 for contract findings, and 2 for invalid invocation

- [ ] **Step 1: Write complete valid dashboard fixtures**

Create one static and one interactive HTML fixture. Both must include:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>Verified dashboard fixture</title>
</head>
```

Use these exact common markers:

```html
<main>
  <h1>Verified dashboard fixture</h1>
  <section data-klopsi-summary>Plain-language summary.</section>
  <section data-klopsi-disclosures>No aggregation or sampling.</section>
  <section data-klopsi-lineage>Source digest and verification status.</section>
</main>
```

Embed manifest and data blocks with `<` escaped as `\u003c`:

```html
<script id="klopsi-presentation-manifest" type="application/json">{"schemaVersion":"1","mode":"static","generator":"klopsi-agent-skill","generatedAt":"2026-07-21T00:00:00.000Z","title":"Verified dashboard fixture","sources":[{"identity":"fixture.csv","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verified":true}],"transformations":[],"reductions":[],"data":{"originalRows":2,"presentedRows":2,"embeddedBytes":0,"fields":[{"name":"category","type":"string","unit":null}]},"geography":{"kind":"none","crs":null},"views":[{"id":"summary","question":"How do categories compare?","population":"Two fixture rows","unit":"count","recordCount":2,"takeaway":"Category A is larger."},{"id":"table","question":"What are the exact values?","population":"Two fixture rows","unit":"count","recordCount":2,"takeaway":"The table preserves exact values."}]}</script>
```

The interactive fixture additionally includes `data-klopsi-filter-region`, `data-klopsi-record-count`, `data-klopsi-detail-table`, `data-klopsi-reset`, `data-klopsi-empty-state`, a `noscript` summary, a JSON data block with two rows, and one inline script that uses `textContent` and DOM creation rather than data-driven `innerHTML`.

- [ ] **Step 2: Write failing black-box verifier tests**

In `dashboard-verifier.test.ts`, write the generated verifier to a temporary `.mjs` file and invoke it with `execFile(process.execPath, [...])`. Assert:

```ts
expect(await verify("valid-static.html", "static")).toMatchObject({ exitCode: 0, valid: true });
expect(await verify("valid-interactive.html", "interactive")).toMatchObject({ exitCode: 0, valid: true });
```

Generate invalid variants in memory and assert stable finding codes for:

```ts
const expectedCodes = [
  "HTML_TOO_LARGE",
  "MANIFEST_MISSING",
  "MANIFEST_INVALID",
  "MODE_MISMATCH",
  "DATA_TOO_LARGE",
  "ROW_LIMIT_EXCEEDED",
  "REDUCTION_UNDISCLOSED",
  "REMOTE_RESOURCE",
  "NETWORK_API",
  "UNSAFE_CODE",
  "CSP_INVALID",
  "JSON_EMBEDDING_UNSAFE",
  "SUMMARY_MISSING",
  "DISCLOSURES_MISSING",
  "LINEAGE_MISSING",
  "VIEW_METADATA_INVALID",
  "STATIC_SCRIPT_FORBIDDEN",
  "FILTER_REGION_MISSING",
  "RECORD_COUNT_MISSING",
  "DETAIL_TABLE_MISSING",
  "RESET_MISSING",
  "EMPTY_STATE_MISSING",
  "NOSCRIPT_MISSING",
  "TEMPLATE_MARKER_UNRESOLVED",
];
```

- [ ] **Step 3: Run the verifier tests and verify RED**

```bash
pnpm exec vitest run --project unit apps/cli/test/dashboard-verifier.test.ts
```

Expected: FAIL because `verify-dashboard.mjs` is not generated.

- [ ] **Step 4: Add the normative presentation reference**

Add `klopsi-shared/references/presentation-contract.md` to the resource map. It must define, in this order:

1. input readiness and provenance verification;
2. 10,000-row, 5 MB data, and 15 MB file limits;
3. no-silent-truncation and reduction disclosures;
4. exact manifest fields and conditional geography fields;
5. offline and content-security rules;
6. safe JSON and DOM text handling;
7. accessibility and visual metadata requirements;
8. verifier invocation and finding interpretation;
9. distinction between presentation evidence and official provenance.

The command shown to agents is:

```sh
node ../klopsi-shared/scripts/verify-dashboard.mjs <dashboard.html> --mode <static|interactive> --json
```

- [ ] **Step 5: Implement the dependency-free verifier resource**

Export `DASHBOARD_VERIFIER_SOURCE` from `agent-skill-resources.ts` and register it as `scripts/verify-dashboard.mjs`. The script must:

```js
const MAX_HTML_BYTES = 15 * 1024 * 1024;
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const MAX_INTERACTIVE_ROWS = 10_000;

function finding(code, message) {
  return { code, message };
}

function add(findings, condition, code, message) {
  if (condition) findings.push(finding(code, message));
}
```

Parse `--mode` and `--json`, reject unknown or missing arguments with exit 2, reject non-regular or oversized input before reading, and bound findings to 100 entries. Extract JSON script bodies by locating an opening `script` tag with the required `id` and `type="application/json"`, then the next closing tag. Reject raw `<` inside either JSON body and parse with `JSON.parse`.

Apply every code listed in Step 2. Detect remote resources in resource-bearing attributes and CSS `url(http...)`; detect `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, and dynamic `import`; detect `eval`, `new Function`, `iframe`, `object`, and `embed`. Accept ordinary visible citation anchors because they do not load on open.

For an interactive data block, compute `embeddedBytes` from its UTF-8 body and `presentedRows` from the parsed array; require exact agreement with the manifest. If `originalRows > presentedRows`, require at least one reduction record. Validate static view count 2–6 and interactive view count 2–4, with nonempty `id`, `question`, `population`, `unit`, `recordCount`, and `takeaway`.

Emit:

```json
{"valid":true,"mode":"static","findings":[]}
```

or:

```json
{"valid":false,"mode":"interactive","findings":[{"code":"RESET_MISSING","message":"Interactive dashboards require a reset control."}]}
```

- [ ] **Step 6: Update shared skill guidance and package tests**

Add a short `## Presentation artifacts` section to the rendered `klopsi-shared` skill. It must route detailed work to `references/presentation-contract.md`, require the verifier before handoff, and state that passing verification is not official artifact provenance.

Assert package keys exactly:

```ts
expect([...packages.get("klopsi-shared")!.files.keys()]).toEqual([
  "SKILL.md",
  "references/presentation-contract.md",
  "scripts/verify-dashboard.mjs",
]);
```

Extend `generate-skills.e2e.test.ts` to read both shared nested resources, preserve an unrelated nested sentinel during regeneration, reject a symbolic-link `references` directory, and reject a directory at `scripts/verify-dashboard.mjs`.

- [ ] **Step 7: Run focused tests and commit GREEN**

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/dashboard-verifier.test.ts
pnpm build && pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts
```

Expected: PASS; both fixtures verify, invalid variants return the expected codes, and the shared package contains both nested resources.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/src/agent-skill-resources.ts apps/cli/test/agent-skills.test.ts apps/cli/test/dashboard-verifier.test.ts apps/cli/test/fixtures/dashboards
git commit -m "feat: add dashboard presentation contract"
```

---

### Task 4: Create and verify `klopsi-static-dashboard`

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/src/agent-skill-resources.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/test/generate-skills.e2e.test.ts`
- Modify: `docs/superpowers/evals/2026-07-21-agent-html-dashboards-baseline.md`
- Generate: `skills/klopsi-static-dashboard/**`

**Interfaces:**
- Consumes: a prepared local artifact, shared presentation contract, static template, and encoding guide
- Produces: a self-contained semantic HTML/inline-SVG board that verifies in `static` mode and remains useful without JavaScript

- [ ] **Step 1: Write failing static registry and content tests**

Add `klopsi-static-dashboard` to `EXPECTED_SKILLS` after `klopsi-provenance`. Assert:

```ts
const definition = AGENT_SKILLS.find((entry) => entry.name === "klopsi-static-dashboard");
expect(definition?.kind).toBe("workflow");
expect(definition?.commands).toEqual([]);
expect(definition?.related).toEqual([
  "klopsi-analysis",
  "klopsi-services",
  "klopsi-provenance",
]);
```

Assert the rendered skill contains `self-contained`, `offline`, `static-board.html`, `encoding-guide.md`, `provenance verify`, `10,000`, `5 MB`, `15 MB`, `Do not silently truncate`, `known CRS`, and `verify-dashboard.mjs`, and contains no command section.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
```

Expected: FAIL because the static workflow skill and resources do not exist.

- [ ] **Step 3: Add the static workflow definition**

Use this trigger-only description:

```ts
description: "Use when prepared Slovenian public data needs a concise static HTML dashboard, presentation board, printable visual summary, chart panel, heatmap, ranked list, or offline map.",
```

Give it four capability guides: `input-readiness`, `encoding-selection`, `board-composition`, and `verification`. The workflow must require source verification, route reshaping to analysis/services, copy the template to a new destination, replace every marker, write the embedded manifest, run the shared verifier, and hand off the absolute HTML path.

- [ ] **Step 4: Add the complete static template and encoding guide**

Register:

```ts
{
  path: "assets/static-board.html",
  content: STATIC_BOARD_TEMPLATE,
},
{
  path: "references/encoding-guide.md",
  content: STATIC_ENCODING_GUIDE,
}
```

The template must include all common verifier markers, a three-to-five KPI grid, a two-to-six view grid, inline SVG examples using `role="img"` and accessible titles/descriptions, a semantic exact-values table, disclosure and lineage sections, the JSON manifest block, and print rules using `break-inside: avoid`. It must not include executable JavaScript.

Use explicit markers such as `{{TITLE}}`, `{{SUMMARY}}`, `{{KPI_CARDS}}`, `{{VIEW_CARDS}}`, `{{DETAIL_ROWS}}`, `{{DISCLOSURES}}`, `{{LINEAGE}}`, and `{{PRESENTATION_MANIFEST_JSON}}`; the skill must remove optional sections instead of leaving markers.

The encoding guide must contain the approved question-to-encoding table, rules for units/population/count/takeaway, inline SVG accessibility, map prerequisites, color and precision constraints, and non-map fallbacks.

- [ ] **Step 5: Regenerate the checked-in repertoire and run automated GREEN**

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir ./skills --json
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/dashboard-verifier.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts
```

Expected: PASS with twelve generated skills and the complete static package.

- [ ] **Step 6: Run static skill behavior evaluations**

Repeat the three static prompts from Task 1 with only `klopsi`, `klopsi-shared`, and `klopsi-static-dashboard` available. Record output paths and verifier JSON in the evaluation document.

Success requires all runs to avoid remote dependencies and invented geography, preserve script-like values as text, expose verification/uncertainty, disclose reductions, and pass the static verifier. If a run finds a new rationalization, update only the minimum relevant instruction and rerun all three static prompts.

- [ ] **Step 7: Commit the independently verified static skill**

```bash
git add apps/cli/src/agent-skills.ts apps/cli/src/agent-skill-resources.ts apps/cli/test docs/superpowers/evals skills/klopsi-static-dashboard skills/klopsi-shared
git commit -m "feat: add static dashboard skill"
```

---

### Task 5: Create and verify `klopsi-interactive-dashboard`

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/src/agent-skill-resources.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/test/generate-skills.e2e.test.ts`
- Modify: `docs/superpowers/evals/2026-07-21-agent-html-dashboards-baseline.md`
- Generate: `skills/klopsi-interactive-dashboard/**`

**Interfaces:**
- Consumes: a prepared bounded local artifact, shared presentation contract, interactive template, and interaction guide
- Produces: one self-contained client-side HTML dashboard with linked filters, reset, counts, views, empty state, and semantic detail table

- [ ] **Step 1: Write failing interactive registry and content tests**

Add `klopsi-interactive-dashboard` immediately after the static skill in `EXPECTED_SKILLS`. Assert `kind: "workflow"`, no commands, the same related skills, the three nested package files, and required guidance for the initial useful state, in-memory state, filters, linked views, matching count, reset, empty state, semantic table, keyboard access, `noscript`, row/byte limits, and shared verification.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
```

Expected: FAIL because the interactive skill and resources do not exist.

- [ ] **Step 3: Add the interactive workflow definition**

Use this trigger-only description:

```ts
description: "Use when prepared Slovenian public data needs a self-contained interactive HTML dashboard with filters, linked charts, maps, heatmaps, search, sorting, drill-down, or exploratory detail.",
```

Give it five capability guides: `input-readiness`, `bounded-embedding`, `initial-overview`, `linked-interaction`, and `verification`. Require the agent to keep state in memory, update matching counts and all linked views from one filtered row set, render data with `textContent`/DOM methods, provide reset and empty states, and include a static `noscript` summary.

- [ ] **Step 4: Add the complete interactive template and interaction guide**

Register:

```ts
{
  path: "assets/interactive-dashboard.html",
  content: INTERACTIVE_DASHBOARD_TEMPLATE,
},
{
  path: "references/interaction-guide.md",
  content: INTERACTIVE_INTERACTION_GUIDE,
}
```

The template must include all common verifier markers plus the five interactive data markers, a labeled filter form without an action, record counts using `aria-live="polite"`, two-to-four linked view containers, an empty-state region, a semantic detail table, reset button, `noscript` summary, manifest JSON, presentation-data JSON, and one inline script.

The script must parse the JSON block, maintain one `state` object, derive one filtered row array, and call `renderCounts`, `renderViews`, `renderTable`, and `renderEmptyState`. It must build data labels and table cells with `textContent`; it must not call `fetch`, network constructors, dynamic imports, `eval`, `new Function`, or browser storage.

The interaction guide must define allowed filters, a single filtered-data flow, reset semantics, keyboard and focus behavior, empty-state behavior, tooltip alternatives, linked highlighting, sorting, bounded detail rows, and progressive disclosure.

- [ ] **Step 5: Regenerate and run automated GREEN**

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir ./skills --json
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/dashboard-verifier.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts
```

Expected: PASS with thirteen generated skills and the complete interactive package.

- [ ] **Step 6: Run interactive skill behavior evaluations**

Repeat the three interactive prompts from Task 1 with only `klopsi`, `klopsi-shared`, and `klopsi-interactive-dashboard` available. Record output paths and verifier JSON.

Success requires refusal or reshaping of oversized input, no CDN or tiles, explicit reduction disclosure, keyboard-operable filters, visible counts, reset, meaningful empty state, semantic detail table, and a passing interactive verifier. Address new rationalizations minimally and rerun all three interactive prompts.

- [ ] **Step 7: Commit the independently verified interactive skill**

```bash
git add apps/cli/src/agent-skills.ts apps/cli/src/agent-skill-resources.ts apps/cli/test docs/superpowers/evals skills/klopsi-interactive-dashboard
git commit -m "feat: add interactive dashboard skill"
```

---

### Task 6: Integrate routing, installation, package, and public documentation

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/test/agent-setup.test.ts`
- Modify: `apps/cli/test/agent-setup.integration.test.ts`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `apps/cli/test/release-contract.test.ts`
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Generate: `docs/skills.md`
- Generate: `skills/klopsi/SKILL.md`
- Create: `.changeset/agent-html-dashboards.md`

**Interfaces:**
- Consumes: the two verified workflow packages and existing setup/generation commands
- Produces: discoverable routing, durable resource installation, packed generation, and public release documentation

- [ ] **Step 1: Write failing installation and package assertions**

In `agent-setup.test.ts`, inspect the temporary source inside the fake runner and read:

```ts
await readFile(join(sourceDirectory, "klopsi-shared", "scripts", "verify-dashboard.mjs"), "utf8");
await readFile(join(sourceDirectory, "klopsi-static-dashboard", "assets", "static-board.html"), "utf8");
await readFile(join(sourceDirectory, "klopsi-interactive-dashboard", "assets", "interactive-dashboard.html"), "utf8");
```

In the real-installer integration test, read the same paths under `home/.agents/skills` after setup cleanup. In `pack.test.ts`, require `count: 13` and read all three paths from a tree generated by the installed tarball.

- [ ] **Step 2: Write failing orchestrator and release assertions**

Require the orchestrator route table to link both skills and add an `Analyze and present data` end-to-end workflow with these stages: prepare, verify, choose mode, create, verify. Require README text to call both artifacts self-contained and offline. Update the release contract to say known generated files rather than only known generated `SKILL.md` targets.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/agent-setup.test.ts apps/cli/test/release-contract.test.ts
pnpm exec vitest run --project integration apps/cli/test/agent-setup.integration.test.ts
pnpm build && pnpm exec vitest run --project cli-e2e apps/cli/test/pack.test.ts
```

Expected: FAIL until routing, docs, setup assertions, package counts, and nested resources agree.

- [ ] **Step 4: Implement orchestrator routing and workflow text**

Add both skill names to `klopsi.related`. Extend orchestrator rendering with:

```markdown
### Analyze and present data

1. Prepare a bounded local artifact with analysis or WFS export, then verify available provenance.
2. Choose `klopsi-static-dashboard` for a concise printable board or `klopsi-interactive-dashboard` for bounded exploration across linked views.
3. Generate one self-contained offline HTML file, disclose reductions and verification status, and run the shared dashboard verifier before handoff.
```

Update the installation-refresh check so it refers to the complete reported repertoire rather than naming `klopsi-services` as the newest expected skill.

- [ ] **Step 5: Update public documentation and release note**

Add focused installation examples for each workflow skill plus `klopsi-shared`. Explain that v1 is agent-authored and contract-verified, and link issue #28 as future deterministic CLI work.

Create the changeset exactly as:

```markdown
---
"klopsi": minor
---

Add agent-only static and interactive HTML dashboard skills with self-contained offline templates, bounded presentation contracts, nested skill resources, and a shared artifact verifier.
```

- [ ] **Step 6: Regenerate all checked-in packages and index**

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir ./skills --json
```

Expected structured data: `count: 13` and both new skill names.

Update `docs/skills.md` from `renderAgentSkillsIndex()` so it lists all thirteen definitions in registry order. Do not hand-edit generated `skills/**` content after generation.

- [ ] **Step 7: Run focused GREEN and commit**

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/agent-setup.test.ts apps/cli/test/release-contract.test.ts apps/cli/test/dashboard-verifier.test.ts
pnpm exec vitest run --project integration apps/cli/test/agent-setup.integration.test.ts
pnpm build && pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/pack.test.ts
```

Expected: PASS with thirteen skills and durable nested resources in generated, installed, and packed flows.

```bash
git add apps/cli/src apps/cli/test README.md apps/cli/README.md docs/commands.md docs/skills.md skills .changeset/agent-html-dashboards.md
git commit -m "docs: integrate dashboard skill workflow"
```

---

### Task 7: Perform manual artifact and offline verification

**Files:**
- Verify: `apps/cli/test/fixtures/dashboards/valid-static.html`
- Verify: `apps/cli/test/fixtures/dashboards/valid-interactive.html`
- Modify: `docs/superpowers/evals/2026-07-21-agent-html-dashboards-baseline.md`

**Interfaces:**
- Consumes: generated verifier and two complete dashboard fixtures
- Produces: browser-level evidence for responsive, print, keyboard, reset, filtering, and offline behavior

- [ ] **Step 1: Run the checked-in verifier against both fixtures**

```bash
node skills/klopsi-shared/scripts/verify-dashboard.mjs apps/cli/test/fixtures/dashboards/valid-static.html --mode static --json
node skills/klopsi-shared/scripts/verify-dashboard.mjs apps/cli/test/fixtures/dashboards/valid-interactive.html --mode interactive --json
```

Expected for each: `{"valid":true,...,"findings":[]}` and exit 0.

- [ ] **Step 2: Inspect the static fixture in a browser**

Verify desktop and narrow layouts, heading order, readable SVG alternatives, no clipped content, print preview, and usefulness with JavaScript disabled. Keep developer tools in offline mode and confirm zero network requests.

- [ ] **Step 3: Inspect the interactive fixture in a browser**

Use keyboard-only navigation to change every filter, observe the live matching count, sort the detail table, select a view item, reach an empty state, and reset to the documented initial state. Confirm zero network requests in offline mode and a useful `noscript` summary with JavaScript disabled.

- [ ] **Step 4: Record manual results and commit any evidence correction**

Append a `## Manual verification` section to the evaluation document with browser, viewport, print, keyboard, offline, and verifier results. If a defect is found, first add a failing verifier or fixture test, then correct the resource and rerun Tasks 3–7 verification.

```bash
git add docs/superpowers/evals/2026-07-21-agent-html-dashboards-baseline.md
git commit -m "test: verify dashboard artifacts manually"
```

---

### Task 8: Complete repository verification and open the pull request

**Files:**
- Verify: all files changed by Tasks 1–7
- External: pull request from `codex/agent-html-dashboards` to the repository default branch

**Interfaces:**
- Consumes: complete implementation, behavior evidence, automated tests, and backlog issue #28
- Produces: a pushed feature branch and reviewable pull request

- [ ] **Step 1: Run formatting and focused generation drift checks**

```bash
pnpm exec prettier --check .
git diff --check
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/dashboard-verifier.test.ts
```

Expected: PASS with no formatting, whitespace, verifier, or generated-tree drift.

- [ ] **Step 2: Run the complete quality gate**

```bash
pnpm check
```

Expected: all formatting, lint, build, typecheck, unit, integration, CLI end-to-end, and exact packed-tarball tests pass with zero failures.

- [ ] **Step 3: Review the final diff and commit remaining tracked changes**

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: only the approved skills, resource generation, tests, evaluation evidence, documentation, changeset, design, and plan are present. If verification produced a legitimate final correction, commit it with a focused message before pushing.

- [ ] **Step 4: Push the branch and open the PR**

Use `github:yeet` for the publish workflow. Push `codex/agent-html-dashboards` and open a ready-for-review PR with:

```text
Title: Add agent-only HTML dashboard skills

Summary:
- add static and interactive terminal presentation skills
- package offline templates, presentation guidance, and a shared verifier
- preserve exact command ownership while supporting commandless workflow skills
- verify nested resources through generation, installation, packed CLI, and behavior evaluations

Testing:
- pnpm check
- static and interactive verifier fixtures
- isolated baseline and post-skill behavior evaluations
- manual responsive, print, keyboard, reset, empty-state, and offline checks

Related: #28
```

Do not use a closing keyword for #28 because that issue tracks the later CLI renderer and must remain open.
