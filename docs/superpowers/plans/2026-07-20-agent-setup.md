# Automatic Agent Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `opsi agent setup` so one command installs the embedded OPSI Agent Skills globally into automatically detected or explicitly selected agent hosts.

> **Post-review hardening:** The final implementation adds `agent-hosts.ts`, synchronized with the globally installable profiles and local detection markers in `skills@1.5.19`. OPSI resolves and validates targets itself, fails on empty detection, confirms multiple detected hosts itself, and always invokes the installer with explicit agent IDs plus `--yes` over captured streams. Real-installer integration tests cover successful isolated-HOME installation and upstream zero-exit partial failure reporting. This supersedes plan steps below that delegate detection or prompts to the child installer.

**Architecture:** OPSI generates its deterministic skill repertoire into a private temporary directory, then invokes the exact pinned `skills` package entrypoint with `process.execPath` and an argv array. A process-runner interface isolates child execution from orchestration and tests; the command adapter owns Commander integration and structured-output constraints.

**Tech Stack:** TypeScript 6, Node.js 24 ESM and child processes, Commander 15, `skills` 1.5.19, Vitest 4, pnpm 11.

## Global Constraints

- Work only in `/Users/0xfa7ca7/Documents/opsi/.worktrees/agent-setup` on `codex/agent-setup`.
- Pin `skills` exactly to `1.5.19`; never execute `npx`, a shell, or a remote installer URL.
- Setup is global-only and must not create project agent directories or `skills-lock.json`.
- The temporary local source must contain renderer output for the installed OPSI version and be removed on success and failure.
- `--dry-run` must create no temporary directory and invoke no child process.
- Human interactive mode may attach the child to terminal stdio; structured mode must be non-interactive and preserve one valid OPSI output envelope.
- `agent setup` must be owned exactly once by `opsi-diagnostics` in the generated Agent Skills repertoire.
- Every behavior change follows red-green-refactor TDD and every task ends in a focused commit.

---

### Task 1: Agent setup orchestration

**Files:**
- Create: `apps/cli/src/agent-setup.ts`
- Create: `apps/cli/test/agent-setup.test.ts`

**Interfaces:**
- Consumes: `generateAgentSkills({ cwd, outputDirectory, version })` from `apps/cli/src/agent-skills.ts` and `OpsiError`/`EXIT_CODES` from `@opsi/domain`.
- Produces: `AgentSetupRequest`, `AgentSetupResult`, `AgentInstallerRunRequest`, `AgentInstallerRunResult`, `AgentInstallerRunner`, `buildAgentInstallerArguments()`, and `setupAgents()`.

- [ ] **Step 1: Write failing request-validation and argument tests**

```ts
expect(buildAgentInstallerArguments("/tmp/source", {})).toEqual([
  "add", "/tmp/source", "--global", "--skill", "*",
]);
expect(buildAgentInstallerArguments("/tmp/source", {
  agents: ["codex", "claude-code"], copy: true, yes: true,
})).toEqual([
  "add", "/tmp/source", "--global", "--skill", "*",
  "--agent", "codex", "claude-code", "--copy", "--yes",
]);
expect(() => buildAgentInstallerArguments("/tmp/source", {
  agents: ["codex"], all: true,
})).toThrowError(expect.objectContaining({ code: "AGENT_SETUP_OPTIONS_INVALID" }));
expect(() => buildAgentInstallerArguments("/tmp/source", {
  agents: ["codex", "codex"],
})).toThrowError(expect.objectContaining({ code: "AGENT_SETUP_OPTIONS_INVALID" }));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run --project unit apps/cli/test/agent-setup.test.ts`

Expected: FAIL because `apps/cli/src/agent-setup.ts` does not exist.

- [ ] **Step 3: Implement the public types and exact argv builder**

```ts
export interface AgentSetupRequest {
  readonly agents?: readonly string[];
  readonly all?: boolean;
  readonly copy?: boolean;
  readonly yes?: boolean;
  readonly dryRun?: boolean;
}

export interface AgentInstallerRunRequest {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly interactive: boolean;
}

export interface AgentInstallerRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface AgentInstallerRunner {
  run(request: AgentInstallerRunRequest): Promise<AgentInstallerRunResult>;
}

export interface AgentSetupResult {
  readonly installer: "skills@1.5.19";
  readonly scope: "global";
  readonly selection: "detected" | "all" | readonly string[];
  readonly skills: readonly string[];
  readonly dryRun: boolean;
}

export interface SetupAgentsOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
  readonly request: AgentSetupRequest;
  readonly runner: AgentInstallerRunner;
  readonly interactive: boolean;
  readonly createTemporaryDirectory?: () => Promise<string>;
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
}
```

