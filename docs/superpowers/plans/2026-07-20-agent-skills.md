# OPSI CLI Agent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a complete, installable Agent Skills repertoire with an `opsi` orchestrator and a deterministic `opsi generate-skills` command.

**Architecture:** Define a curated domain registry beside a renderer that consumes the existing command manifest, then publish the rendered `SKILL.md` files both through a CLI command and as checked-in repository artifacts. Keep agent routing in skills and all operational behavior in the existing CLI, with exact-byte drift tests preventing documentation from diverging from command metadata.

**Tech Stack:** Node.js 24, TypeScript 6, Commander 15, Vitest 4, pnpm 11, Agent Skills `SKILL.md` format, Changesets.

## Global Constraints

- Cover every current CLI command with exactly one domain skill.
- Keep generated skills deterministic and fully offline.
- Use portable skill frontmatter containing only `name` and `description`.
- Treat `/opsi`, `@opsi`, and `$opsi` as host invocation forms, never CLI arguments.
- Add no model runtime, provider SDK, API key, telemetry, MCP server, or editor extension.
- Preserve all existing CLI safety bounds, structured output contracts, exit codes, and SDK exports.
- Run on Node.js 24 or later and all existing supported release targets.
- Use test-driven development and include a minor Changeset for `opsi`.

---

## File structure

- Create `apps/cli/src/agent-skills.ts`: skill registry validation, Markdown rendering, index rendering, and atomic publication.
- Create `apps/cli/src/commands/generate-skills.ts`: Commander action adapter for `opsi generate-skills`.
- Create `apps/cli/test/agent-skills.test.ts`: registry, rendering, publication, and checked-in drift tests.
- Create `apps/cli/test/generate-skills.e2e.test.ts`: public CLI behavior for default/custom output and typed failures.
- Create `skills/<skill-name>/SKILL.md`: generated installable orchestrator, shared, and eight domain skill artifacts.
- Create `docs/skills.md`: generated repertoire index.
- Create `.changeset/agent-skills.md`: additive minor release note.
- Modify `apps/cli/src/command-manifest.ts`: declare `generate-skills` and its output option.
- Modify `apps/cli/src/program.ts`: register the command adapter.
- Modify `apps/cli/test/complete-surface.e2e.test.ts`: preserve manifest/action/completion coverage.
- Modify `apps/cli/test/pack.test.ts`: run skill generation from the packed npm artifact.
- Modify `apps/cli/test/release-contract.test.ts`: require the skill index and command reference entry.
- Modify `README.md`, `apps/cli/README.md`, and `docs/commands.md`: installation, invocation, and command documentation.

### Task 1: Define and validate the skill registry

**Files:**
- Create: `apps/cli/src/agent-skills.ts`
- Create: `apps/cli/test/agent-skills.test.ts`

**Interfaces:**
- Consumes: `COMMAND_MANIFEST`, `GLOBAL_OPTION_MANIFEST`, `CommandManifestEntry`, and `CommandOptionManifest` from `apps/cli/src/command-manifest.ts`.
- Produces: `AgentSkillDefinition`, `AGENT_SKILLS`, `validateAgentSkills()`, `renderAgentSkillFiles(version)`, and `renderAgentSkillsIndex()`.

- [ ] **Step 1: Write failing registry coverage tests**

Create `apps/cli/test/agent-skills.test.ts` with assertions that the repertoire names equal:

```ts
const EXPECTED_SKILLS = [
  "opsi",
  "opsi-shared",
  "opsi-catalogue",
  "opsi-resources",
  "opsi-download",
  "opsi-validation",
  "opsi-analysis",
  "opsi-provenance",
  "opsi-local-state",
  "opsi-diagnostics",
] as const;

expect(AGENT_SKILLS.map((skill) => skill.name)).toEqual(EXPECTED_SKILLS);
expect(validateAgentSkills()).toEqual([]);
```

Add negative fixtures proving `validateAgentSkills()` reports duplicate names, invalid kebab-case names, missing commands, multiply owned commands, unknown command paths, missing `opsi`/`opsi-shared`, and a domain with no commands.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts`

Expected: FAIL because `../src/agent-skills.js` does not exist.

- [ ] **Step 3: Implement the registry and validator**

Define focused types and a frozen registry:

```ts
export interface AgentSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly commands: readonly string[];
  readonly purpose: string;
  readonly workflows: readonly string[];
  readonly safety: readonly string[];
  readonly related: readonly string[];
}

