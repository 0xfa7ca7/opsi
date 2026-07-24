# Bounded Tabular Data Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an experimental `klopsi profile <input>` command that returns an exact, bounded, agent-friendly field profile over every supported tabular input.

**Architecture:** Add a focused `ProfileService` above the existing `QueryService`. It generates one KLOPSI-owned read-only DuckDB statement combining `SUMMARIZE` with exact grouped frequencies, then maps bounded query rows into public profile types. The CLI delegates all resolution, stage-cache, worker sandbox, timeout, output, and cleanup behavior to existing services.

**Tech Stack:** TypeScript 6, Node.js 24, DuckDB Node API/query worker, Commander, shared KLOPSI renderer, Vitest, pnpm.

## Global Constraints

- The command path is exactly `profile`.
- Default top-value limit is exactly 5; allowed range is 1 through 20.
- Maximum profiled columns is exactly 256; no partial profile is returned.
- Distinct counts and null counts are exact and exclude/include null as documented.
- Top values contain non-null values only and apply to `VARCHAR`, `BOOLEAN`, and `ENUM`.
- Equal frequency ranks order by the `VARCHAR` representation ascending.
- All input resolution, selectors, cache identity, worker timeout/memory/thread/output bounds, and network protections reuse the current query path.
- No new runtime dependency and no second format parser.
- Public SDK types are exported.
- The existing `klopsi-analysis` Agent Skill owns `profile`; do not add a new skill package.

---

### Task 1: Profile SQL and result contract

**Files:**
- Create: `packages/core/src/profiles.ts`
- Create: `packages/core/test/profile.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/client.ts`

**Interfaces:**
- Consumes: `QueryService.execute(input: string, options: QueryServiceOptions)`
- Produces: `ProfileService.execute(input: string, options?: ProfileServiceOptions)`
- Produces: `FieldProfile`, `ProfileTopValue`, `ProfileServiceOptions`, `ProfileServiceResult`
- Produces: `KlopsiClient.profile`

- [ ] **Step 1: Write failing profile service tests**

Create a query stub that records the generated SQL and returns representative DuckDB JSON rows:

```ts
const query = {
  execute: vi.fn(async () => ({
    rows: [
      {
        column_name: "amount",
        column_type: "BIGINT",
        minimum: "1",
        maximum: "3",
        average: "2.0",
        row_count: "4",
        non_null_count: "3",
        distinct_count: "3",
        top_values: [],
      },
      {
        column_name: "city",
        column_type: "VARCHAR",
        minimum: "Celje",
        maximum: "Žalec",
        average: null,
        row_count: "4",
        non_null_count: "3",
        distinct_count: "2",
        top_values: [
          { value: "Ljubljana", count: "2" },
          { value: "Celje", count: "1" },
        ],
      },
    ],
    truncated: false,
    source: "/tmp/data.csv",
    durationMs: 12,
    cache: { status: "hit", kind: "duckdb-stage" },
    warnings: [],
  })),
};
```

Assert exact counts/rates, numeric conversion, categorical top values, deterministic SQL clauses, default `top = 5`, and passthrough of timeout/selectors/network/worker settings. Add separate tests for:

```ts
await expect(service.execute("data.csv", { top: 0 })).rejects.toMatchObject({
  code: "PROFILE_TOP_LIMIT",
  exitCode: 2,
});
await expect(service.execute("data.csv", { top: 21 })).rejects.toMatchObject({
  code: "PROFILE_TOP_LIMIT",
});
await expect(service.execute("data.csv")).rejects.toMatchObject({
  code: "PROFILE_COLUMN_LIMIT",
  exitCode: 7,
});
await expect(service.execute("data.csv")).rejects.toMatchObject({
  code: "PROFILE_RESULT_INVALID",
  exitCode: 7,
});
```

Use a truncated stub result for the column limit and malformed numeric/count rows for result validation. Add a safe-scalar case where `9007199254740993` remains a string.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```sh
pnpm exec vitest run --project unit packages/core/test/profile.test.ts
```

Expected: FAIL because `ProfileService` and its public types do not exist.

- [ ] **Step 3: Implement the minimal profile service**

Implement constants and types:

```ts
export const DEFAULT_PROFILE_TOP = 5;
export const MAX_PROFILE_TOP = 20;
export const MAX_PROFILE_COLUMNS = 256;

export interface ProfileTopValue {
  readonly value: string | number | boolean;
  readonly count: number;
  readonly rate: number;
}

export interface FieldProfile {
  readonly name: string;
  readonly type: string;
  readonly rowCount: number;
  readonly nullCount: number;
  readonly nullRate: number;
  readonly distinctCount: number;
  readonly min: string | number | boolean | null;
  readonly max: string | number | boolean | null;
  readonly mean: string | number | null;
  readonly topValues: readonly ProfileTopValue[];
}
```

Build one statement with these CTE responsibilities:

```sql
summary AS (SELECT * FROM (SUMMARIZE data)),
long_values AS (
  SELECT column_name, value
  FROM (UNPIVOT (SELECT COLUMNS(*)::VARCHAR FROM data)
        ON COLUMNS(*) INTO NAME column_name VALUE value)
),
frequencies AS (
  SELECT column_name, value, count(*) AS frequency
  FROM long_values GROUP BY ALL
),
column_counts AS (
  SELECT column_name, sum(frequency) AS non_null_count,
         count(*) AS distinct_count
  FROM frequencies GROUP BY column_name
),
ranked AS (
  SELECT frequencies.*,
         row_number() OVER (
           PARTITION BY column_name ORDER BY frequency DESC, value ASC
         ) AS value_rank
  FROM frequencies
  JOIN summary USING (column_name)
  WHERE column_type = 'VARCHAR'
     OR column_type = 'BOOLEAN'
     OR column_type LIKE 'ENUM%'
)
```

Collect only `value_rank <= <validated top>`, left join all summary columns, preserve summary order with `row_number()`, and alias raw fields to the names used by the mapper.

Delegate with `limit: MAX_PROFILE_COLUMNS` so `QueryService` reports truncation for a wider source. Convert rates as `count / rowCount` with zero-row rate `0`. Throw typed `KlopsiError` values for invalid top, truncated columns, and malformed rows.

Export the service/types from `packages/core/src/index.ts`, instantiate it in `KlopsiClient`, and expose `readonly profile`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```sh
pnpm exec vitest run --project unit packages/core/test/profile.test.ts
pnpm --filter @klopsi/core typecheck
```

Expected: PASS.

### Task 2: CLI registration and end-to-end behavior

**Files:**
- Create: `apps/cli/src/commands/profile.ts`
- Create: `apps/cli/test/profile.e2e.test.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/test/complete-surface.e2e.test.ts`

**Interfaces:**
- Consumes: `client.profile.execute`
- Produces: `klopsi profile <input>`
- Options: `--top`, `--timeout-ms`, `--sheet`, `--entry`, `--record-path`, and network overrides

- [ ] **Step 1: Write failing command-surface and CLI tests**

Add `profile` to the complete command list and action-only adapter list. Create an E2E fixture:

```csv
city,amount,active
Ljubljana,1,true
Ljubljana,2,true
Celje,,false
```

Assert:

```ts
expect(result.json).toMatchObject({
  data: [
    expect.objectContaining({
      name: "city",
      rowCount: 3,
      nullCount: 0,
      distinctCount: 2,
      topValues: [
        { value: "Ljubljana", count: 2, rate: 2 / 3 },
      ],
    }),
    expect.objectContaining({
      name: "amount",
      nullCount: 1,
      nullRate: 1 / 3,
      min: 1,
      max: 2,
      mean: 1.5,
      topValues: [],
    }),
  ],
  meta: {
    rowCount: 3,
    columnCount: 3,
    top: 1,
    cache: { kind: "duckdb-stage" },
  },
});
```

Also assert human headers, first-run miss/second-run hit, cache bypass with a zero budget, `--top 21` exit 2/`PROFILE_TOP_LIMIT`, and a short `--timeout-ms` maps to the existing query timeout category when the profile exceeds the deadline.

- [ ] **Step 2: Build and run the focused tests to verify RED**

Run:

```sh
pnpm build
pnpm exec vitest run --project cli-e2e apps/cli/test/profile.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts
```

Expected: FAIL because `profile` is absent from the manifest and program.

- [ ] **Step 3: Implement manifest and action-only adapter**

Add:

```ts
leaf(
  "profile",
  "Profile bounded tabular data",
  [argument("<input>", "local path or canonical resource reference")],
  [
    option("--top <values>", "maximum top values per categorical field", {
      parser: "positive",
      defaultValue: 5,
    }),
    option("--timeout-ms <milliseconds>", "hard profile deadline", { parser: "positive" }),
    option("--sheet <name>", "XLSX sheet name"),
    option("--entry <path>", "ZIP data entry path"),
    option("--record-path <path>", "XML record element path"),
    ...NETWORK_OPTIONS,
  ],
)
```

Register `registerProfileCommand` in `program.ts`. Its action must:

- merge command/config/global timeout and DuckDB memory/thread values exactly like query;
- forward selectors and network overrides;
- install and remove SIGINT/SIGTERM abort handlers;
- print cache-bypass warnings unless quiet;
- call `context.renderer?.write(result.fields, meta)` with source, row/column counts, top, duration, cache, and warnings.

- [ ] **Step 4: Build and run focused tests to verify GREEN**

Run:

```sh
pnpm build
pnpm exec vitest run --project cli-e2e apps/cli/test/profile.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts
```

Expected: PASS.

### Task 3: Public declarations and documentation

