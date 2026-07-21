# KLOPSI Agent Skill Capability Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated KLOPSI Agent Skills teach the complete public CLI capability surface through concise, user-focused routing, decision guidance, workflows, and recovery rules.

**Architecture:** Preserve the existing orchestrator/shared/nine-domain topology and the command manifest as the syntax source of truth. Add structured capability-guide metadata to the skill registry, render it deterministically ahead of command syntax, and protect both structural and behavioral coverage with unit tests, exact-byte drift checks, and fresh-agent application evaluations.

**Tech Stack:** Node.js 24, TypeScript 6, Commander 15, Vitest 4, pnpm 11, Markdown Agent Skills, Changesets, Codex multi-agent evaluations.

## Global Constraints

- Cover the complete public `klopsi` CLI; do not add TypeScript SDK or contributor guidance.
- Keep every manifest command owned by exactly one domain skill.
- Preserve the existing eleven-skill topology and one-level cross-references.
- Keep generated frontmatter limited to `name` and `description`; every description begins with `Use when` and contains only discovery triggers.
- Preserve CLI safety bounds, structured output, offline behavior, network controls, mutation confirmation, and exit categories.
- `klopsi agent setup` must leave a durable installed skill tree after its temporary generated source is removed.
- Keep generated files deterministic, below 500 lines each, and free of secrets, placeholders, and machine-specific paths.
- Use baseline and improved fresh-agent evaluations before claiming that guidance is effective.
- Follow test-driven development for renderer and registry behavior.

---

## File structure

- Modify `apps/cli/src/agent-skills.ts`: add structured capability guides, improve trigger descriptions, and render user workflows.
- Modify `apps/cli/src/agent-setup.ts`: make temporary-source installation durable by default.
- Modify `apps/cli/src/commands/agent.ts`: remove the redundant public copy request forwarding.
- Modify `apps/cli/test/agent-setup.test.ts`: cover default installer arguments and cleanup orchestration.
- Modify `apps/cli/test/agent-setup.integration.test.ts`: reproduce dangling default symlinks with the real pinned installer and verify the fix.
- Modify `apps/cli/test/agent-setup.e2e.test.ts`: ensure public help does not expose the installer's internal copy mode.
- Modify `apps/cli/src/command-manifest.ts`: remove the redundant public copy option.
- Modify `apps/cli/test/agent-skills.test.ts`: enforce discovery metadata, capability IDs, workflow content, limits, and exact generated output.
- Modify `skills/*/SKILL.md`: regenerate the eleven checked-in skills from the renderer.
- Modify `docs/skills.md`: regenerate the public repertoire index with improved trigger descriptions.
- Modify `README.md`: clarify repertoire refresh and verification for stale installations.
- Modify `apps/cli/README.md`: mirror the concise installed-package refresh guidance.
- Create `docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md`: record evaluation prompts, rubrics, baseline failures, improved results, and any refactor loop.
- Create `.changeset/complete-agent-skill-guidance.md`: record the user-visible skill improvement as a patch for `klopsi`.

### Task 1: Establish fresh-agent baseline evaluations

**Files:**
- Create after evaluations: `docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md`

**Interfaces:**
- Consumes: the current CLI help and project state, with agents explicitly prohibited from reading `skills/` or `apps/cli/src/agent-skills.ts`.
- Produces: verbatim baseline decisions and a scored capability-gap report for three complete public-user workflows.

- [ ] **Step 1: Run the acquisition-and-analysis baseline**

Dispatch a fresh agent with this exact prompt:

```text
Act as a user-facing data agent. Do not read any file under skills/ and do not read apps/cli/src/agent-skills.ts. You may inspect `klopsi --help`, subcommand help, and public docs. A user asks: “Find a Slovenian traffic dataset, choose a usable resource even if it is ZIP, XML, or XLSX, inspect it safely, validate it, run a bounded read-only aggregation, export the result, and prove where the output came from. Network access may be unavailable after discovery.” Give the exact KLOPSI command sequence, decision points for ambiguous ZIP/XML/XLSX inputs, structured-output choices, offline transition, overwrite behavior, failure handling, and final verification. Do not modify files.
```

Score one point for each of: bounded search; exact dataset/resource handoff; `resource inspect` or bounded preview; `--entry`; `--record-path`; `--sheet`; validation; read-only bounded query; query export; overwrite authorization; offline behavior; provenance verification; structured stdout/stderr/exit handling. Maximum: 13.

- [ ] **Step 2: Run the WFS baseline**