export function validateAgentSkills(
  skills: readonly AgentSkillDefinition[] = AGENT_SKILLS,
  commands: readonly CommandManifestEntry[] = COMMAND_MANIFEST,
): readonly string[];
```

Assign these exact command owners:

```ts
{
  "opsi-catalogue": [
    "search", "dataset list", "dataset show", "dataset resources",
    "dataset schema", "dataset open",
  ],
  "opsi-resources": ["resource show", "resource headers", "resource preview"],
  "opsi-download": ["download"],
  "opsi-validation": ["validate"],
  "opsi-analysis": ["query", "convert"],
  "opsi-provenance": ["provenance show", "provenance verify"],
  "opsi-local-state": [
    "cache info", "cache list", "cache clear", "cache prune", "cache verify",
    "config get", "config set", "config list", "config path",
  ],
  "opsi-diagnostics": ["providers list", "doctor", "completion", "generate-skills"],
}
```

Keep `opsi` and `opsi-shared` commandless. Return every validation problem in deterministic order so callers and tests receive actionable diagnostics.

- [ ] **Step 4: Add minimal rendering contracts**

Implement:

```ts
export function renderAgentSkillFiles(version: string): ReadonlyMap<string, string>;
export function renderAgentSkillsIndex(): string;
```

For now, emit valid frontmatter, a title, the definition purpose, and owned command headings. Ensure the renderer rejects an invalid registry before emitting output.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts`

Expected: PASS.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts
git commit -m "feat: define OPSI agent skill registry"
```

### Task 2: Render complete portable skills

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`

**Interfaces:**
- Consumes: the validated `AGENT_SKILLS`, `COMMAND_MANIFEST`, and `GLOBAL_OPTION_MANIFEST`.
- Produces: deterministic Markdown bytes for ten `SKILL.md` files and `docs/skills.md`.

- [ ] **Step 1: Write failing renderer assertions**

Assert every rendered file:

```ts
expect(content).toMatch(/^---\nname: [a-z0-9-]+\ndescription: "[^"]+"\n---\n/u);
expect(content.endsWith("\n")).toBe(true);
expect(content).not.toMatch(/(?:TBD|TODO|API[_ -]?KEY|real token)/iu);
```

Assert the `opsi` body contains an intent routing table for all domain skills and explicitly says not to pass `/opsi`, `@opsi`, or `$opsi` to the shell. Assert `opsi-shared` contains installation, `--help`, JSON/NDJSON, stdout/stderr/exit-status, offline, bounds, network override, confirmation, and exit-category guidance.

For every owned command, assert its domain skill includes the exact command path, description, arguments, options, choices, required marker, and conflicts rendered from the manifest. Assert domain skills link to `../opsi-shared/SKILL.md` and only link to registered related skills.

- [ ] **Step 2: Run the renderer tests and verify failure**

Run: `pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts`

Expected: FAIL because the initial renderer omits the required routing, shared guidance, and complete manifest syntax.

- [ ] **Step 3: Implement the complete renderer**

Add private helpers with these responsibilities:

```ts
function yamlDoubleQuoted(value: string): string;
function commandUsage(entry: CommandManifestEntry): string;
function optionLabel(option: CommandOptionManifest): string;
function renderCommand(entry: CommandManifestEntry): string;
function renderOrchestrator(version: string): string;
function renderShared(version: string): string;
function renderDomainSkill(definition: AgentSkillDefinition, version: string): string;
```

Render command sections as:

```markdown
### `opsi query <input> --sql <query>`

Run one sandboxed read-only query over tabular data.

| Option | Required | Values | Description |
| --- | --- | --- | --- |
| `--sql <query>` | yes | — | one SELECT, WITH ... SELECT, or VALUES statement |
```

Include focused registry workflows and safety notes after syntax. Keep the main skill compact and make each domain skill independently usable after loading `opsi-shared`.

- [ ] **Step 4: Run tests and inspect representative output**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts
node --input-type=module -e "import('./apps/cli/dist/main.js')"
```

Expected: renderer tests PASS; the import exits successfully after the later build exists, or is skipped if `dist` has not yet been rebuilt.

- [ ] **Step 5: Commit complete rendering**

```bash
git add apps/cli/src/agent-skills.ts apps/cli/test/agent-skills.test.ts
git commit -m "feat: render complete OPSI agent skills"
```

### Task 3: Publish skills through the CLI

**Files:**
- Modify: `apps/cli/src/agent-skills.ts`
- Create: `apps/cli/src/commands/generate-skills.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/program.ts`
- Create: `apps/cli/test/generate-skills.e2e.test.ts`
- Modify: `apps/cli/test/complete-surface.e2e.test.ts`

**Interfaces:**
- Consumes: `renderAgentSkillFiles(version)`, `CliContext`, `manifestCommand()`, and the normal `Renderer`.
- Produces: `generateAgentSkills(options): Promise<GenerateAgentSkillsResult>` and `registerGenerateSkillsCommand(program, context)`.

- [ ] **Step 1: Write failing CLI tests**

Cover:

```ts
await expect(runCli(["generate-skills", "--json"], io)).resolves.toBe(0);
expect(JSON.parse(stdout.join(""))).toMatchObject({
  data: { count: 10, outputDirectory: join(cwd, "skills") },
});
expect(await readFile(join(cwd, "skills", "opsi", "SKILL.md"), "utf8"))
  .toContain("name: opsi");
