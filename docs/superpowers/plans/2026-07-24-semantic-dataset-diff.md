# Semantic Dataset Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an experimental, bounded `klopsi diff <before> <after> --key <column>` command that reports schema and keyed row changes.

**Architecture:** Resolve both inputs through `DataService`, co-locate them as two tables with the existing DuckDB staging adapter, and execute generated relational comparison SQL in the existing isolated read-only worker. Keep exact counts in DuckDB and return only schema metadata plus deterministic bounded samples.

**Tech Stack:** TypeScript 6, Node.js 24, Commander 15, DuckDB Node API 1.5.4-r.1, Vitest 4, pnpm 11.

## Global Constraints

- The feature is explicitly experimental, local/read-only, and does not retain revision history.
- One or more explicit key columns are required; keys must exist with identical inferred types, contain no null component, and be unique on each side.
- Default sample limit is 10 per class and maximum sample limit is 100.
- At most 256 source columns are compared.
- Generated SQL escapes every identifier and runs through the existing read-only query worker.
- Exact counts stay in DuckDB; JavaScript receives only column metadata and bounded samples.
- No new dependency or unrelated refactor is allowed.

---

### Task 1: Public contracts and identifier construction

**Files:**
- Modify: `packages/domain/src/results.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/data-engine/src/sql-identifier.ts`
- Test: `packages/data-engine/test/diff.test.ts`
- Test: `packages/domain/test/domain.test.ts`

**Interfaces:**
- Produces: `DataDiffResult`, `DataDiffSchemaChange`, `DataDiffRowSample`, and `sqlIdentifier(value: string): string`.

- [ ] **Step 1: Write failing contract tests**

Add assertions that `sqlIdentifier('county"id')` is `"county""id"` and type fixtures that construct a `DataDiffResult` with summary, schema, samples, bounds, duration, and warnings.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm vitest run --project unit packages/data-engine/test/diff.test.ts packages/domain/test/domain.test.ts
```

Expected: failure because `sql-identifier.ts` and the diff result exports do not exist.

- [ ] **Step 3: Implement the minimal contracts**

Define the result interfaces exactly as specified in the design and implement:

```ts
export function sqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command and expect all focused tests to pass.

### Task 2: Two-table staging and semantic comparison engine

**Files:**
- Modify: `packages/data-engine/src/tabular-stage.ts`
- Create: `packages/data-engine/src/diff.ts`
- Modify: `packages/data-engine/src/index.ts`
- Test: `packages/data-engine/test/diff.test.ts`

**Interfaces:**
- Consumes: `sqlIdentifier`, `stageTabularInput`, `DuckDbQueryRunner`.
- Produces: `DatasetDiffEngine.compare(options): Promise<DataDiffEngineResult>`.

- [ ] **Step 1: Add failing real-engine tests**

Cover exact added/removed/changed/unchanged counts, schema additions/removals/type
changes, composite and embedded-quote keys, row-order independence, deterministic
per-class samples, and stable errors for missing/type-mismatched/null/duplicate
keys.

- [ ] **Step 2: Run the engine test and verify RED**

Run:

```bash
pnpm vitest run --project unit packages/data-engine/test/diff.test.ts
```

Expected: failure because `DatasetDiffEngine` and named staging tables do not exist.

- [ ] **Step 3: Extend staging minimally**

Add a closed `StagedTableName = "data" | "before_data" | "after_data"` option,
escape it with `sqlIdentifier`, and include `type: result.columnType(index).toString()`
in `StagedColumn`. Preserve `data` as the default so query behavior is unchanged.

- [ ] **Step 4: Implement comparison SQL and cleanup**

Create a temporary database, stage/checkpoint/close both sides, validate column/key
limits, run key-quality SQL, fail on invalid keys, then run the full-join/window
query. Parse count strings safely to JavaScript safe integers, parse only bounded
JSON rows, calculate schema and changed-column metadata, and remove all temporary
artifacts in `finally`.

- [ ] **Step 5: Run the engine test and verify GREEN**

Run the Step 2 command and expect all engine tests to pass with no warnings.

### Task 3: Core service and CLI registration

**Files:**
- Create: `packages/core/src/diffs.ts`
- Modify: `packages/core/src/client.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/cli/src/commands/diff.ts`
- Create: `apps/cli/src/diff-presentation.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/program.ts`
- Test: `packages/core/test/diffs.test.ts`
- Test: `apps/cli/test/presentation.test.ts`
- Test: `apps/cli/test/complete-surface.e2e.test.ts`