Dispatch a fresh agent with this exact prompt:

```text
Act as a user-facing data agent. Do not read any file under skills/ and do not read apps/cli/src/agent-skills.ts. You may inspect `klopsi --help`, subcommand help, and public docs. A user provides an OPSI WFS resource reference and asks you to discover its layers, inspect a layer, preview selected properties inside a bounding box, count matching features, and export a bounded filtered CSV without bypassing KLOPSI security. Give the exact safe command sequence, filter and CRS decisions, pagination or limit behavior, overwrite handling, forbidden fallbacks, and artifact verification. Do not modify files.
```

Score one point for each of: canonical reference; inspect; layers; schema; repeatable/comma-separated properties; typed `--filter-eq`; `--bbox`; `--crs`; bounded preview; count; bounded export; overwrite authorization; no raw HTTP/CQL/XML/transaction fallback; provenance verification. Maximum: 14.

- [ ] **Step 3: Run the local-state-and-installation baseline**

Dispatch a fresh agent with this exact prompt:

```text
Act as a user-facing data agent. Do not read any file under skills/ and do not read apps/cli/src/agent-skills.ts. You may inspect `klopsi --help`, subcommand help, and public docs. A user says their installed KLOPSI skills are stale and omit WFS. They also want to diagnose KLOPSI offline, inspect raw and derived cache state without deleting data, verify configuration paths and values, preview which agent hosts would receive refreshed skills, then perform an explicitly authorized refresh for Codex only. Give the exact commands, durable-copy behavior, non-interactive safeguards, and post-install verification. Do not modify files.
```

Score one point for each of: `doctor --offline`; providers; cache info/list/verify; raw-versus-derived distinction; no prune/clear without authorization; config path/list/get; `agent setup --dry-run`; explicit `--agent codex`; `--yes`; durable-copy default; `generate-skills` distinction; refresh/post-install verification. Maximum: 13.

- [ ] **Step 4: Write the baseline report**

Create the evaluation document with the three prompts, rubrics, each agent's score, verbatim incorrect or missing decisions, and these section headings:

```markdown
# KLOPSI Agent Skill Capability Evaluation

## Method
## Scenario 1: Acquisition and analysis
### Baseline
### Improved
## Scenario 2: WFS access
### Baseline
### Improved
## Scenario 3: Local state and agent refresh
### Baseline
### Improved
## Refactor loop
## Final comparison
```

Do not write empty Improved or Refactor sections yet; add those sections only when results exist.

- [ ] **Step 5: Review and commit the baseline evidence**

Run:

```bash
rg -n 'TBD|TODO|FIXME' docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md
git diff --check
```

Expected: `rg` returns no matches and `git diff --check` exits 0.

```bash
git add docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md
git commit -m "test: record KLOPSI skill capability baseline"
```

### Task 2: Fix durable default agent installation

**Files:**
- Modify: `apps/cli/src/agent-setup.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/test/agent-setup.test.ts`
- Modify: `apps/cli/test/agent-setup.integration.test.ts`
- Modify: `apps/cli/test/agent-setup.e2e.test.ts`
- Modify: `README.md`
- Modify: `apps/cli/README.md`

**Interfaces:**
- Preserves: `setupAgents()` and the pinned `skills@1.5.19` installer.
- Removes: `AgentSetupRequest.copy` and the redundant public copy option.
- Changes: every real setup passes the installer's internal `--copy`, so installed files survive temporary-source cleanup.

- [ ] **Step 1: Record the root-cause evidence**

Confirm the failing data flow in `apps/cli/src/agent-setup.ts`: `defaultTemporaryDirectory()` creates an ephemeral source; `buildAgentInstallerArguments()` omits `--copy` when `request.copy` is false; the pinned installer therefore symlinks; `defaultRemoveTemporaryDirectory()` removes the symlink target after installation. Record this hypothesis and the relevant source lines in the task report before editing code.

- [ ] **Step 2: Write the failing real-installer regression test**

In `apps/cli/test/agent-setup.integration.test.ts`, change the successful integration scenario to omit `copy: true`:

```ts
request: { agents: ["universal"] },
```

Keep the assertions that read representative installed `SKILL.md` files after `setupAgents()` returns, and assert the installer request contains `--copy`. This test proves the installed targets remain readable after the temporary source has been removed.

Add a unit assertion in `apps/cli/test/agent-setup.test.ts` that a default `request: { agents: ["codex"] }` calls the runner with arguments containing `--copy`.