Validate `all` versus `agents`, reject empty or duplicate IDs, and append only literal argv elements. Throw `AGENT_SETUP_OPTIONS_INVALID` with exit category 2 for local validation failures.

- [ ] **Step 4: Add failing orchestration lifecycle tests**

```ts
const runner: AgentInstallerRunner = {
  run: vi.fn(async (request) => {
    expect(await readFile(join(request.arguments[1]!, "opsi", "SKILL.md"), "utf8"))
      .toContain("Generated for `opsi` 1.2.3");
    return { exitCode: 0, stdout: "installed", stderr: "" };
  }),
};
const result = await setupAgents({
  cwd, env: {}, version: "1.2.3", request: { agents: ["codex"] }, runner,
  interactive: false,
});
expect(result).toMatchObject({
  installer: "skills@1.5.19", scope: "global", selection: ["codex"],
  skills: expect.arrayContaining(["opsi", "opsi-shared"]), dryRun: false,
});
await expect(access(capturedSource)).rejects.toMatchObject({ code: "ENOENT" });
```

Also test dry-run never calls the runner or `mkdtemp`, runner failure still removes the source, and nonzero exit throws `AGENT_SETUP_FAILED` with the installer's stderr diagnostic.

- [ ] **Step 5: Implement setup lifecycle and typed failures**

Implement `setupAgents()` with injectable `createTemporaryDirectory` and cleanup functions defaulting to `mkdtemp(join(tmpdir(), "opsi-agent-setup-"))`, `chmod(path, 0o700)`, and `rm(path, { recursive: true, force: true })`. Generate directly into the temporary root, call the runner, and clean up in `finally`. Dry-run returns the 10 skill names from `AGENT_SKILLS` without touching the filesystem.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm vitest run --project unit apps/cli/test/agent-setup.test.ts`

Expected: PASS.

```bash
git add apps/cli/src/agent-setup.ts apps/cli/test/agent-setup.test.ts
git commit -m "feat: orchestrate automatic agent setup"
```

### Task 2: Pinned universal-installer runner

**Files:**
- Create: `apps/cli/src/agent-installer-runner.ts`
- Create: `apps/cli/test/agent-installer-runner.test.ts`
- Modify: `apps/cli/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `AgentInstallerRunner` and `AgentInstallerRunRequest` from `apps/cli/src/agent-setup.ts`.
- Produces: `SkillsAgentInstallerRunner`, which resolves `skills/bin/cli.mjs` and runs it with the current Node executable.

- [ ] **Step 1: Add the exact runtime dependency**

Run: `pnpm --filter opsi add skills@1.5.19 --save-exact`

Expected: `apps/cli/package.json` contains `"skills": "1.5.19"`; the lockfile contains the exact package and its audited transitive dependencies.

- [ ] **Step 2: Write failing process-boundary tests**

```ts
const spawnProcess = vi.fn(() => fakeChild({ code: 0, stdout: "ok", stderr: "" }));
const runner = new SkillsAgentInstallerRunner({
  resolveInstaller: () => "/installed/skills/bin/cli.mjs",
  spawnProcess,
});
await expect(runner.run({
  arguments: ["add", "/tmp/source", "--global"],
  cwd: "/workspace", env: { NO_COLOR: "1" }, interactive: false,
})).resolves.toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
expect(spawnProcess).toHaveBeenCalledWith(
  process.execPath,
  ["/installed/skills/bin/cli.mjs", "add", "/tmp/source", "--global"],
  expect.objectContaining({ cwd: "/workspace", shell: false }),
);
```

Also assert interactive mode uses inherited stdio, captured mode pipes stdout/stderr, spawn errors become `AGENT_INSTALLER_UNAVAILABLE` with exit category 5, and no argument is combined into a shell command string.

- [ ] **Step 3: Run the runner test and verify RED**

Run: `pnpm vitest run --project unit apps/cli/test/agent-installer-runner.test.ts`

Expected: FAIL because the runner module does not exist.

- [ ] **Step 4: Implement the production runner**

