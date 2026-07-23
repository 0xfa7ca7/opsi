# DuckDB UI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in DuckDB CLI installation and a one-command workflow that opens any resolved KLOPSI tabular input in DuckDB UI, plus generated agent guidance for using it as an exploratory visual tool.

**Architecture:** Extract the existing query staging/cache lifecycle into a callback-based database lease, then let a CLI-only DuckDB runner hold that lease while an external read-only `duckdb -ui` process is active. Keep official-installer download/execution isolated behind an injected runner and add one command-owning Agent Skill for exploratory UI workflows.

**Tech Stack:** Node.js 24, TypeScript 6, Commander 15, DuckDB CLI 1.5.4, `@duckdb/node-api` 1.5.4-r.1, pnpm 11, Vitest 4, generated Agent Skills

## Global Constraints

- Add `klopsi duckdb open <input>` and `klopsi duckdb install --yes`; `duckdb open --install` is the one-call first-run path.
- Stage the same CSV, TSV, JSON, NDJSON, XLSX, Parquet, ZIP, and XML inputs accepted by `klopsi query`, including provider resources and structured selectors.
- Give DuckDB UI an invocation-local database containing exactly one base table named `data`; never expose the canonical cache object.
- Launch the external database with exact UI arguments `-readonly <databasePath> -ui` and keep the lease until the child exits.
- Keep `@duckdb/node-api` optional and treat the external DuckDB CLI as a separate, opt-in UI dependency.
- Fetch installers only from `https://install.duckdb.org` or `https://install.duckdb.org/install.ps1`, cap them at 1 MiB, pin `DUCKDB_VERSION=1.5.4`, and remove installer temporaries.
- Require `--yes` for `duckdb install`; treat `duckdb open --install` as explicit installation authorization.
- Add one generated command skill named `klopsi-duckdb-ui`; preserve exactly one agent-skill owner per command path.
- Keep `klopsi query` syntax, sandboxing, cache metadata, warnings, and result behavior backward compatible.

---

### Task 1: Extract a callback-based staged-database lease

**Files:**
- Modify: `packages/core/src/query-database-cache.ts`
- Modify: `packages/core/src/queries.ts`
- Modify: `packages/core/test/query-cache.test.ts`

**Interfaces:**
- Produces: `QueryDatabasePreparationOptions`, `QueryDatabaseMetadata`, `QueryDatabaseLeaseResult<T>`, `QueryDatabaseCache.withDatabase<T>()`, `QueryService.withDatabase<T>()`
- Preserves: `QueryDatabaseCache.execute()` and `QueryService.execute()` public behavior

- [ ] **Step 1: Write failing lease tests**

Add a test that executes a callback against the staged database and checks lifecycle metadata:

```ts
it("leases a staged database through the callback and removes it afterward", async () => {
  const { coordinator, stageCount } = setup();
  let leasedPath = "";
  const leased = await coordinator.withDatabase(input, {}, async (databasePath, metadata) => {
    leasedPath = databasePath;
    expect(metadata).toMatchObject({ cache: { status: "miss", kind: "duckdb-stage" } });
    const instance = await DuckDBInstance.create(databasePath, { access_mode: "READ_ONLY" });
    const connection = await instance.connect();
    const rows = (await connection.runAndReadAll("SELECT count(*) AS count FROM data"))
      .getRowObjectsJS();
    connection.closeSync();
    instance.closeSync();
    return rows;
  });
  expect(leased.value).toEqual([{ count: 2n }]);
  expect(stageCount()).toBe(1);
  await expect(access(leasedPath)).rejects.toMatchObject({ code: "ENOENT" });
});
```

Add a callback-failure test that expects the original error and still verifies removal. Add a regression assertion that `execute()` returns the same cache and warning shape.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit packages/core/test/query-cache.test.ts
```

Expected: FAIL because `withDatabase` does not exist.

- [ ] **Step 3: Implement the lease types and lifecycle**

Add:

```ts
export type QueryDatabasePreparationOptions = Pick<
  QueryDatabaseExecutionOptions,
  "sheet" | "recordPath" | "signal"
>;

export interface QueryDatabaseMetadata {
  readonly cache: QueryCacheMetadata;
  readonly warnings: readonly QueryCacheWarning[];
}