Add public-surface assertions that normalized `agent setup` metadata and `agent setup --help` do not expose the installer's internal copy mode.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-setup.test.ts
pnpm exec vitest run --project integration apps/cli/test/agent-setup.integration.test.ts
```

Expected: unit and integration assertions FAIL because default setup omits `--copy`; the real installed paths are unreadable after cleanup.

- [ ] **Step 4: Implement the minimal durable-copy fix**

Change `buildAgentInstallerArguments()` so every real installation includes the installer's `--copy` before `--yes`. Remove its unused boolean parameter, `AgentSetupRequest.copy`, the command-adapter copy field and forwarding, and the public manifest option. Update callers and tests.

Update public documentation and regenerated diagnostics guidance to state that setup always uses durable copies because its generated source is temporary. Do not add a symlink mode or persistent generated cache.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-setup.test.ts apps/cli/test/agent-skills.test.ts
pnpm exec vitest run --project integration apps/cli/test/agent-setup.integration.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/agent-setup.e2e.test.ts
git diff --check
```

Expected: focused tests PASS, installed skill files remain readable after cleanup, and diff check exits 0.

- [ ] **Step 6: Commit the bug fix**

```bash
git add apps/cli/src/agent-setup.ts apps/cli/src/commands/agent.ts apps/cli/src/command-manifest.ts apps/cli/test/agent-setup.test.ts apps/cli/test/agent-setup.integration.test.ts apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/agent-skills.test.ts README.md apps/cli/README.md docs/commands.md skills/klopsi-diagnostics/SKILL.md docs/superpowers/specs/2026-07-20-agent-skill-capability-audit-design.md docs/superpowers/plans/2026-07-20-agent-skill-capability-audit.md
git commit -m "fix: install durable KLOPSI agent skills by default"
```

### Task 3: Define the machine-verifiable capability contract

**Files:**
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/src/agent-skills.ts`

**Interfaces:**
- Produces: `AgentSkillCapabilityGuide { id, title, instructions }` and `AgentSkillDefinition.capabilities`.
- Preserves: `AGENT_SKILLS`, `validateAgentSkills()`, `renderAgentSkillFiles()`, and `renderAgentSkillsIndex()` public behavior.

- [ ] **Step 1: Add failing discovery and capability-contract tests**

Add tests that assert every description is a concise trigger and extend negative validation fixtures for malformed capability metadata:

```ts
for (const definition of AGENT_SKILLS) {
  expect(definition.description, definition.name).toMatch(/^Use when /u);
  expect(definition.description.length, definition.name).toBeLessThanOrEqual(500);
}

const invalidCapabilities = [
  { id: "Bad ID", title: "Valid title", instructions: ["Valid instruction"] },
  { id: "blank-title", title: " ", instructions: ["Valid instruction"] },
  { id: "blank-instruction", title: "Valid title", instructions: [" "] },
];
```

Assert invalid IDs, duplicate IDs, blank titles, and empty or blank instruction lists are rejected with deterministic messages.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
```

Expected: FAIL because descriptions do not all start with `Use when` and `capabilities` does not exist.

- [ ] **Step 3: Add the minimal capability types and validator**

Add to `apps/cli/src/agent-skills.ts`:

```ts
export interface AgentSkillCapabilityGuide {
  readonly id: string;
  readonly title: string;
  readonly instructions: readonly string[];
}

export interface AgentSkillDefinition {
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

Set `capabilities: []` temporarily for all definitions. Update the test helper `skill()` the same way. Extend `validateAgentSkills()` to reject duplicate IDs, invalid kebab-case IDs, blank titles, and empty or blank instruction lists.

- [ ] **Step 4: Update trigger-only descriptions**

Rewrite all eleven descriptions to begin with `Use when` and describe only selection triggers. Keep the indexed descriptions user-facing and include synonyms such as Slovenian public data, KLOPSI, WFS, ZIP, XML, XLSX, provenance, cache, configuration, diagnostics, completion, and agent setup where relevant.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
```

Expected: PASS. Empty capability arrays are valid until each domain's behavior tests define the required entries in Tasks 3–5.

### Task 4: Teach the shared and end-to-end data workflow

