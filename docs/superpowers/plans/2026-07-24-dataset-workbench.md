# Dataset Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct DuckDB UI storage so notebooks work, rename the broad Agent Skill to `klopsi-dataset-workbench`, and require a polished handoff with an optional notebook named `Example queries`.

**Architecture:** Keep KLOPSI's immutable staged database and `duckdb` CLI commands. Open DuckDB UI on a separate writable invocation-local `workbench.duckdb`, attach the staged database read-only as `dataset`, and expose `main.data` as a view. Keep notebook authoring in supported DuckDB UI interactions; the Agent Skill must never write private `_duckdb_ui` tables.

**Tech Stack:** TypeScript, Node.js 24, DuckDB CLI 1.5.4, Vitest, generated Agent Skills, pnpm.

## Global Constraints

- The broad Agent Skill name is exactly `klopsi-dataset-workbench`.
- CLI command paths remain exactly `duckdb open` and `duckdb install`.
- DuckDB UI opens a writable invocation-local database; the staged dataset is attached with `(READ_ONLY)`.
- The simple query relation remains `data`.
- Notebook title is exactly `Example queries`.
- Notebook creation uses supported UI interaction only; never insert into or depend on `_duckdb_ui` tables.
- Never claim that a notebook was created unless the UI action succeeded.
- Preserve explicit installer authorization, version pin `1.5.4`, supported platforms, typed errors, cache behavior, and query sandbox behavior.
- Keep exactly one Agent Skill owner for every CLI command path.

---

### Task 1: Open a writable DuckDB UI workbench over a read-only staged dataset

**Files:**
- Modify: `apps/cli/src/duckdb-ui-runner.ts`
- Modify: `apps/cli/test/duckdb-ui-runner.test.ts`
- Modify: `apps/cli/test/duckdb.e2e.test.ts`
- Modify: `docs/commands.md`
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: `DuckDbUiRunner.open(info: DuckDbCliInfo, databasePath: string): Promise<DuckDbCliInfo>`
- Produces: the same public signature, with `databasePath` treated as the staged source and `dirname(databasePath)/workbench.duckdb` as the writable UI database
- Produces: startup SQL `ATTACH '<escaped-stage>' (READ_ONLY) AS dataset; CREATE VIEW main.data AS SELECT * FROM dataset.main.data;`

- [ ] **Step 1: Replace the runner launch expectation with a failing writable-workbench test**

Update the first runner test to assert the exact invocation:

```ts
await runner.open(info, "/tmp/data's stage/data.duckdb");

expect(spawnProcess).toHaveBeenLastCalledWith(
  "duckdb",
  [
    "/tmp/data's stage/workbench.duckdb",
    "-cmd",
    "ATTACH '/tmp/data''s stage/data.duckdb' (READ_ONLY) AS dataset; " +
      "CREATE VIEW main.data AS SELECT * FROM dataset.main.data;",
    "-ui",
  ],
  {
    env: { PATH: "/usr/bin" },
    shell: false,
    stdio: "inherit",
  } satisfies SpawnOptions,
);
```

Also assert that the E2E runner callback receives a staged database whose parent directory does not contain `workbench.duckdb` after the callback completes.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/duckdb-ui-runner.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/duckdb.e2e.test.ts
```

Expected: the unit test fails because current arguments are `["-readonly", databasePath, "-ui"]`.

- [ ] **Step 3: Implement safe workbench launch**

In `apps/cli/src/duckdb-ui-runner.ts`, import `dirname` and add:

```ts
function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function workbenchInvocation(databasePath: string): readonly string[] {
  const workbenchPath = join(dirname(databasePath), "workbench.duckdb");
  const prepare =
    `ATTACH ${sqlString(databasePath)} (READ_ONLY) AS dataset; ` +
    "CREATE VIEW main.data AS SELECT * FROM dataset.main.data;";
  return [workbenchPath, "-cmd", prepare, "-ui"];
}
```

Change `open()` to call:

```ts
result = await this.#run(info.executable, workbenchInvocation(databasePath), {
  capture: false,
});
```

Do not pass `-readonly` for the workbench itself. The source attachment is read-only, the view is non-mutating, `shell` remains `false`, and the enclosing query lease removes both database files after UI exit.

- [ ] **Step 4: Run focused tests and typecheck to verify GREEN**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/duckdb-ui-runner.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/duckdb.e2e.test.ts
pnpm --filter klopsi typecheck
```

