# KLopsi Clean-Slate Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every project-owned OPSI identity with KLopsi and prepare the unpublished `klopsi@0.0.1` package for its first npm release.

**Architecture:** Perform one coordinated namespace migration because manifests, workspace imports, public symbols, generated skills, CLI behavior, fixtures, and release assertions must agree atomically. Guard the migration with a repository-wide contract that permits the old string only inside exact external GitHub repository URLs until that repository is renamed.

**Tech Stack:** Node.js 24, TypeScript, pnpm 11, Vitest, tsup, GitHub Actions, npm CLI 11

## Global Constraints

- Publish the unscoped npm package `klopsi@0.0.1`.
- Expose only the `klopsi` CLI executable and `klopsi/sdk` SDK entry point.
- Use `@klopsi/*` for every workspace package scope and `Klopsi` / `KLOPSI` / `klopsi` for project-owned symbols, constants, environment variables, paths, skills, fixtures, and prose.
- Do not add compatibility aliases or migrations for the former unreleased name.
- Preserve `0xfa7ca7/opsi` only where it is the current externally controlled GitHub repository path.
- Preserve upstream URLs and wire literals only when the remote Slovenian public-data service requires them.
- Keep all third-party GitHub Actions pinned to their existing exact Node 24-compatible SHAs.
- Keep version `0.0.1`; npm has not accepted a package version.

---

### Task 1: Add the clean-slate rename contract

**Files:**
- Modify: `apps/cli/test/release-contract.test.ts`

**Interfaces:**
- Consumes: tracked repository files and current package/workflow metadata
- Produces: a unit-test gate requiring the canonical KLopsi package, executable, SDK, workspace scope, release target, and installation documentation

- [ ] **Step 1: Write the failing package and repository identity test**

Add assertions equivalent to:

```ts
const cliPackage = JSON.parse(await text("apps/cli/package.json")) as {
  name: string;
  bin: Record<string, string>;
};
expect(cliPackage.name).toBe("klopsi");
expect(cliPackage.bin).toEqual({ klopsi: "dist/main.js" });

const release = await text(".github/workflows/release.yml");
expect(release).toContain('test "$NAME" = "klopsi"');
expect(release).toContain('npm view "klopsi@$VERSION"');
expect(release).toContain('npm install "klopsi@$VERSION"');

const readme = await text("README.md");
expect(readme).toContain("npm install --global klopsi");
expect(readme).toContain('from "klopsi/sdk"');
```