**Files:**
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/src/agent-skills.ts`

**Interfaces:**
- Consumes: `AgentSkillCapabilityGuide`.
- Produces: generated capability guides for catalogue, resources, download, validation, analysis, and provenance plus expanded orchestrator/shared contracts.

- [ ] **Step 1: Add failing generated-content assertions**

Add this expected capability map for the acquisition-and-analysis domains:

```ts
const EXPECTED_DATA_CAPABILITY_IDS = {
  "klopsi-catalogue": ["catalogue-mode", "search-refinement", "dataset-followup"],
  "klopsi-resources": ["input-resolution", "access-selection", "structured-selectors"],
  "klopsi-download": ["target-resolution", "destination-strategy", "partial-results"],
  "klopsi-validation": ["validation-mode", "structured-selectors", "failure-recovery"],
  "klopsi-analysis": ["supported-inputs", "bounded-query", "query-export", "safe-conversion"],
  "klopsi-provenance": ["record-inspection", "integrity-verification"],
} as const;
```

Assert each named definition exposes its exact ordered IDs, then assert generated output contains all of these exact user-facing tokens in the named skills:

```ts
const REQUIRED_GUIDANCE = {
  klopsi: ["## End-to-end workflows", "Acquire and analyze data", "Inspect and export WFS data", "Refresh an agent installation"],
  "klopsi-shared": ["## Default decision sequence", "local path", "opsi:resource:", "--entry", "--record-path", "--sheet", "JSON, NDJSON, CSV, TSV, XLSX, Parquet", "offline"],
  "klopsi-catalogue": ["snapshot", "--refresh", "--live", "--all", "dataset resources", "dataset schema"],
  "klopsi-resources": ["resource inspect", "resource preview", "--entry", "--record-path", "--sheet", "WFS"],
  "klopsi-download": ["--dataset", "--resource", "one resource", "batch", "Partial success", "provenance verify"],
  "klopsi-validation": ["--metadata", "--entry", "--record-path", "--sheet", "exit 6"],
  "klopsi-analysis": ["CSV", "TSV", "JSON", "NDJSON", "XLSX", "Parquet", "ZIP", "XML", "SELECT", "WITH", "VALUES", "--output", "--spreadsheet-safe", "provenance verify"],
  "klopsi-provenance": ["provenance show", "provenance verify", "digest mismatch", "Do not mutate"],
} as const;
```

Assert each capability renders under `## Capability guide` with a `###` title and bullet instructions before `## Commands`.

- [ ] **Step 2: Run the focused test and verify RED**

Run the agent-skills unit test. Expected: FAIL on the new guidance and empty capability arrays.

- [ ] **Step 3: Populate acquisition and analysis capabilities**

Add the exact capability IDs from Task 3 to the six domain definitions. Instructions must cover the required tokens, safe sequencing, selector ambiguity, bounded output, offline transitions, partial success, overwrite authorization, and provenance verification. Keep each instruction actionable and avoid internal implementation details.

- [ ] **Step 4: Render capability guides and expand shared routing**

Add:

```ts
function renderCapabilities(definition: AgentSkillDefinition): string {
  if (definition.capabilities.length === 0) return "";
  const sections = definition.capabilities
    .map(({ title, instructions }) =>
      `### ${title}\n\n${instructions.map((instruction) => `- ${instruction}`).join("\n")}`,
    )
    .join("\n\n");
  return `## Capability guide\n\n${sections}\n\n`;
}
```

Insert it between `## Workflow` and `## Commands`. Add concise orchestrator sequences for acquisition/analysis, WFS, and agent refresh. Add a shared default decision sequence, input-reference selection, structured-selector rules, supported format/output choices, and offline transition guidance.

- [ ] **Step 5: Run focused tests and keep drift failure explicit**

Run the focused unit test. Expected: all semantic assertions PASS and only the exact checked-in drift assertion FAILS because artifacts have not yet been regenerated.

- [ ] **Step 6: Regenerate checked-in skills and index**

Run:

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir skills --json
```

Update `docs/skills.md` from `renderAgentSkillsIndex()` using the same descriptions and ordering emitted by the registry. This is a deterministic generated-artifact update.

- [ ] **Step 7: Verify and commit the end-to-end workflow guidance**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
git diff --check
```

Expected: PASS and exit 0.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts skills docs/skills.md
git commit -m "feat: teach complete KLOPSI data workflows"
```

### Task 5: Teach complete WFS workflows

**Files:**
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/src/agent-skills.ts`
- Regenerate: `skills/klopsi-services/SKILL.md`

**Interfaces:**
- Produces capability IDs: `wfs-sequence`, `feature-selection`, `spatial-filtering`, and `bounded-export`.

- [ ] **Step 1: Add failing WFS behavior assertions**