**Interfaces:**
- Consumes: `DatasetDiffEngine.compare`, nested `DataService.withResolvedInput`.
- Produces: `DiffService.compare(before, after, options)` and the CLI
  `diff <before> <after> --key <column>`.

- [ ] **Step 1: Add failing service, presentation, and surface tests**

Assert that both inputs remain leased during the injected engine call; all
side-specific selection/network options are forwarded; human rendering contains
summary/schema/sample sections; and registered arguments/options match the manifest.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run --project unit packages/core/test/diffs.test.ts apps/cli/test/presentation.test.ts apps/cli/test/complete-surface.e2e.test.ts
```

Expected: failure because the service, presentation, and command are absent.

- [ ] **Step 3: Implement core orchestration**

Resolve `before` and `after` in nested leases, call the engine, attach resolved
source paths and duration, expose `client.diff`, and export the service/options.

- [ ] **Step 4: Implement command and output adapters**

Add the manifest entry with mandatory collectable keys, sample limit, side-specific
sheet/entry/record-path options, and network overrides. Register the adapter in
`program.ts`. Use a dedicated sanitized human renderer and the ordinary renderer
for JSON. Flatten rows into deterministic events for NDJSON/CSV/TSV.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command and expect all focused tests to pass.

### Task 4: End-to-end and package contracts

**Files:**
- Create: `apps/cli/test/diff.e2e.test.ts`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `apps/cli/src/public-sdk.d.ts`
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Modify: `docs/architecture.md`
- Create: `.changeset/experimental-semantic-diff.md`

**Interfaces:**
- Consumes: public domain/core result and service interfaces.
- Produces: package-consumer types and documented CLI behavior.

- [ ] **Step 1: Add failing E2E and package-consumer assertions**

Exercise CSV-to-CSV human and JSON comparisons, deterministic repeated output,
composite keys, and duplicate/null/missing-key error envelopes. Compile a packed
consumer that imports `DataDiffResult` and invokes `client.diff.compare`.

- [ ] **Step 2: Run E2E and pack-focused checks and verify RED**

Run:

```bash
pnpm build
pnpm vitest run --project cli-e2e apps/cli/test/diff.e2e.test.ts
pnpm test:pack
```

Expected before declarations/docs are completed: E2E command or package consumer
failure identifies the missing public surface.

- [ ] **Step 3: Complete declarations, documentation, and changeset**

Mirror the public diff types and service in the hand-curated declaration. Add
command examples, experimental label, key-quality semantics, bounds, supported
inputs, output concepts, and security architecture to both readmes and detailed
documentation. Add a minor CLI changeset because the experiment adds a command and
SDK surface.

- [ ] **Step 4: Run targeted verification**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm vitest run --project unit packages/data-engine/test/diff.test.ts packages/core/test/diffs.test.ts apps/cli/test/presentation.test.ts apps/cli/test/complete-surface.e2e.test.ts
pnpm vitest run --project cli-e2e apps/cli/test/diff.e2e.test.ts
pnpm test:pack
```

Expected: all targeted commands exit 0.

### Task 5: Full verification and draft PR

**Files:**
- Review: all files changed from `origin/main`

- [ ] **Step 1: Run the complete gate**

Run:

```bash
pnpm check
```

Expected: exit 0, or only independently reproduced baseline load-sensitive timing
failures with all feature-targeted checks green.

- [ ] **Step 2: Review scope and security**

Run:

```bash
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
git status --short
```

Confirm no raw identifier interpolation, unbounded result collection, unrelated
refactors, generated artifacts, or input mutations.

- [ ] **Step 3: Commit**

```bash
git add .changeset README.md apps packages docs
git commit -m "feat: experiment with semantic dataset diffs"
```

- [ ] **Step 4: Push and open a draft PR**

```bash
git push -u origin codex/experiment-data-diff
gh pr create --draft --base main --head codex/experiment-data-diff --title "feat: experiment with semantic dataset diffs" --body-file <prepared-body>
```

The PR body must cover research translation, use case, commands/output, SQL flow,
correctness/security, validation, tradeoffs, known limits, experimental questions,
and a reviewer checklist.