**Files:**
- Modify: `apps/cli/src/sdk.ts`
- Modify through build: `apps/cli/src/public-sdk.d.ts`
- Modify through build if needed: `apps/cli/src/public-main.d.ts`
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Modify: `apps/cli/src/agent-skills.ts`
- Modify through generation: `skills/klopsi-analysis/SKILL.md`
- Modify through generation: `skills/klopsi/SKILL.md`
- Modify through generation: selector-aware related skills
- Modify: `docs/skills.md`
- Modify: `apps/cli/test/release-contract.test.ts`
- Modify: `apps/cli/test/pack.test.ts` if declaration assertions require it

**Interfaces:**
- Produces package exports for the profile result/options/types.
- Produces synchronized root, packaged, and command documentation.

- [ ] **Step 1: Write failing package/documentation contract tests**

Require:

```ts
expect(await text("README.md")).toContain("klopsi profile");
expect(await text("apps/cli/README.md")).toContain("klopsi profile");
expect(await text("docs/commands.md")).toContain("### `profile`");
expect(await text("docs/commands.md")).toContain("--top");
expect(await text("apps/cli/src/public-sdk.d.ts")).toContain("interface FieldProfile");
```

The existing manifest/reference synchronization test will also require all profile options in its command section. Agent-skill tests require `profile` to be owned exactly once by `klopsi-analysis` and add a `bounded-profile` capability.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```sh
pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts
```

Expected: FAIL on missing profile docs/declarations.

- [ ] **Step 3: Add SDK exports and user documentation**

Export profile types from `apps/cli/src/sdk.ts`. Update the root and packaged quick-start command tables with:

```sh
klopsi profile ./downloads/data.csv --top 5 --json
```

Add `### profile` to `docs/commands.md` with syntax, supported inputs/selectors, exact counts, fractional rates, categorical type rule, default/maximum top bounds, 256-column failure behavior, query-worker bounds, cache metadata, and an example.

Add `profile` to the `klopsi-analysis` command ownership list and generated guidance. Run the normal CLI build so `copy-public-declarations.mjs` refreshes declarations, then regenerate checked-in skills and synchronize `docs/skills.md`.

- [ ] **Step 4: Run contract and package tests to verify GREEN**

Run:

```sh
pnpm build
pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts
pnpm test:pack
```

Expected: PASS.

### Task 4: Full verification, security review, and publication

**Files:**
- Review: every changed file
- Create: one conventional commit
- Remote: `origin/codex/experiment-data-profile`
- Draft PR target: `main`

- [ ] **Step 1: Format and inspect**

Run:

```sh
pnpm exec prettier --write \
  packages/core/src/profiles.ts \
  packages/core/test/profile.test.ts \
  apps/cli/src/commands/profile.ts \
  apps/cli/test/profile.e2e.test.ts \
  docs/superpowers/specs/2026-07-24-data-profile-design.md \
  docs/superpowers/plans/2026-07-24-data-profile.md \
  README.md apps/cli/README.md docs/commands.md
git diff --check
git diff --stat
git diff
```

Confirm no user SQL, shell invocation, new network path, secret, unbounded frequency option, unrelated refactor, or generated artifact drift.

- [ ] **Step 2: Run fresh verification**

Run:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec vitest run --project unit packages/core/test/profile.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/profile.e2e.test.ts
pnpm test:integration
pnpm test:e2e
pnpm test:pack
pnpm check
```

Record complete exit results. If the known baseline concurrent timing cases recur, rerun each failing file in isolation and report both full-suite and isolated evidence. Fix every profile-related failure.

- [ ] **Step 3: Commit intended scope**

Run:

```sh
git status -sb
git add \
  packages/core/src/profiles.ts packages/core/test/profile.test.ts \
  packages/core/src/index.ts packages/core/src/client.ts \
  apps/cli/src/commands/profile.ts apps/cli/test/profile.e2e.test.ts \
  apps/cli/src/command-manifest.ts apps/cli/src/program.ts \
  apps/cli/src/sdk.ts apps/cli/src/public-sdk.d.ts apps/cli/src/public-main.d.ts \
  apps/cli/test/complete-surface.e2e.test.ts \
  apps/cli/test/release-contract.test.ts apps/cli/test/pack.test.ts \
  README.md apps/cli/README.md docs/commands.md \
  docs/superpowers/specs/2026-07-24-data-profile-design.md \
  docs/superpowers/plans/2026-07-24-data-profile.md
git commit -m "feat: add bounded tabular data profiles"
```

Omit any listed file that remains unchanged; add any profile-owned generated declaration that the build legitimately refreshes.

- [ ] **Step 4: Push and open a detailed draft PR**

After authenticated `gh` checks:

```sh
git push -u origin codex/experiment-data-profile
gh pr create --draft --base main --head codex/experiment-data-profile \
  --title "feat: experiment with bounded tabular data profiles" \
  --body-file <temporary-pr-body>
```

The PR body must cover official research links/patterns, experimental opportunity, exact CLI/JSON examples, architecture/data flow, safety/bounds, cache behavior, tests/commands, benefits, tradeoffs/limitations, open experimental questions, and a reviewer checklist. It must avoid claiming performance superiority or general benchmark wins.