Require `klopsi-services` to expose exactly `wfs-sequence`, `feature-selection`, `spatial-filtering`, and `bounded-export`. Require the generated services skill to contain: canonical resource references; `service inspect`; `service layers`; `service schema`; repeatable/comma-separated `--property`; typed equality `--filter-eq`; `--bbox`; matching `--crs`; zero-based `--start-index`; bounded `--limit`; `service count`; CSV-only export; overwrite authorization; provenance verification; and the prohibition on transactions, raw CQL, arbitrary XML filters, and direct HTTP.

- [ ] **Step 2: Run the focused test and verify RED**

Run the agent-skills unit test. Expected: FAIL because the four WFS capability entries are absent.

- [ ] **Step 3: Add the WFS capability guides**

Populate the four exact capability IDs. Express the safe sequence as inspect → layers → schema → preview/count → bounded export. Explain that properties and equality filters may repeat, bbox coordinates use the supplied CRS, and pagination remains bounded. State that `--force` requires prior overwrite authorization and exported artifacts should be verified through provenance.

- [ ] **Step 4: Regenerate, verify, and commit**

Run:

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir skills --json
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
git diff --check
```

Expected: PASS and exit 0.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts skills/klopsi-services/SKILL.md
git commit -m "feat: teach complete KLOPSI WFS workflows"
```

### Task 6: Teach local-state, diagnostics, and skill refresh workflows

**Files:**
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Regenerate: `skills/klopsi-local-state/SKILL.md`
- Regenerate: `skills/klopsi-diagnostics/SKILL.md`

**Interfaces:**
- Produces local-state capability IDs: `cache-tiers`, `cache-mutations`, `configuration`.
- Produces diagnostics capability IDs: `environment-diagnostics`, `shell-integration`, `skill-generation`, `agent-refresh`.

- [ ] **Step 1: Add failing local-state and refresh assertions**

Require `klopsi-local-state` to expose exactly `cache-tiers`, `cache-mutations`, and `configuration`. Require `klopsi-diagnostics` to expose exactly `environment-diagnostics`, `shell-integration`, `skill-generation`, and `agent-refresh`. Require generated guidance to distinguish raw downloads/catalogue data from rebuildable derived DuckDB stages; explain info/list/verify before prune/clear; preserve explicit authorization; keep secrets out of config; use `doctor --offline`; distinguish `generate-skills` from `agent setup`; explain detected hosts, `--agent`, `--all`, `--dry-run`, `--yes`, durable-copy default, empty detection, rerunning setup to refresh, and post-install verification.

- [ ] **Step 2: Run the focused test and verify RED**

Run the agent-skills unit test. Expected: FAIL because the seven local-state/diagnostics capability entries are absent.

- [ ] **Step 3: Add local-state and diagnostics guides**

Populate the seven exact capability IDs with concise decision guidance. Add a refresh recipe using:

```sh
klopsi doctor --offline --json
klopsi agent setup --agent codex --dry-run --json
klopsi agent setup --agent codex --yes --json
klopsi generate-skills --output-dir ./generated-skills --json
```

Make clear that `generate-skills` writes a portable tree but does not install it, while `agent setup` installs or refreshes the complete repertoire for selected hosts.

- [ ] **Step 4: Update public installation guidance**

Add one concise paragraph to both READMEs: rerun `klopsi agent setup` to refresh a stale repertoire; preview with `--dry-run`; select a host with `--agent`; verify the installed host contains all skills reported by structured setup output. Do not add contributor or SDK guidance.

- [ ] **Step 5: Regenerate, verify, and commit**

Run:

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir skills --json
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/agent-setup.test.ts apps/cli/test/agent-hosts.test.ts
git diff --check
```

Expected: PASS and exit 0.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts skills/klopsi-local-state/SKILL.md skills/klopsi-diagnostics/SKILL.md README.md apps/cli/README.md
git commit -m "feat: guide KLOPSI skill refresh and local state"
```

### Task 7: Run improved agent evaluations and refactor guidance

**Files:**
- Modify: `docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md`
- Modify if an observed gap requires it: `apps/cli/src/agent-skills.ts`
- Modify if an observed gap requires it: `apps/cli/test/agent-skills.test.ts`
- Regenerate if guidance changes: `skills/*/SKILL.md`, `docs/skills.md`

**Interfaces:**
- Consumes: the same three scenario prompts and scoring rubrics from Task 1 plus the relevant improved skill files.
- Produces: comparable improved scores, exact evidence, and a closed refactor loop.

