# Public npm Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the repository with public, provenance-backed npm publication of `opsi` from `0xfa7ca7/opsi`.

**Architecture:** Preserve the existing tag-triggered release workflow and its canonical-tarball checks. Make repository identity and branch assumptions explicit in metadata, tests, and current operator documentation; leave historical decision records unchanged.

**Tech Stack:** npm 11, pnpm 11.11.0, Changesets 2.31.0, Vitest 4.1.10, GitHub Actions OIDC

## Global Constraints

- Publish only the `opsi` package; workspace packages remain private.
- Publish only canonical tarball bytes produced and tested by CI.
- Use npm trusted publishing without a stored npm token.
- Retain provenance, which requires a public source repository and public npm package.
- Use `main` as the repository default and Changesets base branch.

---

### Task 1: Enforce release identity

**Files:**
- Modify: `apps/cli/test/version.test.ts`
- Modify: `apps/cli/package.json`
- Modify: `.changeset/config.json`

**Interfaces:**
- Consumes: package metadata and Changesets JSON configuration
- Produces: a test-enforced repository URL and base branch

- [x] **Step 1: Add assertions** that `repository.url` equals `git+https://github.com/0xfa7ca7/opsi.git` and `baseBranch` equals `main`.
- [x] **Step 2: Run** `pnpm exec vitest run --project unit apps/cli/test/version.test.ts` and confirm the new assertions fail against the old values.
- [x] **Step 3: Update** `apps/cli/package.json` and `.changeset/config.json` to the asserted values.
- [x] **Step 4: Re-run** the focused unit test and confirm it passes.

### Task 2: Align current documentation

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/catalogue-service.md`
- Modify: `docs/installation.md`

**Interfaces:**
- Consumes: the public `0xfa7ca7/opsi` source repository and existing generated-data deployment architecture
- Produces: accurate package and operator documentation

- [x] **Step 1: Replace** the obsolete `opsi-cli/opsi` package-documentation URL with `0xfa7ca7/opsi`.
- [x] **Step 2: Make** npm the primary installation path and update the exact release-tarball example to `0.2.0`.
- [x] **Step 3: Describe** the source repository as public while retaining the generated-data-only boundary and protected deploy-key guidance.
- [x] **Step 4: Replace** current operational `master` branch references with `main`.
- [x] **Step 5: Run** `pnpm format:check` and confirm all edited documentation is formatted.

### Task 3: Verify release readiness

**Files:**
- Verify: `.changeset/complete-cli.md`
- Verify: `.github/workflows/ci.yml`
- Verify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the complete release candidate and existing CI/release workflows
- Produces: fresh evidence for versioning and package release readiness

- [x] **Step 1: Run** `pnpm changeset status` and confirm it resolves against `main` and reports the pending `opsi` release.
- [x] **Step 2: Run** `pnpm check` and confirm formatting, lint, type checks, unit, integration, CLI E2E, and canonical package tests pass.
- [x] **Step 3: Run** `git diff --check` and inspect `git diff --stat` to confirm the patch is clean and scoped.
- [x] **Step 4: Report** the remaining GitHub visibility, environment, tag ruleset, and npm trust setup without publishing or creating a release tag.
