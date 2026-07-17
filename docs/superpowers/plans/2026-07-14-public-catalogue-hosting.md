# Public Catalogue Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish validated catalogue snapshots from the private source repository to a public data-only GitHub Pages repository and make the local CLI consume them.

**Architecture:** The private scheduled workflow generates the existing bounded snapshot site, then pushes it beneath `opsi/` in `0xfa7ca7/0xfa7ca7.github.io` using a repository-scoped Ed25519 deploy key. GitHub Pages serves the public `gh-pages` branch, preserving the CLI's existing strict-reader URL at `https://0xfa7ca7.github.io/opsi/`.

**Tech Stack:** GitHub Actions, GitHub Pages, Git deploy keys, Node.js 24, pnpm 11, TypeScript, Vitest

## Global Constraints

- Keep `0xfa7ca7/opsi` private and publish no source code to the data repository.
- Store only the deploy-key private half in the `CATALOGUE_DEPLOY_KEY` secret of the `catalogue-production` environment, whose custom deployment-branch policy allows only `master`.
- Keep the six-hour schedule, 24-hour client freshness limit, and 48-hour artifact retention.
- Do not use a personal access token or an unpinned third-party deployment action.
- The deployment is successful only after the public digest and generation timestamp match.

---

### Task 1: External hosting contracts

**Files:**
- Modify: `packages/catalogue-snapshot/test/workflow.test.ts`
- Inspect: `packages/catalogue-snapshot/test/remote.integration.test.ts`

**Interfaces:**
- Consumes: `.github/workflows/catalogue-snapshot.yml`, `DEFAULT_CATALOGUE_BASE_URL`
- Produces: executable contracts for the public repository, branch, endpoint, secret, and build selectors

- [ ] **Step 1: Write failing assertions** for `https://0xfa7ca7.github.io/opsi/`, `git@github.com:0xfa7ca7/0xfa7ca7.github.io.git`, the generated `opsi/` directory, `gh-pages`, the `catalogue-production` environment, and `secrets.CATALOGUE_DEPLOY_KEY`, while retaining the per-job `@opsi/catalogue-snapshot...` build assertions.
- [ ] **Step 2: Run** `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/workflow.test.ts packages/catalogue-snapshot/test/remote.integration.test.ts` **and confirm failure** because the old Pages endpoint and deployment action remain.
- [ ] **Step 3: Commit only after Tasks 2 and 3 make these contracts pass.**

### Task 2: Scoped branch deployment

**Files:**
- Modify: `.github/workflows/catalogue-snapshot.yml`

**Interfaces:**
- Consumes: generated `site/`, `secrets.CATALOGUE_DEPLOY_KEY`
- Produces: force-updated `gh-pages` branch at `git@github.com:0xfa7ca7/0xfa7ca7.github.io.git` with catalogue files beneath `opsi/`

- [ ] **Step 1: Replace** Pages artifact upload and OIDC deployment with a job that downloads the generated site artifact beneath `opsi/`, writes the masked Ed25519 key with mode `0600`, pins GitHub's SSH host key, commits only generated files, and force-pushes `gh-pages`.
- [ ] **Step 2: Keep generation isolated** with `contents: read`, give deployment no repository write permission, and delete the key file in an `always()` cleanup step.
- [ ] **Step 3: Keep verification targeted at** `https://0xfa7ca7.github.io/opsi/` and retry the existing strict verifier for bounded Pages propagation before failing.
- [ ] **Step 4: Run the Task 1 tests** and confirm the workflow contract passes.

### Task 3: Stable client endpoint and operator documentation

**Files:**
- Inspect: `packages/catalogue-snapshot/src/remote.ts`
- Modify: `docs/catalogue-service.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: public Pages base URL
- Produces: documentation and regression coverage preserving `DEFAULT_CATALOGUE_BASE_URL = "https://0xfa7ca7.github.io/opsi/"`

- [ ] **Step 1: Preserve the default URL** and keep its integration assertion at `https://0xfa7ca7.github.io/opsi/`.
- [ ] **Step 2: Update operator documentation** to describe the data-only repository, deploy-key rotation, branch-based Pages setup, and public verification commands.
- [ ] **Step 3: Run** `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/workflow.test.ts packages/catalogue-snapshot/test/remote.integration.test.ts` **and confirm all contracts pass.**
- [ ] **Step 4: Run** `pnpm format:check && pnpm lint && pnpm test` **and confirm the repository suite passes.**
- [ ] **Step 5: Commit** workflow, client, tests, design, plan, and documentation with a focused deployment message.

### Task 4: GitHub service provisioning and live proof

**Files:**
- External: public repository `0xfa7ca7/0xfa7ca7.github.io`
- External: private repository environment `catalogue-production` and its `CATALOGUE_DEPLOY_KEY` secret

**Interfaces:**
- Consumes: the trusted default-branch workflow and `catalogue-production` environment-scoped deploy key
- Produces: public `v1/latest.json` and immutable snapshot URL

- [ ] **Step 1: Create** the public data-only user-site repository with no source checkout or reusable credential.
- [ ] **Step 2: Create** the `catalogue-production` environment with a custom deployment-branch policy allowing only `master`; generate a new Ed25519 key pair, add its public half as a write-enabled deploy key on `0xfa7ca7.github.io`, set its private half as that environment's `CATALOGUE_DEPLOY_KEY` secret, remove any repository-level secret of the same name, and securely remove the local private key.
- [ ] **Step 3: Push an initial generated site** through the trusted workflow, then configure Pages from `gh-pages` at `/` and rerun if initial Pages provisioning requires the branch first.
- [ ] **Step 4: Confirm** the publication workflow is green and `v1/latest.json` is younger than 24 hours with a matching referenced snapshot digest.
- [ ] **Step 5: Mark the source PR ready** after all required checks pass; do not merge it automatically.

### Task 5: Local CLI verification

**Files:**
- Local installation: pnpm global `opsi` binary

**Interfaces:**
- Consumes: verified CLI package and public snapshot endpoint
- Produces: a working `opsi dataset list` on this machine

- [ ] **Step 1: Build and package** the exact feature-branch CLI using the repository's pack verification flow.
- [ ] **Step 2: Install or link** the verified package into the existing pnpm global binary location.
- [ ] **Step 3: Run** `opsi dataset list --refresh --json` and assert a nonzero dataset count plus `id`, `title`, and `name` fields.
- [ ] **Step 4: Run the list offline** from the validated cache and confirm it returns the same count without a public request.