Use `createRequire(import.meta.url).resolve("skills/bin/cli.mjs")` and `spawn(process.execPath, [installer, ...request.arguments], { cwd, env, shell: false, stdio })`. Collect piped output with a bounded 1 MiB buffer; inherited mode returns empty captured strings. Resolve on `close`, reject spawn/resolve failures as `AGENT_INSTALLER_UNAVAILABLE`, and never log environment values.

- [ ] **Step 5: Run focused tests, typecheck, and commit**

Run:

```bash
pnpm vitest run --project unit apps/cli/test/agent-installer-runner.test.ts apps/cli/test/agent-setup.test.ts
pnpm --filter opsi typecheck
```

Expected: PASS.

```bash
git add apps/cli/package.json pnpm-lock.yaml apps/cli/src/agent-installer-runner.ts apps/cli/test/agent-installer-runner.test.ts
git commit -m "feat: add pinned universal agent installer"
```

### Task 3: Public `opsi agent setup` command

**Files:**
- Create: `apps/cli/src/commands/agent.ts`
- Create: `apps/cli/test/agent-setup.e2e.test.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/test/complete-surface.e2e.test.ts`

**Interfaces:**
- Consumes: `setupAgents()`, `SkillsAgentInstallerRunner`, `manifestCommand()`, `CliContext`, and `context.configuration.output`.
- Produces: `registerAgentCommand(program, context, runner)` and the normalized `agent setup` manifest entry.

- [ ] **Step 1: Write failing command-surface and E2E tests**

Declare expected manifest options:

```ts
[
  "--agent <ids...>",
  "--all",
  "--copy",
  "--yes",
  "--dry-run",
]
```

Add `agent setup` to the complete-surface path list and `agent` to the action-adapter metadata guard. In the E2E test, inject a fake runner through `createProgram()` and assert `agent setup --agent codex claude-code --copy --yes --json` generates all 10 skills, invokes the runner once with structured/captured mode, writes one valid result envelope, and cleans the source.

- [ ] **Step 2: Run E2E tests and verify RED**

Run:

```bash
pnpm vitest run --project cli-e2e apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts
```

Expected: FAIL because `agent setup` is absent.

- [ ] **Step 3: Add manifest and command adapter**

Add:

```ts
leaf("agent setup", "Install OPSI Agent Skills for detected agent hosts", [], [
  option("--agent <ids...>", "target explicit agent installer IDs"),
  option("--all", "install for every supported agent", { conflicts: ["agent"] }),
  option("--copy", "copy skills instead of creating symlinks"),
  option("--yes", "accept detected agents without prompting"),
  option("--dry-run", "show the setup plan without making changes"),
]),
```

Register the adapter in `program.ts`, extend `ProgramDependencies` with `agentInstallerRunner?: AgentInstallerRunner`, and default to `new SkillsAgentInstallerRunner()`. The adapter treats `configuration.output !== "table"` as structured and computes `interactive = !structured && context.io.stdin?.isTTY === true`. Any real non-interactive setup without `--yes`, explicit agents, or `--all` throws `AGENT_SETUP_NONINTERACTIVE_REQUIRED` with exit category 2. It writes only the `AgentSetupResult` through the renderer.

- [ ] **Step 4: Add failure and dry-run E2E coverage**

Test:

- `agent setup --dry-run --json` returns count 10 and never calls the runner;
- structured or non-TTY setup without a non-interactive selection returns exit 2 and code `AGENT_SETUP_NONINTERACTIVE_REQUIRED`;
- conflicting `--all --agent codex` is rejected by Commander or local validation before a runner call;
- a fake nonzero installer result returns `AGENT_SETUP_FAILED` and cleans the source;
- help renders all five setup options.

- [ ] **Step 5: Run command tests and commit**

Run:

```bash
pnpm vitest run --project unit apps/cli/test/agent-setup.test.ts apps/cli/test/agent-installer-runner.test.ts
pnpm vitest run --project cli-e2e apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts
```

Expected: PASS.

```bash
git add apps/cli/src/commands/agent.ts apps/cli/src/command-manifest.ts apps/cli/src/program.ts apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts
git commit -m "feat: expose automatic agent setup command"
```

### Task 4: Generated skill routing and user documentation

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `skills/opsi-diagnostics/SKILL.md`
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Modify: `docs/skills.md`
- Modify: `apps/cli/test/release-contract.test.ts`
- Create: `.changeset/automatic-agent-setup.md`