export interface QueryDatabaseLeaseResult<T> extends QueryDatabaseMetadata {
  readonly value: T;
}
```

Move stage detection, cache materialization/build, verification, and final cleanup from `execute()` into:

```ts
async withDatabase<T>(
  source: DataInput,
  options: QueryDatabasePreparationOptions,
  operation: (databasePath: string, metadata: QueryDatabaseMetadata) => Promise<T>,
): Promise<QueryDatabaseLeaseResult<T>>
```

Call `operation` only after the database has passed `verifyStagedDatabase`. Keep the existing cleanup aggregation and cache warning rules. Rewrite `execute()` as a call to `withDatabase()` whose callback invokes `runner.executePrepared`, then merge the lease metadata into the query result.

- [ ] **Step 4: Add the resolved-input service wrapper**

In `queries.ts`, add:

```ts
export type QueryDatabaseServiceOptions = DataResolutionOptions & {
  readonly sheet?: string;
  readonly recordPath?: string;
  readonly signal?: AbortSignal;
};

export interface QueryDatabaseServiceResult<T> extends QueryDatabaseMetadata {
  readonly value: T;
  readonly source: string;
}
```

Implement `QueryService.withDatabase()` with `data.withResolvedInput()`, `sourcePath()`, and `databases.withDatabase()`. Pass archive/network selectors to input resolution and sheet/record/signal fields to the database lease.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run --project unit packages/core/test/query-cache.test.ts
pnpm --filter @klopsi/core typecheck
```

Expected: PASS.

Commit:

```bash
git add packages/core/src/query-database-cache.ts packages/core/src/queries.ts packages/core/test/query-cache.test.ts
git commit -m "refactor: expose DuckDB stage leases"
```

---

### Task 2: Add a safe external DuckDB CLI runner

**Files:**
- Create: `apps/cli/src/duckdb-ui-runner.ts`
- Create: `apps/cli/test/duckdb-ui-runner.test.ts`

**Interfaces:**
- Produces: `DuckDbCliInfo`, `DuckDbUiRunner`, `ProcessDuckDbUiRunner`
- Consumes: injected process spawning, installer fetch, platform, architecture, home, and environment

- [ ] **Step 1: Write failing runner tests**

Cover these exact cases with injected fakes:

```ts
await expect(runner.inspect()).resolves.toEqual({
  executable: "duckdb",
  version: "v1.5.4 (Variegata) 08e34c447b",
});
await expect(runner.open(info, "/tmp/data.duckdb")).resolves.toEqual(info);
expect(spawnProcess).toHaveBeenLastCalledWith(
  "duckdb",
  ["-readonly", "/tmp/data.duckdb", "-ui"],
  expect.objectContaining({ stdio: "inherit", shell: false }),
);
```

Also assert that:

- `ENOENT` during `-version` returns `undefined`;
- a nonzero UI exit becomes `DUCKDB_UI_FAILED`;
- install rejects unsupported platform/architecture before fetch;
- install fetches only the platform URL, rejects redirects/non-200/over-1-MiB content, writes mode `0700`, supplies `DUCKDB_VERSION: "1.5.4"`, verifies the installed executable, and removes the temporary directory;
- installer nonzero exit and post-install missing binary become `DUCKDB_CLI_INSTALL_FAILED`;
- no process call uses `shell: true`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/duckdb-ui-runner.test.ts
```

Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement discovery and UI launch**

Define:

```ts
export const DUCKDB_CLI_VERSION = "1.5.4";

export interface DuckDbCliInfo {
  readonly executable: string;
  readonly version: string;
}