- [ ] **Step 1: Re-run all three scenarios with improved skills**

Dispatch three fresh agents. Use the Task 1 prompt verbatim, but replace the prohibition sentence with:

```text
Read skills/klopsi/SKILL.md, skills/klopsi-shared/SKILL.md, and every domain skill that the orchestrator routes for this request before answering.
```

Score with the identical rubrics. Require exact command names, preservation of user authorization boundaries, and no unsupported fallback.

- [ ] **Step 2: Record improved results and compare**

Add each response score, evidence, and remaining gaps under its Improved heading. Add a Final comparison table with baseline score, improved score, remaining misses, and unsafe suggestions for each scenario.

- [ ] **Step 3: Close observed gaps**

For every remaining miss caused by unclear skill guidance, first add a focused failing generated-content test, run it and observe failure, then make the smallest registry/renderer wording change and rerun the scenario with a fresh agent. Record the observed miss and the exact correction under Refactor loop. If no guidance-caused gap remains, write `No additional guidance-caused gaps remained after the improved evaluation.`

- [ ] **Step 4: Regenerate and verify evaluation artifacts**

If guidance changed, rebuild and regenerate skills. Then run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
rg -n 'TBD|TODO|FIXME' docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md
git diff --check
```

Expected: tests PASS, `rg` returns no matches, and diff check exits 0.

- [ ] **Step 5: Commit evaluated guidance**

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts skills docs/skills.md docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md
git commit -m "test: verify KLOPSI skill capability guidance"
```

### Task 8: Add release metadata and complete repository verification

**Files:**
- Create: `.changeset/complete-agent-skill-guidance.md`

**Interfaces:**
- Produces: a patch release note for the public `klopsi` package.

- [ ] **Step 1: Add the Changeset**

Create exactly:

```markdown
---
"klopsi": patch
---

Expand the generated Agent Skills with complete user-focused guidance for data acquisition, format selection, bounded analysis, WFS access, local state, diagnostics, and refreshing stale agent installations.
```

- [ ] **Step 2: Run focused and full verification**

Run fresh commands in this order:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pack
pnpm build
git diff --check
git status --short
```

Expected: every command exits 0; tests report zero failures; `git diff --check` emits no output; status contains only intended task files.

- [ ] **Step 3: Review requirements and generated drift**

Re-read the design specification and this plan. Confirm every capability group maps to a generated skill, every command still has one owner, every checked-in skill matches renderer bytes, no SDK/contributor guidance was introduced, and all three improved agent evaluations satisfy their rubrics without unsafe fallbacks.

- [ ] **Step 4: Commit release metadata**

```bash
git add .changeset/complete-agent-skill-guidance.md
git commit -m "chore: document complete agent skill guidance"
```

### Task 9: Independent review and pull request

**Files:**
- Review all changes from `origin/main...HEAD`.

**Interfaces:**
- Consumes: committed implementation, evaluation evidence, and fresh verification output.
- Produces: resolved review findings and an open GitHub pull request targeting `main`.

- [ ] **Step 1: Request independent code and skill review**

Dispatch a fresh reviewer with the design path, plan path, base SHA from `origin/main`, and head SHA. Ask it to inspect registry correctness, trigger descriptions, progressive disclosure, public capability completeness, safety, generated drift, test quality, evaluation evidence, and scope exclusions. Fix every Critical or Important issue; challenge incorrect findings with file-and-test evidence.

- [ ] **Step 2: Re-run verification after review fixes**

Run:

```bash
pnpm check
git diff --check
git status --short --branch
```

Expected: `pnpm check` exits 0 with zero failures; diff check emits no output; branch is `codex/agent-skill-capability-audit` with a clean worktree.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin codex/agent-skill-capability-audit
```

Expected: push succeeds and configures the upstream branch.

- [ ] **Step 4: Open the pull request**

Run:

```bash
gh pr create --base main --head codex/agent-skill-capability-audit --title "feat: complete KLOPSI agent skill capabilities" --body-file /tmp/klopsi-agent-skill-pr.md
```

Before the command, write `/tmp/klopsi-agent-skill-pr.md` with a summary of the capability contract, improved workflows, evaluation evidence, and exact verification commands. The PR body must state that scope is public CLI users only and that no SDK/contributor guidance was added.

- [ ] **Step 5: Verify the remote PR**

Run:

```bash
gh pr view --json url,title,baseRefName,headRefName,state
```

Expected: state `OPEN`, base `main`, head `codex/agent-skill-capability-audit`, and the requested title.
