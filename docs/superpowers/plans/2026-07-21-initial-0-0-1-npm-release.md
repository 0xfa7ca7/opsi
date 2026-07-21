# Initial 0.0.1 npm Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset the unreleased project history so the first public npm release of `opsi` is version `0.0.1` and every shipped/generated artifact reports that version.

**Architecture:** Keep the existing exact-tarball GitHub release pipeline and provenance checks. Treat all current Changesets and changelog entries as development history, consolidate them into the initial `0.0.1` release entry, regenerate version-bearing Agent Skills, and use one protected short-lived token to bootstrap the package before switching permanently to OIDC trusted publishing.

**Tech Stack:** pnpm 11, npm CLI, Changesets, TypeScript, Vitest, GitHub Actions trusted publishing

## Global Constraints

- The first public npm package version is exactly `0.0.1`.
- The first release tag is exactly `v0.0.1`.
- No local npm publish path is added; only `0.0.1` may use the protected bootstrap token, and every later version requires OIDC trusted publishing with the token removed.
- Existing private workspace packages remain private.
- The canonical npm tarball and release workflow remain the release gate.

---

### Task 1: Lock the initial public release contract

**Files:**
- Modify: `apps/cli/test/version.test.ts`
- Modify: `apps/cli/test/release-contract.test.ts`

**Interfaces:**
- Consumes: `apps/cli/package.json`, `apps/cli/CHANGELOG.md`, generated `skills/*/SKILL.md`
- Produces: an explicit test contract for public version `0.0.1`, initial changelog history, and synchronized generated skills

- [x] **Step 1: Write failing release metadata assertions**

Add assertions that the public package is `0.0.1`, the changelog begins at `0.0.1` without unreleased development versions, and release-facing generated skill files report `0.0.1`.

- [x] **Step 2: Run the focused tests and verify failure**

Run: `pnpm exec vitest run --project unit apps/cli/test/version.test.ts apps/cli/test/release-contract.test.ts`

Expected: FAIL because the current public package, changelog, and generated skills report `0.2.0`.

### Task 2: Consolidate unreleased history as 0.0.1

**Files:**
- Modify: `package.json`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/CHANGELOG.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/releases.md`
- Modify: `packages/*/package.json`
- Modify: `packages/providers/*/package.json`
- Delete: `.changeset/agent-skills.md`
- Delete: `.changeset/automatic-agent-setup.md`
- Delete: `.changeset/complete-agent-skill-guidance.md`
- Delete: `.changeset/documentation-consistency.md`
- Delete: `.changeset/multi-format-resource-access.md`
- Create: `.changeset/initial-0-0-1.md`
- Regenerate: `skills/*/SKILL.md`

**Interfaces:**
- Consumes: all unreleased Changeset summaries and the Agent Skills renderer
- Produces: one coherent development baseline and first release history at version `0.0.1`

- [x] **Step 1: Set workspace package versions to 0.0.1**

Change every workspace `package.json` version to `0.0.1`, including the public `opsi` package.

- [x] **Step 2: Consolidate changelogs**

Replace the development-only `0.1.0` and `0.2.0` headings with a single `0.0.1` initial release entry that includes the accumulated CLI, SDK, data-format, Agent Skills, documentation, catalogue, security, and trusted-publishing work.

- [x] **Step 3: Consume pre-release Changesets**

Delete the five version-bumping Changeset markdown files because their work is included in the initial `0.0.1` baseline. Keep `.changeset/config.json` and add one empty bookkeeping Changeset so `changeset status` accepts the changed public package without advancing it beyond `0.0.1`.

- [x] **Step 4: Document the first release handoff**

Add an operator checklist for validating `opsi@0.0.1` availability, confirming GitHub/npm trusted-publisher setup, and pushing the annotated `v0.0.1` tag without publishing locally.

- [x] **Step 5: Regenerate committed Agent Skills**

Run: `node apps/cli/dist/main.js generate-skills --output-dir ./skills --json`

Expected: 11 generated skills whose headers report `opsi` version `0.0.1`.

- [x] **Step 6: Run focused tests**

Run: `pnpm exec vitest run --project unit apps/cli/test/version.test.ts apps/cli/test/release-contract.test.ts apps/cli/test/agent-skills.test.ts`

Expected: PASS.

### Task 3: Verify npm release readiness

**Files:**
- Verify: `apps/cli/package.json`
- Verify: `.github/workflows/release.yml`
- Verify: generated npm tarball

**Interfaces:**
- Consumes: the complete repository and release workflow
- Produces: fresh evidence that `opsi@0.0.1` builds, packs, installs, and passes all repository gates

- [x] **Step 1: Verify Changesets has no pending development bump**

Run: `pnpm changeset status --output /tmp/opsi-changeset-status.json`

Expected: no pending release entry for `opsi`.

- [x] **Step 2: Run the complete quality gate**

Run: `pnpm check`

Expected: PASS with zero test failures.

- [x] **Step 3: Inspect a publish dry run**

Run: `npm publish ./apps/cli --dry-run --access public --json`

Expected: the dry-run package is named `opsi`, versioned `0.0.1`, and contains only the allowlisted runtime, SDK, README, license, and package metadata.

- [x] **Step 4: Verify registry availability without publishing**

Run: `npm view opsi@0.0.1 version`

Expected: npm returns `E404`, confirming the immutable version has not already been published.

### Task 4: Correct first-publish authentication

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `docs/releases.md`
- Modify: `apps/cli/test/release-contract.test.ts`

**Interfaces:**
- Consumes: npm's requirement that a package exist before trusted publishing can be configured
- Produces: a one-time protected-token bootstrap for `0.0.1` and an enforced OIDC-only path for later versions

- [x] **Step 1: Add failing bootstrap release assertions**

Assert that the workflow requires `NPM_TOKEN` for `0.0.1`, rejects it for later versions, and passes it only to `npm publish`.

- [x] **Step 2: Verify the release assertions fail**

Run: `pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts`

Expected: FAIL because the OIDC-only workflow cannot publish a package that does not yet exist.

- [x] **Step 3: Implement and document the bootstrap transition**

Use the protected environment secret for `0.0.1`, retain provenance, document `npm trust github`, and require deletion of the secret before later releases.

- [x] **Step 4: Verify the corrected contract and full release gate**

Run: `pnpm check`

Expected: PASS with zero test failures.
