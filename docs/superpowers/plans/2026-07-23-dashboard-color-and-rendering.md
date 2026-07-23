# Dashboard Color and Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both dashboard skills a richer accessible color system and prevent invisible bars or heatmaps in generated offline HTML.

**Architecture:** Keep the current agent-only workflow and self-contained templates. Add reusable CSS color roles and component classes to both templates, add rendering requirements to the skill references, and enforce the contracts through package-rendering tests.

**Tech Stack:** Markdown Agent Skills, self-contained HTML/CSS/JavaScript, TypeScript, Vitest, pnpm.

## Global Constraints

- Keep artifacts self-contained and offline.
- Keep color supplementary to labels, position, length, patterns, or symbols.
- Use no external charting, font, image, or map dependency.
- Preserve existing provenance, manifest, data-size, and CSP contracts.
- Use broadly compatible CSS color syntax for generated inline styles.

---

### Task 1: Encode the visual contract as failing tests

**Files:**
- Modify: `apps/cli/test/agent-skills.test.ts`

**Interfaces:**
- Consumes: `renderAgentSkillPackages(version)`
- Produces: assertions covering palette roles, accent classes, visible marks, heatmap fallbacks, legends, and rendering guidance

- [x] **Step 1: Add assertions for the static package**

Require `--color-blue`, `--color-green`, `--color-amber`, `.accent-blue`, `.accent-green`, `.heat-cell`, `.legend`, and guidance containing `labeled legend` and `print`.

- [x] **Step 2: Add assertions for the interactive package**

Require the same palette roles plus `.bar { display: block`, a non-white `.heat-cell` background, `.legend`, and guidance containing `comma-separated`, `computed style`, and `screenshot`.

- [x] **Step 3: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit apps/cli/test/agent-skills.test.ts`

Expected: FAIL because the existing templates and guides do not expose the complete visual contract.

### Task 2: Implement the shared colorful defaults

**Files:**
- Modify: `skills/klopsi-static-dashboard/assets/static-board.html`
- Modify: `skills/klopsi-static-dashboard/references/encoding-guide.md`
- Modify: `skills/klopsi-static-dashboard/SKILL.md`
- Modify: `skills/klopsi-interactive-dashboard/assets/interactive-dashboard.html`
- Modify: `skills/klopsi-interactive-dashboard/references/interaction-guide.md`
- Modify: `skills/klopsi-interactive-dashboard/SKILL.md`
- Modify: `apps/cli/src/agent-skill-resources.ts`
- Modify: `apps/cli/src/agent-skills.ts`

**Interfaces:**
- Consumes: existing template markers and rendered Agent Skill package structure
- Produces: synchronized source skills and generated package resources with the same visual contract

- [x] **Step 1: Add the named palette and reusable presentation classes**

Use CSS custom properties for blue, cyan, green, amber, orange, magenta, violet, and soft backgrounds. Add accent card classes, legend styling, heat-cell fallback styling, and print-safe borders.

- [x] **Step 2: Add visible interactive mark defaults**

Make `.bar` block-level with a visible fallback color. Keep heat cells visibly colored without inline JavaScript and document comma-separated `rgb(r, g, b)` for generated intensity colors.

- [x] **Step 3: Update both references and verification instructions**

Require labels or geometry alongside color, a labeled legend for data color, screen/print contrast, and rendered checks of marks and heatmaps rather than DOM-count-only checks.

- [x] **Step 4: Synchronize the TypeScript resource constants**

Mirror the skill files in `apps/cli/src/agent-skill-resources.ts` and the skill workflow text in `apps/cli/src/agent-skills.ts`.

- [x] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm vitest run --project unit apps/cli/test/agent-skills.test.ts`

Expected: PASS.

### Task 3: Validate, update the example, and publish

**Files:**
- Modify: the existing tick-dashboard example outside the repository
- Modify: the current branch through one focused commit

**Interfaces:**
- Consumes: updated interactive skill guidance/template and the existing prepared KME data
- Produces: refreshed example artifact and an updated existing GitHub pull request

- [x] **Step 1: Rebuild the example with colorful accessible marks**

Update its deterministic builder to use the shared palette, visible block bars, heatmap fallbacks, and comma-separated RGB values; regenerate the HTML.

- [x] **Step 2: Run repository and artifact verification**

Run focused unit tests, dashboard verification for the example, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and the relevant unit test suite.

- [ ] **Step 3: Inspect scope and commit**

Run `git status -sb` and `git diff --check`; stage only the skill, test, and design/plan files; commit with `fix: strengthen dashboard color rendering`.

- [ ] **Step 4: Push the current branch**

Run `git push origin codex/agent-html-dashboards`, then confirm the existing PR URL and checks.
