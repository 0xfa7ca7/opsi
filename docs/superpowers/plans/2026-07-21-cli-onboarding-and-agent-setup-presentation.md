# CLI Onboarding and Agent Setup Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bare-command help failure with guided onboarding and render `agent setup` as a polished, structured human workflow while preserving every machine-output contract.

**Architecture:** Add pure CLI-local presentation functions that return complete strings and share one restrained ANSI-style helper. Route only `human` output through these functions; existing renderer paths remain authoritative for JSON, NDJSON, CSV, and TSV. Keep stream ownership in command/runtime code so normal results use stdout and confirmation previews and errors use stderr.

**Tech Stack:** TypeScript 6, Node.js 24 ESM, Commander 15, Vitest 4, pnpm 11, existing `@klopsi/output` sanitizer.

## Global Constraints

- Bare `klopsi` exits successfully and writes onboarding to stdout; `klopsi --help` remains the full Commander reference.
- `klopsi agent setup` selection, detection, installation, cleanup, and structured result data do not change.
- ANSI styling is permitted only for human output attached to the relevant TTY when `configuration.terminal.color` is true.
- `NO_COLOR`, `--no-color`, and redirected streams produce clean plain text with no escape sequences.
- Dynamic agent IDs and error text must be passed through `sanitizeTerminalText` before display.
- Prompts and their preview use stderr; onboarding and successful result summaries use stdout.
- No new runtime dependency, progress animation, cursor control, installer prompt, or structured-output field is introduced.

---

## File Structure

- Create `apps/cli/src/presentation.ts`: reusable ANSI enablement and semantic text styling with no I/O.
- Create `apps/cli/src/onboarding.ts`: pure bare-command onboarding formatter.
- Create `apps/cli/src/agent-setup-presentation.ts`: pure agent display-name, confirmation-preview, dry-run, and success formatters.
- Create `apps/cli/test/presentation.test.ts`: exact unit contracts for style gating, sanitization, onboarding, and setup documents.
- Modify `apps/cli/src/program.ts`: route the bare human command to onboarding.
- Modify `apps/cli/src/commands/agent.ts`: route human setup output and confirmation previews to dedicated formatters.
- Modify `apps/cli/src/main.ts` and `apps/cli/src/errors.ts`: pass resolved color policy to readable error formatting.
- Modify `apps/cli/test/runtime.test.ts` and `apps/cli/test/agent-setup.e2e.test.ts`: CLI-level stream, exit-code, color, and machine-output regressions.
- Modify `README.md`, `apps/cli/README.md`, and `docs/commands.md`: document onboarding and the improved setup response.
- Create `.changeset/rich-cli-onboarding.md`: minor `klopsi` release note.

---

### Task 1: Pure Terminal and Onboarding Presentation

**Files:**
- Create: `apps/cli/src/presentation.ts`
- Create: `apps/cli/src/onboarding.ts`
- Create: `apps/cli/test/presentation.test.ts`

**Interfaces:**
- Produces: `createPresentation(options: { color: boolean }): Presentation`.
- Produces: `Presentation` methods `title`, `heading`, `success`, `command`, `muted`, and `sanitize`, each returning a string.
- Produces: `renderOnboarding(presentation: Presentation): string`.

- [ ] **Step 1: Write failing presentation and onboarding tests**

Add tests that assert plain output contains `KLOPSI`, `Get started`, `Use KLOPSI with your AI agent`, `klopsi agent setup`, `klopsi --help`, `klopsi doctor`, and `klopsi providers list`; ends with one newline; and contains no ANSI escape. Assert `createPresentation({ color: true }).heading("Get started")` includes `\u001b[` while `{ color: false }` does not. Assert `sanitize("bad\u001b[31m")` produces `bad\\u001b[31m`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run --project unit apps/cli/test/presentation.test.ts`

Expected: FAIL because `presentation.js` and `onboarding.js` do not exist.

- [ ] **Step 3: Implement minimal pure presentation functions**

Use fixed SGR constants only inside `presentation.ts`:

```ts
import { sanitizeTerminalText } from "@klopsi/output";