Add a tracked-file scan using `execFile("git", ["ls-files", "-z"])`. Exclude this migration design and implementation plan as factual records, and remove exact URL occurrences matching the current external repository `github.com/0xfa7ca7/opsi` before asserting that all other contents and paths contain none of `@opsi/`, word-bounded `Opsi`, `OPSI`, or `opsi`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts
```

Expected: FAIL because `apps/cli/package.json` is still named `opsi` and exposes the `opsi` executable.

- [ ] **Step 3: Commit the failing contract**

```bash
git add apps/cli/test/release-contract.test.ts
git commit -m "test: define klopsi rename contract"
```

### Task 2: Rename project-owned paths, namespaces, and symbols

**Files:**
- Rename: `packages/providers/opsi/` to `packages/providers/klopsi/`
- Rename: `packages/testing/fixtures/opsi/` to `packages/testing/fixtures/klopsi/`
- Rename: `skills/opsi/` and `skills/opsi-*/` to `skills/klopsi/` and `skills/klopsi-*/`
- Modify: all tracked TypeScript, JSON, YAML, Markdown, shell, and lockfile text containing project-owned identities under `apps/`, `packages/`, `skills/`, `docs/`, `.github/`, plus root manifests and documentation

**Interfaces:**
- Consumes: `@opsi/*`, `Opsi*`, `OPSI*`, and `opsi` project identities
- Produces: `@klopsi/*`, `Klopsi*`, `KLOPSI*`, and `klopsi` identities with unchanged runtime behavior

- [ ] **Step 1: Rename every project-owned directory**

Use explicit `git mv` operations for the provider, fixture, orchestrator skill, and each ten capability skill directories. Verify:

```bash
rg --files | rg '(^|/)opsi($|[-./])'
```

Expected: only the approved design/plan context or no project-owned path; no provider, fixture, or skill path remains.

- [ ] **Step 2: Apply the mechanical identity mapping to tracked text**

Apply these ordered substitutions to text files returned by ripgrep:

```text
@opsi/  -> @klopsi/
Opsi    -> Klopsi
OPSI    -> KLOPSI
opsi    -> klopsi
```

Then restore every changed `0xfa7ca7/klopsi` repository reference to the still-current external path `0xfa7ca7/opsi`. Do not restore any other old identity.

- [ ] **Step 3: Regenerate and validate workspace metadata**

Run:

```bash
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r typecheck
```

Expected: all workspace packages resolve under `@klopsi/*`; build and typecheck exit 0.

- [ ] **Step 4: Run the focused contract and core unit suite**

```bash
pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts packages/domain/test/domain.test.ts packages/config/test/config.test.ts packages/core/test/catalog.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the namespace migration**

```bash
git add apps packages skills package.json pnpm-lock.yaml tsconfig*.json vitest.config.ts
git commit -m "refactor: rename project identity to klopsi"
```

### Task 3: Align public UX, generated skills, and release automation

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/*.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/catalogue-snapshot.yml`
- Modify: `apps/cli/src/public-sdk.d.ts`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `packages/catalogue-snapshot/test/workflow.test.ts`

**Interfaces:**
- Consumes: renamed package and executable from Task 2
- Produces: installation command `npm install --global klopsi`, executable `klopsi`, SDK import `klopsi/sdk`, canonical tarball `klopsi-0.0.1.tgz`, and npm registry target `klopsi@0.0.1`

- [ ] **Step 1: Review public instructions and declarations after the mechanical rename**

Confirm every current installation, local-use, SDK, completion, diagnostics, and Agent Skills example uses:

```bash
npm install --global klopsi
klopsi --version
npm install klopsi
npx klopsi
```

and:

```ts
import { KlopsiClient, ProviderRegistry } from "klopsi/sdk";
```

- [ ] **Step 2: Verify release workflow bindings**

Require `.github/workflows/release.yml` to check `NAME=klopsi`, query/install/pack `klopsi@$VERSION`, invoke `node_modules/.bin/klopsi`, and publish the downloaded absolute tarball. Preserve the successful-CI polling and protected `npm` environment.

- [ ] **Step 3: Exercise the canonical package locally**

```bash
pnpm build
pnpm exec vitest run --project cli-e2e apps/cli/test/pack.test.ts
```

Expected: the tarball embeds `name: klopsi`, installs a `klopsi` executable, imports `klopsi/sdk`, and all package tests pass.

- [ ] **Step 4: Commit UX and release updates**

```bash
git add README.md apps/cli/README.md docs .github apps/cli/src/public-sdk.d.ts apps/cli/test packages/catalogue-snapshot/test
git commit -m "docs: align klopsi release experience"
```

### Task 4: Enforce the old-identity allowlist and create the external rename backlog

**Files:**
- Modify: `apps/cli/test/release-contract.test.ts`
- Modify: `docs/superpowers/specs/2026-07-21-klopsi-rename-design.md`
- Modify: `docs/superpowers/plans/2026-07-21-klopsi-rename.md`
- External: GitHub issue in `0xfa7ca7/opsi`

**Interfaces:**
- Consumes: complete rename from Tasks 2 and 3
- Produces: zero accidental former-name references and one actionable issue for the externally controlled repository rename

- [ ] **Step 1: Run the repository identity scan**

```bash
rg --hidden -n -i '(^|[^[:alnum:]_])opsi([^[:alnum:]_]|$)|@opsi/' \
  -g '!.git/**' -g '!node_modules/**' -g '!**/dist/**'
```

Review every result. Keep only current external `github.com/0xfa7ca7/opsi` references and the two migration records `docs/superpowers/specs/2026-07-21-klopsi-rename-design.md` and `docs/superpowers/plans/2026-07-21-klopsi-rename.md`; rewrite all other results.

- [ ] **Step 2: Run the rename contract after allowlist review**

```bash
pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts
```

Expected: PASS with no unreviewed old identity.

- [ ] **Step 3: Create the repository-rename GitHub issue**

Create a ready backlog issue titled `Rename GitHub repository from opsi to klopsi` with acceptance criteria:

- rename repository to `0xfa7ca7/klopsi`
- update package `repository`, homepage, bugs, badges, skill-install URLs, trusted-publisher repository claim, local remotes, and documentation
- verify GitHub redirects and release/tag URLs
- rerun the repository identity contract with the temporary external URL allowlist removed

- [ ] **Step 4: Commit final allowlist adjustments**

```bash
git add apps/cli/test/release-contract.test.ts docs/superpowers
git commit -m "test: enforce klopsi identity allowlist"
```

### Task 5: Verify, publish the branch, and prepare release handoff

**Files:**
- Verify: entire repository
- External: GitHub pull request targeting `main`

**Interfaces:**
- Consumes: all rename commits
- Produces: a clean, reviewable PR whose merge commit can receive the protected `v0.0.1` tag

- [ ] **Step 1: Run full local verification**

```bash
pnpm check
git diff --check origin/main...HEAD
git status --short
```

Expected: formatting, lint, typecheck, build, unit, integration, CLI E2E, and package tests all pass; no whitespace errors or unstaged files.

- [ ] **Step 2: Reconfirm npm namespace state**

```bash
npm view klopsi@0.0.1 version
```

Expected: `E404`; no npm package version exists.

- [ ] **Step 3: Push and open a ready PR**

```bash
git push -u origin codex/rename-klopsi
gh pr create --base main --head codex/rename-klopsi --title "refactor: rename project to klopsi"
```

The PR body must summarize the clean-slate package/CLI/SDK/workspace rename, external URL exception, issue link, TDD evidence, canonical package smoke, and complete test counts.

- [ ] **Step 4: Monitor all required checks**

```bash
gh pr checks --watch --interval 10
```

Expected: quality, zsh completion, current Node advisory, and Linux/macOS/Windows exact-install jobs all succeed. Leave the PR for the repository owner to approve and merge through protected `main`.