```

Also test an absolute `--output-dir`, idempotent regeneration, preservation of an unrelated sentinel file, replacement of a known generated skill, paths containing spaces, and typed failure when the output path is an existing regular file. Extend command-surface and completion expectations with `generate-skills` and its `--output-dir` option.

- [ ] **Step 2: Run the new e2e test and verify failure**

Run: `pnpm build && pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts`

Expected: FAIL with unknown command `generate-skills`.

- [ ] **Step 3: Implement atomic publication**

Add:

```ts
export interface GenerateAgentSkillsOptions {
  readonly cwd: string;
  readonly outputDirectory?: string;
  readonly version: string;
}

export interface GenerateAgentSkillsResult {
  readonly outputDirectory: string;
  readonly count: number;
  readonly skills: readonly string[];
}

export async function generateAgentSkills(
  options: GenerateAgentSkillsOptions,
): Promise<GenerateAgentSkillsResult>;
```

Resolve relative output beneath `cwd`, accept absolute paths, `mkdir` only the output and known skill directories, write each target to `SKILL.md.<uuid>.tmp` with `flag: "wx"`, rename it over the known target, and remove the temporary file in `finally`. Map invalid output shape to `OpsiError` with `INVALID_INPUT`; map other filesystem failures to a typed internal error without exposing sensitive path contents beyond the requested target.

- [ ] **Step 4: Register the command**

Add this manifest leaf:

```ts
leaf(
  "generate-skills",
  "Generate installable Agent Skills for the opsi CLI",
  [],
  [option("--output-dir <path>", "directory that receives generated skills")],
),
```

Register an action adapter that passes `context.io.cwd ?? process.cwd()`, `context.version`, and `options.outputDir`, then writes the result through `context.renderer`.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
pnpm build
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/complete-surface.e2e.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts
```

Expected: PASS.

```bash
git add apps/cli/src/agent-skills.ts apps/cli/src/commands/generate-skills.ts apps/cli/src/command-manifest.ts apps/cli/src/program.ts apps/cli/test/agent-skills.test.ts apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts
git commit -m "feat: add agent skill generator command"
```

### Task 4: Check in generated skills and drift protection

**Files:**
- Create: `skills/opsi/SKILL.md`
- Create: `skills/opsi-shared/SKILL.md`
- Create: `skills/opsi-catalogue/SKILL.md`
- Create: `skills/opsi-resources/SKILL.md`
- Create: `skills/opsi-download/SKILL.md`
- Create: `skills/opsi-validation/SKILL.md`
- Create: `skills/opsi-analysis/SKILL.md`
- Create: `skills/opsi-provenance/SKILL.md`
- Create: `skills/opsi-local-state/SKILL.md`
- Create: `skills/opsi-diagnostics/SKILL.md`
- Create: `docs/skills.md`
- Modify: `apps/cli/test/agent-skills.test.ts`

**Interfaces:**
- Consumes: exact output from `renderAgentSkillFiles(VERSION)` and `renderAgentSkillsIndex()`.
- Produces: repository-installable Agent Skills and exact-byte drift enforcement.

- [ ] **Step 1: Write the failing drift test**

For each rendered entry, read `skills/<name>/SKILL.md` and compare exact bytes. Compare `renderAgentSkillsIndex()` to `docs/skills.md`, list the directories under `skills/`, and assert no undeclared skill or extra generated artifact exists.

- [ ] **Step 2: Run the drift test and verify failure**

Run: `pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts`

Expected: FAIL with `ENOENT` for the first checked-in skill.

- [ ] **Step 3: Generate the checked-in artifacts**

Run:

```bash
pnpm build
node apps/cli/dist/main.js generate-skills --output-dir skills --json
```

Write `docs/skills.md` from `renderAgentSkillsIndex()` using the repository's deterministic generation path. If necessary, add a private development script entry that only invokes the same exported renderer; do not duplicate content in a second template.

- [ ] **Step 4: Validate generated skills**

Run the project skill validator against every `skills/*` directory and then run the drift test. Assert all files use only `name` and `description` frontmatter and remain below 500 lines.

Expected: all validators and drift assertions PASS.

- [ ] **Step 5: Commit generated artifacts**

```bash
git add skills docs/skills.md apps/cli/test/agent-skills.test.ts
git commit -m "feat: ship installable OPSI agent skills"
```

### Task 5: Document installation and release behavior

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Modify: `apps/cli/test/release-contract.test.ts`
- Create: `.changeset/agent-skills.md`

**Interfaces:**
- Consumes: `opsi generate-skills`, repository `skills/`, and `docs/skills.md`.
- Produces: end-user installation/invocation instructions and a minor release declaration.