export interface Presentation {
  title(value: string): string;
  heading(value: string): string;
  success(value: string): string;
  command(value: string): string;
  muted(value: string): string;
  sanitize(value: unknown): string;
}

export function createPresentation(options: { readonly color: boolean }): Presentation {
  const style = (open: string, value: string) =>
    options.color ? `${open}${value}\u001b[0m` : value;
  const sanitize = (value: unknown) => sanitizeTerminalText(value);
  return {
    title: (value) => style("\u001b[1;36m", sanitize(value)),
    heading: (value) => style("\u001b[1m", sanitize(value)),
    success: (value) => style("\u001b[1;32m", sanitize(value)),
    command: (value) => style("\u001b[36m", sanitize(value)),
    muted: (value) => style("\u001b[2m", sanitize(value)),
    sanitize,
  };
}
```

Implement `renderOnboarding()` as one template assembled from semantic lines. Do not include terminal-width logic or runtime I/O.

- [ ] **Step 4: Run the focused unit tests**

Run: `pnpm exec vitest run --project unit apps/cli/test/presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the pure presentation layer**

```bash
git add apps/cli/src/presentation.ts apps/cli/src/onboarding.ts apps/cli/test/presentation.test.ts
git commit -m "feat: add guided cli presentation"
```

### Task 2: Bare-Command Onboarding Runtime

**Files:**
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/test/runtime.test.ts`
- Modify: `apps/cli/test/complete-surface.e2e.test.ts`

**Interfaces:**
- Consumes: `createPresentation({ color })` and `renderOnboarding(presentation)` from Task 1.
- Produces: bare `klopsi` human invocation writes onboarding to stdout and returns exit code 0.

- [ ] **Step 1: Write failing runtime tests**

Add one non-TTY `NO_COLOR=1` case for `runCli([])` expecting success, empty stderr, and all onboarding sections on stdout. Add one TTY case with `env: {}` expecting ANSI on stdout, then rerun with `--no-color` expecting none. Extend the existing help regression to assert `runCli(["--help"])` includes `Usage: klopsi` and does not contain the onboarding section heading.

- [ ] **Step 2: Run the focused runtime tests to verify failure**

Run: `pnpm exec vitest run --project cli-e2e apps/cli/test/runtime.test.ts apps/cli/test/complete-surface.e2e.test.ts`

Expected: FAIL because bare `klopsi` still calls `program.help({ error: true })` and exits 2.

- [ ] **Step 3: Route the default action to onboarding**

In `createProgram`, replace the current default action with logic equivalent to:

```ts
.action(() => {
  if (context.configuration?.output !== undefined && context.configuration.output !== "human") {
    program.help({ error: true });
    return;
  }
  const presentation = createPresentation({
    color:
      context.io.stdout.isTTY === true &&
      (context.configuration?.terminal.color ?? context.io.env?.NO_COLOR === undefined),
  });
  context.io.stdout.write(renderOnboarding(presentation));
});
```

Keep `.exitOverride()`, `.showHelpAfterError()`, and `--help` behavior unchanged.

- [ ] **Step 4: Run runtime and complete-surface tests**

Run: `pnpm exec vitest run --project cli-e2e apps/cli/test/runtime.test.ts apps/cli/test/complete-surface.e2e.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit onboarding routing**

```bash
git add apps/cli/src/program.ts apps/cli/test/runtime.test.ts apps/cli/test/complete-surface.e2e.test.ts
git commit -m "feat: show onboarding for bare klopsi"
```

### Task 3: Agent Setup Human Documents

**Files:**
- Create: `apps/cli/src/agent-setup-presentation.ts`
- Modify: `apps/cli/test/presentation.test.ts`

**Interfaces:**
- Consumes: `Presentation` and `AgentSetupResult`.
- Produces: `agentDisplayName(id: string): string`.
- Produces: `renderAgentSetupConfirmation(agents: readonly string[], skillCount: number, presentation: Presentation): string`.
- Produces: `renderAgentSetupResult(result: AgentSetupResult, presentation: Presentation): string`.