Expected: PASS.

- [ ] **Step 5: Verify the invocation against the real DuckDB CLI without opening a browser**

Create a temporary staged fixture through `QueryDatabaseCache.withDatabase()`, then execute the same writable workbench and startup SQL with `-c "SELECT count(*)::INTEGER AS count FROM data"`. Assert the output contains `2`, the staged source remains readable, and the enclosing temporary directory is removed afterward.

Run:

```bash
duckdb -version
```

Expected: `v1.5.4`.

- [ ] **Step 6: Correct command and security documentation**

In `docs/commands.md`, replace direct read-only-database wording with:

```markdown
DuckDB UI opens a writable invocation-local workbench. KLOPSI attaches the staged dataset to that workbench read-only and exposes the relation `data`.
```

In `docs/security.md`, state:

```markdown
The external CLI receives a writable invocation-local workbench path, never the canonical cache object. The staged database is attached with DuckDB's `READ_ONLY` option as `dataset`, and `main.data` is a view over `dataset.main.data`.
```

Remove claims that the UI process itself is launched with `-readonly`.

- [ ] **Step 7: Commit the corrected workbench lifecycle**

```bash
git add apps/cli/src/duckdb-ui-runner.ts apps/cli/test/duckdb-ui-runner.test.ts apps/cli/test/duckdb.e2e.test.ts docs/commands.md docs/security.md
git commit -m "fix: open DuckDB UI on a writable workbench"
```

---

### Task 2: Rename and strengthen the dataset workbench Agent Skill

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/test/agent-setup.e2e.test.ts`
- Modify: `apps/cli/test/generate-skills.e2e.test.ts`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `apps/cli/test/release-contract.test.ts`
- Delete: `skills/klopsi-duckdb-ui/SKILL.md`
- Create through generation: `skills/klopsi-dataset-workbench/SKILL.md`
- Modify through generation: `skills/klopsi/SKILL.md`
- Modify through generation: `docs/skills.md`
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `.changeset/duckdb-ui-workflow.md`

**Interfaces:**
- Consumes: command ownership `["duckdb open", "duckdb install"]`
- Produces: Agent Skill `klopsi-dataset-workbench`
- Produces capability IDs `representation-fit`, `open-workbench`, `example-queries`, `optional-installation`, `handoff`, `preserve-results`
- Produces router workflow `Represent and explore a dataset in a database workbench`

- [ ] **Step 1: Write failing rename and guidance tests**

Replace `klopsi-duckdb-ui` with `klopsi-dataset-workbench` in expected skill lists and ownership assertions. Add:

```ts
const EXPECTED_DATASET_WORKBENCH_CAPABILITY_IDS = [
  "representation-fit",
  "open-workbench",
  "example-queries",
  "optional-installation",
  "handoff",
  "preserve-results",
] as const;
```

Require generated guidance to contain:

```ts
[
  "represent",
  "writable",
  "attached read-only",
  "table `data`",
  "Example queries",
  "supported UI",
  "never claim",
  "DuckDB dataset workbench",
  "Open workbench",
  "Dataset",
  "Checks",
  "Sources",
  "session-local",
]
```

Require it not to contain `_duckdb_ui`. Require package and release tests to find `skills/klopsi-dataset-workbench/SKILL.md` and reject stale `klopsi-duckdb-ui` references outside the historical implementation plan.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/release-contract.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/agent-setup.e2e.test.ts
```

Expected: failures report missing `klopsi-dataset-workbench` and old generated paths.

- [ ] **Step 3: Rename the canonical skill definition and router workflow**

In `apps/cli/src/agent-skills.ts`, define:

```ts
{
  kind: "command",
  name: "klopsi-dataset-workbench",
  description:
    "Use when acquired or computed Slovenian public data should be represented as an explorable database with SQL, profiles, tables, charts, or an Example queries notebook.",
  commands: ["duckdb open", "duckdb install"],
  purpose:
    "Represent a resolved tabular dataset as the read-only `data` relation in a writable local database workbench.",
  // capability guides below
}
```

The `example-queries` capability must instruct agents to:

```text
Offer a notebook named `Example queries`. If accepted and supported browser/UI control is available, create it through DuckDB UI controls with a small dataset-specific set of titled, read-only SQL cells. Never write DuckDB UI private tables and never claim creation unless the UI action succeeded. Otherwise present the proposed numbered queries for the user to paste.
```

The `handoff` capability must require:

```text
DuckDB dataset workbench
Open workbench
Dataset
Checks
Example queries
Sources
```

It must put the local URL first, show compact dataset facts, state validation/provenance/read-only attachment status, give notebook status, list source/transformation files, and identify the writable workspace as session-local.

Update the router workflow and related skill references to use `klopsi-dataset-workbench`.

- [ ] **Step 4: Remove the stale generated directory and regenerate**

Delete `skills/klopsi-duckdb-ui/SKILL.md` with `apply_patch`, rebuild the CLI, and generate the canonical repertoire:

```bash
pnpm --filter klopsi build
node apps/cli/dist/main.js generate-skills --output-dir ./skills --json
```

Expected: output count remains `14`; `skills/klopsi-dataset-workbench/SKILL.md` exists.

- [ ] **Step 5: Update public installation copy and release metadata**

Update both READMEs to install:

```sh
npx skills add https://github.com/0xfa7ca7/klopsi/tree/main/skills/klopsi-dataset-workbench
```

Describe the skill as a database workbench rather than a DuckDB-named skill. Update the changeset to mention the broad Agent Skill name and optional `Example queries` notebook guidance.

- [ ] **Step 6: Run focused generated-surface tests**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/release-contract.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/pack.test.ts
```

Expected: PASS with 14 skills and no stale generated directory.

- [ ] **Step 7: Commit the broad skill and handoff**

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test README.md apps/cli/README.md docs/skills.md skills .changeset/duckdb-ui-workflow.md
git commit -m "feat: broaden the dataset workbench skill"
```

---

### Task 3: Verify and update pull request #31

**Files:**
- Modify only files required by verification failures attributable to this revision
- Modify: `docs/superpowers/plans/2026-07-23-duckdb-ui-workflow.md` only to mark it as superseded by this plan if stale naming would confuse maintainers

**Interfaces:**
- Verifies: writable UI catalog, read-only source attachment, generated-skill ownership, handoff contract, release package, and cross-platform behavior
- Produces: updated branch `codex/duckdb-ui` and refreshed PR #31

- [ ] **Step 1: Run formatter and focused suites**

```bash
pnpm exec prettier --write apps/cli/src/duckdb-ui-runner.ts apps/cli/src/agent-skills.ts apps/cli/test/duckdb-ui-runner.test.ts apps/cli/test/agent-skills.test.ts README.md apps/cli/README.md docs/commands.md docs/security.md docs/skills.md docs/superpowers/specs/2026-07-24-dataset-workbench-design.md docs/superpowers/plans/2026-07-24-dataset-workbench.md .changeset/duckdb-ui-workflow.md
pnpm exec vitest run --project unit apps/cli/test/duckdb-ui-runner.test.ts apps/cli/test/agent-skills.test.ts apps/cli/test/release-contract.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/duckdb.e2e.test.ts apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/pack.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the complete repository gate**

```bash
pnpm check
```

Expected: formatting, lint, typecheck, unit, integration, CLI E2E, and packed-tarball checks all PASS.

- [ ] **Step 3: Review the final diff**

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
rg -n "klopsi-duckdb-ui|_duckdb_ui|-readonly.*-ui" README.md apps/cli/README.md apps/cli/src apps/cli/test docs/commands.md docs/security.md docs/skills.md skills .changeset
```

Expected: clean worktree; no stale skill name, private UI-table dependency, or direct read-only UI launch outside historical superseded documents.

- [ ] **Step 4: Push and update PR #31**

```bash
git push origin codex/duckdb-ui
gh pr edit 31 \
  --title "Add a DuckDB-backed dataset workbench and Agent Skill" \
  --body-file <prepared-markdown-file>
gh pr checks 31 --watch --interval 10
```

The PR body must explain the corrected writable-workbench/read-only-attachment model, broad `klopsi-dataset-workbench` name, optional `Example queries` notebook workflow, polished handoff, and exact verification counts.