- [ ] **Step 1: Write failing documentation contract assertions**

Require the main README to contain:

```text
npx skills add https://github.com/0xfa7ca7/opsi
npx skills add https://github.com/0xfa7ca7/opsi/tree/main/skills/opsi-analysis
opsi generate-skills
docs/skills.md
```

Require `docs/commands.md` to document `generate-skills`, `--output-dir`, idempotent known-target replacement, and structured output. Require `apps/cli/README.md` to mention the generator and link the repository skill index.

- [ ] **Step 2: Run the contract test and verify failure**

Run: `pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts`

Expected: FAIL because the documentation does not yet contain the skill installation contract.

- [ ] **Step 3: Update user documentation**

Replace the current generic agent section with an Agent Skills subsection modeled on Google Workspace CLI. Explain automatic selection plus host-dependent `/opsi`, `@opsi`, and `$opsi`; do not claim all hosts support all prefixes. Preserve the existing structured-output guidance below the installation examples.

Add the exact command syntax and safety behavior to `docs/commands.md`, and mention generation in the packaged README.

- [ ] **Step 4: Add the Changeset**

Create `.changeset/agent-skills.md`:

```markdown
---
"opsi": minor
---

Add installable Agent Skills with a main OPSI orchestrator, full command coverage, and an offline `opsi generate-skills` command.
```

- [ ] **Step 5: Run documentation tests and commit**

Run:

```bash
pnpm exec prettier --check README.md apps/cli/README.md docs/commands.md docs/skills.md skills .changeset/agent-skills.md
pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts apps/cli/test/agent-skills.test.ts
```

Expected: PASS.

```bash
git add README.md apps/cli/README.md docs/commands.md docs/skills.md apps/cli/test/release-contract.test.ts .changeset/agent-skills.md
git commit -m "docs: explain OPSI agent skills"
```

### Task 6: Verify the packed CLI can generate skills

**Files:**
- Modify: `apps/cli/test/pack.test.ts`

**Interfaces:**
- Consumes: the packed `opsi` binary and public `generate-skills` command.
- Produces: release-level proof that generation works without workspace source files.

- [ ] **Step 1: Write a failing pack assertion**

After installing the exact tarball, run:

```ts
const generated = join(root, "generated skills");
const result = await execute(binary, [
  "generate-skills", "--output-dir", generated, "--json",
], { cwd: root });
expect(JSON.parse(result.stdout)).toMatchObject({ data: { count: 10 } });
expect(await readFile(join(generated, "opsi", "SKILL.md"), "utf8"))
  .toContain("name: opsi");
expect(await readFile(join(generated, "opsi-analysis", "SKILL.md"), "utf8"))
  .toContain("opsi query");
```

- [ ] **Step 2: Run the pack test and verify failure**

Run: `pnpm build && pnpm exec vitest run --project cli-e2e apps/cli/test/pack.test.ts`

Expected: FAIL until the built bundle contains every generator dependency and the test imports `readFile`.

- [ ] **Step 3: Make the packed behavior pass**

Keep generator templates and registry in `apps/cli/src` so tsup bundles them into `dist/main.js`. Update test imports only; do not add root `skills/` to the npm `files` list or expose internal workspace imports.

- [ ] **Step 4: Run pack and public-surface tests**

Run:

```bash
pnpm build
pnpm exec vitest run --project cli-e2e apps/cli/test/pack.test.ts
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts
```

Expected: PASS and the canonical tarball file allowlist remains unchanged.

- [ ] **Step 5: Commit release verification**

```bash
git add apps/cli/test/pack.test.ts
git commit -m "test: verify packed agent skill generation"
```

### Task 7: Final verification and PR preparation

**Files:**
- Modify only files required by verification findings.

**Interfaces:**
- Consumes: the complete branch implementation.
- Produces: a clean, reviewed, push-ready branch with no skill drift.

- [ ] **Step 1: Run targeted verification**

Run:

```bash
pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts apps/cli/test/release-contract.test.ts
pnpm build
pnpm exec vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/pack.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full repository contract**

Run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:pack
```

Expected: every command exits 0.

- [ ] **Step 3: Review generated content and diff**

Run:

```bash
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
```

Inspect every changed file, verify no secret or temporary file is present, and confirm every spec requirement maps to an implementation and test.

- [ ] **Step 4: Commit any verification-only fixes**

If verification required corrections, stage only those files and commit:

```bash
git commit -m "fix: finalize OPSI agent skill generation"
```

If no corrections were required, do not create an empty commit.

- [ ] **Step 5: Push and open the pull request**

Push `codex/agent-skills` to `origin`, then open a ready-for-review PR against `main`. Summarize the orchestrator/repertoire, generator, safety behavior, documentation, and tests. Include the exact verification commands and their results in the PR body.