- [ ] **Step 1: Write failing formatter tests**

Assert display mappings for `openclaw` → `OpenClaw`, `codex` → `Codex`, `cursor` → `Cursor`, `github-copilot` → `GitHub Copilot`, and `claude-code` → `Claude Code`. Assert unknown `future-agent\u001b[31m` becomes a sanitized readable fallback. Assert the confirmation preview lists each agent and `11 KLOPSI skills`. Assert a successful result contains `KLOPSI agent setup complete`, `Installed for`, display names, `Skills installed`, `11 KLOPSI skills`, `Installer`, `skills@1.5.19`, `Scope`, `Global`, `Next steps`, and `klopsi agent setup --dry-run`. Assert a detected dry run contains `Setup preview`, `No files will be changed`, `Detected agents will be selected during installation`, and `klopsi agent setup --yes`.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm exec vitest run --project unit apps/cli/test/presentation.test.ts`

Expected: FAIL because `agent-setup-presentation.js` does not exist.

- [ ] **Step 3: Implement display names and documents**

Use this bounded special-name map plus a sanitized title-case fallback:

```ts
const SPECIAL_NAMES: Readonly<Record<string, string>> = {
  openclaw: "OpenClaw",
  codex: "Codex",
  cursor: "Cursor",
  "github-copilot": "GitHub Copilot",
  "claude-code": "Claude Code",
  "gemini-cli": "Gemini CLI",
};
```

Build sections with newline-joined arrays. Successful output lists agents one per line and reports only the skill count and capability summary, not all skill IDs. Dry-run output branches on `result.selection` so detected selection says detection occurs during installation, explicit selection lists names, and all-selection explains every supported globally installable host is targeted.

- [ ] **Step 4: Run formatter tests**

Run: `pnpm exec vitest run --project unit apps/cli/test/presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit agent setup documents**

```bash
git add apps/cli/src/agent-setup-presentation.ts apps/cli/test/presentation.test.ts
git commit -m "feat: format agent setup summaries"
```

### Task 4: Agent Setup Command Wiring and Readable Errors

**Files:**
- Modify: `apps/cli/src/commands/agent.ts`
- Modify: `apps/cli/src/errors.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/test/agent-setup.e2e.test.ts`
- Modify: `apps/cli/test/runtime.test.ts`

**Interfaces:**
- Consumes: Task 3's setup formatters and Task 1's `Presentation`.
- Produces: human setup summaries on stdout, confirmation previews on stderr, structured setup output through `Renderer`, and styled readable errors when permitted.

- [ ] **Step 1: Write failing end-to-end tests**

Add human dry-run and explicit-success cases that assert sectioned output instead of table headers or JSON arrays. Extend the interactive confirmation test to expect a stderr preview with readable fixture display names before `confirm` is called. Add a TTY error case asserting ANSI styling and a `NO_COLOR` counterpart asserting the same code and suggestion without ANSI. Keep the existing JSON success and dry-run assertions unchanged as regression coverage.

- [ ] **Step 2: Run focused CLI tests to verify failure**

Run: `pnpm exec vitest run --project cli-e2e apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/runtime.test.ts`

Expected: FAIL because setup still uses the generic one-row renderer and errors are unstyled.

- [ ] **Step 3: Wire human setup and confirmation output**

In `commands/agent.ts`, create separate stdout and stderr presentations from each stream's `isTTY` plus `context.configuration?.terminal.color`. Change `confirmDetectedAgents` to write `renderAgentSetupConfirmation(...)` to stderr before calling `confirm("Install KLOPSI skills for these agents?")`. After `setupAgents`, branch exactly once:

```ts
if (context.renderer?.format === "human") {
  context.io.stdout.write(renderAgentSetupResult(result, stdoutPresentation));
} else {
  context.renderer?.write(result);
}
```

Do not change `setupAgents`, `AgentSetupResult`, installer arguments, or structured rendering.

- [ ] **Step 4: Style readable errors through resolved runtime policy**