export interface DuckDbUiRunner {
  inspect(): Promise<DuckDbCliInfo | undefined>;
  install(): Promise<DuckDbCliInfo>;
  open(info: DuckDbCliInfo, databasePath: string): Promise<DuckDbCliInfo>;
}
```

Implement `inspect()` with `duckdb -version`, a 4 KiB captured-output bound, and `ENOENT` handling. Implement `open()` with inherited stdio, `shell: false`, exact read-only UI arguments, and typed error mapping.

- [ ] **Step 4: Implement official opt-in installation**

Select the URL and command by the supported target. Stream the response body into memory while enforcing 1 MiB before writing. Use an owner-only `klopsi-duckdb-install-*` temporary directory and execute:

```ts
["sh", [installerPath]]
```

on Linux/macOS or:

```ts
["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installerPath]]
```

on Windows. Supply the caller environment plus `DUCKDB_VERSION=1.5.4`, inspect `duckdb`, then inspect the official per-user candidate under `.duckdb/cli/1.5.4/duckdb[.exe]` if PATH has not refreshed. Clean up in `finally`.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/duckdb-ui-runner.test.ts
pnpm --filter klopsi typecheck
```

Expected: PASS.

Commit:

```bash
git add apps/cli/src/duckdb-ui-runner.ts apps/cli/test/duckdb-ui-runner.test.ts
git commit -m "feat: add DuckDB UI process runner"
```

---

### Task 3: Register and implement the DuckDB CLI commands

**Files:**
- Create: `apps/cli/src/commands/duckdb.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/src/public-main.d.ts`
- Modify: `apps/cli/test/complete-surface.e2e.test.ts`
- Create: `apps/cli/test/duckdb.e2e.test.ts`

**Interfaces:**
- Consumes: `QueryService.withDatabase()`, `DuckDbUiRunner`
- Produces: command paths `duckdb open`, `duckdb install`; optional `ProgramDependencies.duckDbUiRunner`

- [ ] **Step 1: Write failing command-surface tests**

Add manifest expectations:

```ts
expect(paths).toEqual(expect.arrayContaining(["duckdb open", "duckdb install"]));
```

Assert `duckdb open` declares `<input>`, `--sheet`, `--entry`, `--record-path`, `--install`, and the two network override flags. Assert `duckdb install` declares only `--yes`.

In the E2E file, inject a fake runner and run `duckdb open source.csv --json`. The fake `open` callback must use `@duckdb/node-api` to prove `SELECT count(*) FROM data` returns the fixture row count. Assert JSON contains:

```ts
{
  data: {
    opened: true,
    source: expect.stringContaining("source.csv"),
    table: "data",
    installed: false,
    duckdb: { version: "v1.5.4 test" },
    cache: { kind: "duckdb-stage" },
  },
}
```

Add tests for absent CLI, `open --install`, already-installed `install --yes`, missing `--yes`, selector forwarding, and a failed child exit.

- [ ] **Step 2: Run command tests and verify RED**

Run:

```bash
pnpm exec vitest run --project cli-e2e apps/cli/test/complete-surface.e2e.test.ts apps/cli/test/duckdb.e2e.test.ts
```

Expected: FAIL because neither manifest entry nor adapter exists.

- [ ] **Step 3: Add normalized manifest entries**

Add:

```ts
leaf(
  "duckdb open",
  "Open tabular data in DuckDB UI",
  [argument("<input>", "local path or canonical resource reference")],
  [
    option("--sheet <name>", "XLSX sheet name"),
    option("--entry <path>", "ZIP data entry path"),
    option("--record-path <path>", "XML record element path"),
    option("--install", "install the optional DuckDB CLI when unavailable"),
    ...NETWORK_OPTIONS,
  ],
),
leaf(
  "duckdb install",
  "Install the optional DuckDB CLI",
  [],
  [option("--yes", "authorize the official DuckDB installer")],
),
```

Add `duckdb: "Open data in DuckDB UI"` to group descriptions.

- [ ] **Step 4: Implement command behavior**

`duckdb install` first calls `inspect()`. If present, return `{installed:false, duckdb: info}` without requiring `--yes`. If absent and `--yes` is not true, throw `CONFIRMATION_REQUIRED`; otherwise call `install()` and return `{installed:true, duckdb: info}`.

`duckdb open` resolves an available CLI, installing only when `--install` is true. Call `client.query.withDatabase()` and hold its callback until `runner.open()` exits. Pass all selectors and network overrides. Emit cache warnings to stderr unless global `--quiet` is set. Render the structured record described by the test.

- [ ] **Step 5: Wire dependency injection and declarations**

Add `duckDbUiRunner?: DuckDbUiRunner` to `ProgramDependencies`; default to `new ProcessDuckDbUiRunner({ home, env })`. Register the command after `query`. Mirror the public dependency shape in `public-main.d.ts`.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run --project cli-e2e apps/cli/test/complete-surface.e2e.test.ts apps/cli/test/duckdb.e2e.test.ts
pnpm --filter klopsi typecheck
```

Expected: PASS.

Commit:

```bash
git add apps/cli/src/commands/duckdb.ts apps/cli/src/command-manifest.ts apps/cli/src/program.ts apps/cli/src/public-main.d.ts apps/cli/test/complete-surface.e2e.test.ts apps/cli/test/duckdb.e2e.test.ts
git commit -m "feat: open KLOPSI data in DuckDB UI"
```

---

### Task 4: Add the generated DuckDB UI agent skill

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `skills/klopsi/SKILL.md` through generation
- Modify: `skills/klopsi-shared/SKILL.md` through generation
- Create: `skills/klopsi-duckdb-ui/SKILL.md` through generation
- Modify: all affected generated command-skill files through generation

**Interfaces:**
- Produces: command skill `klopsi-duckdb-ui` owning `duckdb open` and `duckdb install`

- [ ] **Step 1: Write failing registry and guidance tests**

Add `klopsi-duckdb-ui` after `klopsi-analysis` in the expected repertoire and assert:

```ts
expect(definition).toMatchObject({
  kind: "command",
  commands: ["duckdb open", "duckdb install"],
  related: ["klopsi-analysis", "klopsi-static-dashboard", "klopsi-interactive-dashboard"],
});
expect(definition?.capabilities.map(({ id }) => id)).toEqual([
  "exploration-fit",
  "open-prepared-data",
  "optional-installation",
  "handoff",
]);
```

Require generated guidance to contain `table \`data\``, `--install`, `exploratory`, `read-only`, `static HTML`, and `interactive HTML`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
```

Expected: FAIL because the command paths have no skill owner and the new skill is absent.

- [ ] **Step 3: Add the skill definition and router flow**

Add the skill with four capabilities:

- choose DuckDB UI for local exploratory SQL, profiling, tables, summaries, and temporary charts;
- open a verified acquired/converted/query-exported artifact with selectors and use `data`;
- install only after explicit authorization, preferring the already installed CLI;
- route durable presentation requests to the existing static or interactive HTML dashboard skill.

Add `klopsi-duckdb-ui` to router related skills and an “Explore prepared data in DuckDB UI” router workflow.

- [ ] **Step 4: Regenerate the checked-in skill tree**

Run:

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir skills --json
```

Expected: success JSON reporting fourteen generated skills, including `klopsi-duckdb-ui`.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/agent-setup.e2e.test.ts
```

Expected: PASS.

Commit:

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts skills
git commit -m "feat: teach agents the DuckDB UI workflow"
```

---

### Task 5: Update package contracts and public documentation

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Modify: `docs/installation.md`
- Modify: `docs/skills.md`
- Modify: `docs/security.md`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `apps/cli/test/release-contract.test.ts`
- Create: `.changeset/duckdb-ui-workflow.md`

**Interfaces:**
- Documents: quick open, optional install, input support, `data` table, exploratory security boundary, and durable-dashboard handoff

- [ ] **Step 1: Write failing release-contract assertions**

Assert the packed CLI help contains `duckdb`, packed generation contains fourteen skills and `skills/klopsi-duckdb-ui/SKILL.md`, and public docs contain:

```text
klopsi duckdb open ./downloads/data.csv
klopsi duckdb open ./results.parquet --install
klopsi duckdb install --yes
```

Require installation docs to distinguish `@duckdb/node-api` from the external CLI and security docs to distinguish unrestricted local DuckDB UI SQL from bounded `klopsi query`.

- [ ] **Step 2: Run release-contract tests and verify RED**

Run:

```bash
pnpm exec vitest run --project cli-e2e apps/cli/test/pack.test.ts
pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts
```

Expected: FAIL on the old skill count and missing documentation.

- [ ] **Step 3: Update user and operator documentation**

Add a quick workflow to both READMEs, command reference sections for both commands, installer troubleshooting, the fourteenth skill row, and the UI security boundary. State that closing DuckDB UI releases the temporary database and that important downloaded/computed artifacts retain their original provenance sidecars.

- [ ] **Step 4: Add the release note**

Create:

```markdown
---
"klopsi": minor
---

Add opt-in DuckDB CLI installation, a `duckdb open` workflow for exploring resolved tabular data in DuckDB UI, and generated agent guidance for choosing exploratory UI or durable HTML presentation.
```

- [ ] **Step 5: Run focused tests and commit**

Run the two release-contract commands from Step 2 and expect PASS.

Commit:

```bash
git add README.md apps/cli/README.md docs/commands.md docs/installation.md docs/skills.md docs/security.md apps/cli/test/pack.test.ts apps/cli/test/release-contract.test.ts .changeset/duckdb-ui-workflow.md
git commit -m "docs: document optional DuckDB UI workflow"
```

---

### Task 6: Verify the real workflow and full repository

**Files:**
- Modify only files required by failures attributable to this feature

**Interfaces:**
- Verifies: real staged database compatibility with the installed DuckDB CLI, all repository gates, clean generated state

- [ ] **Step 1: Run formatter and focused suites**

Run:

```bash
pnpm exec prettier --write apps/cli/src/duckdb-ui-runner.ts apps/cli/src/commands/duckdb.ts apps/cli/test/duckdb-ui-runner.test.ts apps/cli/test/duckdb.e2e.test.ts packages/core/src/query-database-cache.ts packages/core/src/queries.ts packages/core/test/query-cache.test.ts apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts README.md apps/cli/README.md docs/commands.md docs/installation.md docs/skills.md docs/security.md docs/superpowers/specs/2026-07-23-duckdb-ui-workflow-design.md docs/superpowers/plans/2026-07-23-duckdb-ui-workflow.md .changeset/duckdb-ui-workflow.md
pnpm exec vitest run --project unit packages/core/test/query-cache.test.ts apps/cli/test/duckdb-ui-runner.test.ts apps/cli/test/agent-skills.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/duckdb.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts apps/cli/test/generate-skills.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 2: Verify against the locally installed real DuckDB CLI without opening a browser**

Build a small CSV, use `QueryService.withDatabase()` in an integration test callback, and run:

```text
duckdb -readonly <leased-database> -c "SELECT count(*) AS count FROM data"
```

Assert the real CLI reports the fixture count. This proves database compatibility without launching a UI or mutating user browser state.

- [ ] **Step 3: Run the complete quality gate**

Run:

```bash
pnpm check
```

Expected: formatting, lint, typecheck, unit, integration, E2E, and package checks all PASS.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git status --short
git diff --check
git diff --stat main...HEAD
git diff main...HEAD -- apps/cli/src packages/core/src skills docs README.md apps/cli/README.md .changeset
```

Confirm no unrelated changes, secrets, installer bytes, generated drift, direct shell-based UI launch, or missing command owner.

- [ ] **Step 5: Commit verification-only fixes**

If verification required changes, commit only those changes:

```bash
git add apps/cli/src apps/cli/test packages/core/src packages/core/test skills README.md apps/cli/README.md docs .changeset
git commit -m "fix: close DuckDB UI verification gaps"
```

---

### Task 7: Push and open the pull request

**Files:**
- No source changes

**Interfaces:**
- Produces: branch `codex/duckdb-ui` on `origin` and a pull request targeting `main`

- [ ] **Step 1: Confirm branch and commit state**

Run:

```bash
git status --short --branch
git log --oneline main..HEAD
```

Expected: clean `codex/duckdb-ui` branch with the design, implementation, skill, docs, and any verification-fix commits.

- [ ] **Step 2: Push the feature branch**

Run:

```bash
git push --set-upstream origin codex/duckdb-ui
```

Expected: remote branch created and upstream configured.

- [ ] **Step 3: Open the pull request**

Run:

```bash
gh pr create --base main --head codex/duckdb-ui --title "feat: open data in DuckDB UI" --body "## Summary
- add opt-in DuckDB CLI installation and a quick DuckDB UI open workflow
- reuse KLOPSI's resolved-input and derived-stage cache pipeline
- teach generated Agent Skills when to use exploratory DuckDB UI versus durable HTML dashboards

## Verification
- pnpm check
- real DuckDB CLI read-only query against a leased staged database"
```

The PR body summarizes the commands, staged-database lease, opt-in official installer, generated agent skill, security boundary, documentation, and exact verification results.

- [ ] **Step 4: Inspect the created PR**

Run:

```bash
gh pr view --json number,title,url,baseRefName,headRefName,state
gh pr checks
```

Expected: an open PR from `codex/duckdb-ui` into `main`; report its URL and any still-pending remote checks without waiting indefinitely.