**Interfaces:**
- Consumes: `COMMAND_MANIFEST`, `AGENT_SKILLS`, `renderAgentSkillFiles()`, and the public command behavior from Task 3.
- Produces: exact ownership of `agent setup` by `opsi-diagnostics`, regenerated checked-in guidance, installation docs, and release metadata.

- [ ] **Step 1: Write failing routing and release-contract tests**

Assert that `opsi-diagnostics.commands` includes `agent setup`, the generated diagnostics skill contains `opsi agent setup`, `--agent`, `--all`, `--copy`, `--yes`, and `--dry-run`, and README contracts include:

```text
opsi agent setup
opsi agent setup --yes
opsi agent setup --agent codex claude-code
opsi agent setup --all --copy
opsi agent setup --dry-run --json
```

- [ ] **Step 2: Run rendering/release tests and verify RED**

Run:

```bash
pnpm vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/release-contract.test.ts
```

Expected: FAIL because routing, checked-in skill bytes, and docs are stale.

- [ ] **Step 3: Update ownership, regenerate, and document setup**

Add `agent setup` to the diagnostics registry entry. Build and regenerate:

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir skills --json
```

Update documentation to recommend `opsi agent setup` for machine-wide automatic detection while retaining `npx skills add` for project-scoped or advanced installation. State that setup uses the pinned local installer and embedded generated repertoire, creates no project lockfile, and is safe to rerun after upgrading OPSI.

- [ ] **Step 4: Add the minor changeset**

```markdown
---
"opsi": minor
---

Add `opsi agent setup` for automatic global installation of the complete OPSI Agent Skills repertoire into detected or explicitly selected agent hosts.
```

- [ ] **Step 5: Validate all generated skills and commit**

Run:

```bash
pnpm vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/release-contract.test.ts
for skill_dir in skills/*; do /tmp/opsi-skill-validator-env/bin/python /Users/0xfa7ca7/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill_dir" || exit 1; done
git diff --check
```

Expected: tests pass, all 10 skill validators print `Skill is valid!`, and the diff check is empty.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts skills/opsi-diagnostics/SKILL.md README.md apps/cli/README.md docs/commands.md docs/skills.md apps/cli/test/release-contract.test.ts .changeset/automatic-agent-setup.md
git commit -m "docs: add automatic agent setup guidance"
```

### Task 5: Packed-package contract and final verification

**Files:**
- Modify: `apps/cli/test/pack.test.ts`

**Interfaces:**
- Consumes: the packed `opsi` tarball, its exact `skills` runtime dependency, and `agent setup --dry-run`.
- Produces: evidence that npm consumers receive the installer and setup command without mutating agent directories.

- [ ] **Step 1: Write the failing packed-install assertions**

After installing the tarball, assert:

```ts
expect(
  await execute(process.execPath, [
    "-e",
    "import.meta.resolve('skills/bin/cli.mjs').then(console.log)",
  ], { cwd: root }),
).toMatchObject({ stderr: "" });
const setup = await execute(binary, ["agent", "setup", "--dry-run", "--json"], { cwd: root });
expect(JSON.parse(setup.stdout)).toMatchObject({
  data: { installer: "skills@1.5.19", scope: "global", dryRun: true },
});
expect(await readdir(root)).not.toEqual(expect.arrayContaining([".agents", "skills-lock.json"]));
```

- [ ] **Step 2: Run the packed contract test**

Run: `pnpm test:pack`

Expected: PASS because Tasks 1-4 already implement the public contract; a failure here is a packaging regression and must be debugged before proceeding.

- [ ] **Step 3: Run complete verification**

Run:

```bash
pnpm check
git status --short
git diff --check origin/main...HEAD
```

Expected: formatting, lint, typecheck, all unit/integration/CLI E2E tests, and pack tests pass; the worktree is clean after the final commit; the branch diff has no whitespace errors.

- [ ] **Step 4: Commit final test coverage**

```bash
git add apps/cli/test/pack.test.ts
git commit -m "test: verify packed automatic agent setup"
```

- [ ] **Step 5: Review and publish**

Run an independent code review against `origin/main...HEAD`, address Critical or Important findings with fresh failing tests, rerun `pnpm check`, push `codex/agent-setup`, and open a ready-for-review PR targeting `main` with the implementation summary and exact verification commands.