Extend `handleRuntimeError` options with `color?: boolean`. In `writeReadableError`, use `createPresentation({ color: io.stderr.isTTY === true && color === true })` to style the code/message with `heading()` and the `Suggestion:` label with `command()` while sanitizing all dynamic text. In `runCli`, initialize a local `readableColor` from `NO_COLOR`, update it after configuration loads from `configuration.terminal.color`, and pass it in the catch path. Keep `writeStructuredError` byte-compatible.

- [ ] **Step 5: Run focused CLI tests**

Run: `pnpm exec vitest run --project cli-e2e apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/runtime.test.ts`

Expected: PASS, including existing structured-output assertions.

- [ ] **Step 6: Commit command wiring**

```bash
git add apps/cli/src/commands/agent.ts apps/cli/src/errors.ts apps/cli/src/main.ts apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/runtime.test.ts
git commit -m "feat: polish agent setup workflow"
```

### Task 5: Documentation and Release Note

**Files:**
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Modify: `apps/cli/test/release-contract.test.ts`
- Create: `.changeset/rich-cli-onboarding.md`

**Interfaces:**
- Produces: user-facing documentation matching the implemented bare command, TTY styling, setup summary, and unchanged structured formats.

- [ ] **Step 1: Write release-contract assertions**

In `apps/cli/test/release-contract.test.ts`, assert the root and packaged READMEs mention that bare `klopsi` shows getting-started guidance and invites `klopsi agent setup`. Assert `docs/commands.md` describes sectioned human output and stable structured output.

- [ ] **Step 2: Run the release-contract test to verify failure**

Run: `pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts`

Expected: FAIL because the new copy is absent.

- [ ] **Step 3: Update focused documentation**

Add concise paragraphs near each README's first command example and Agent Skills section. Add the human response behavior to `agent setup` in `docs/commands.md`. Do not duplicate the full command reference or list all 71 supported agents.

Create this changeset:

```md
---
"klopsi": minor
---

Add guided bare-command onboarding and polished, color-aware human output for Agent Skills setup while preserving structured output.
```

- [ ] **Step 4: Run release-contract and formatting checks**

Run: `pnpm exec vitest run --project unit apps/cli/test/release-contract.test.ts && pnpm exec prettier --check README.md apps/cli/README.md docs/commands.md .changeset/rich-cli-onboarding.md`

Expected: PASS.

- [ ] **Step 5: Commit documentation and changeset**

```bash
git add README.md apps/cli/README.md docs/commands.md apps/cli/test/release-contract.test.ts .changeset/rich-cli-onboarding.md
git commit -m "docs: explain richer cli onboarding"
```

### Task 6: Full Verification and Pull Request

**Files:**
- Verify all modified files.

**Interfaces:**
- Produces: checked, pushed branch and ready-for-review GitHub pull request.

- [ ] **Step 1: Run focused tests together**

Run: `pnpm exec vitest run --project unit apps/cli/test/presentation.test.ts apps/cli/test/release-contract.test.ts && pnpm exec vitest run --project cli-e2e apps/cli/test/runtime.test.ts apps/cli/test/agent-setup.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts`

Expected: PASS.

- [ ] **Step 2: Run repository quality gates**

Run: `pnpm format:check && pnpm lint && pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run full tests and packed CLI verification**

Run: `pnpm test && pnpm test:pack`

Expected: PASS.

- [ ] **Step 4: Review diff and working tree**

Run: `git diff main...HEAD --check && git status --short --branch && git log --oneline main..HEAD`

Expected: no whitespace errors, no uncommitted files, and focused commits for the design, implementation, tests, docs, and release note.

- [ ] **Step 5: Push and open the pull request**

```bash
git push -u origin codex/improve-cli-onboarding
gh pr create --base main --head codex/improve-cli-onboarding --title "Improve CLI onboarding and agent setup output" --body-file /tmp/klopsi-onboarding-pr-body.md
```

The PR body must summarize onboarding, human setup presentation, automation compatibility, and the exact verification commands. Open it ready for review, not as a draft.
