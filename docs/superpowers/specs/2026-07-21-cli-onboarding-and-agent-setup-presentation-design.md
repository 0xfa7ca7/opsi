# CLI Onboarding and Agent Setup Presentation Design

**Date:** 2026-07-21

## Goal

Make KLOPSI's first-run command and Agent Skills installation flow welcoming, explanatory, and easy to scan without weakening its automation contracts. Running bare `klopsi` becomes a guided onboarding screen that invites users to configure compatible AI agents. Successful human-facing `klopsi agent setup` output becomes a purpose-built summary instead of a wide generic table row.

## Scope

This change covers:

- the response printed by bare `klopsi`;
- the interactive confirmation shown when multiple agent hosts are detected;
- human output after successful, cancelled, failed, and dry-run agent setup flows;
- restrained ANSI styling in interactive terminals, with plain-text fallbacks;
- focused documentation and release-note updates;
- tests that preserve structured-output behavior.

The full `klopsi --help` command reference, agent detection and installation semantics, generated skill content, and the schema of JSON, NDJSON, CSV, and TSV output are unchanged.

## Approach

Add small, dedicated human-formatting units for onboarding and agent setup. Commands choose these formatters only when the configured output is `human`; all structured formats continue through the existing `Renderer` unchanged.

This is preferable to expanding the shared renderer into a general rich-document system because only two task-oriented screens require richer presentation. It also produces a more intentional result than customizing Commander help or stretching the existing flat table format.

## Bare-Command Onboarding

Bare `klopsi` exits successfully and writes a guided screen to stdout. It contains:

1. the KLOPSI name and one-line purpose;
2. a short “Get started” sequence with realistic search and dataset-inspection commands;
3. a “Use KLOPSI with your AI agent” section explaining that `klopsi agent setup` installs the complete repertoire for detected compatible hosts;
4. a compact “Explore” section linking to `klopsi --help`, `klopsi doctor`, and `klopsi providers list`.

`klopsi --help` remains Commander's complete reference output. Bare-command onboarding is not printed when a structured output format is explicitly requested; those invocations retain the current invalid-input behavior and never write onboarding prose to structured stdout.

## Agent Setup Flow

### Confirmation

When setup detects multiple hosts and needs authorization, KLOPSI first prints a short human-readable setup preview to stderr, including the detected display names and the number of skills to install. The confirmation prompt itself is concise and action-oriented. KLOPSI continues to own this single prompt and invokes the pinned installer non-interactively.

### Successful installation

Successful human output contains these sections:

- a clear completion status;
- “Installed for,” listing agent display names one per line;
- “Skills installed,” reporting the total repertoire size and summarizing its capabilities without dumping the full array;
- “Details,” showing installer version, global scope, and selection mode;
- “Next steps,” asking users to restart or reload their agent, suggesting a first KLOPSI request, and showing the future `--dry-run` refresh command.

The display layer maps stable installer IDs such as `github-copilot` to readable names such as “GitHub Copilot.” Unknown future IDs fall back to the original sanitized ID.

### Dry run

Human dry-run output is explicitly labeled as a preview and says that no files were changed. It lists the planned selection where the command can resolve it without installation, reports the skill count, and shows the command to perform the setup. Existing dry-run detection semantics remain unchanged: a detected-selection dry run does not perform host detection and may therefore have no concrete agent list.

### Cancellation and errors

Cancellation remains a typed non-success result and performs no installation. Human setup errors keep their stable error code and actionable suggestion. Their presentation gains visual hierarchy but never exposes secrets or unbounded installer output. Structured errors remain unchanged.

## Styling and Streams

Interactive human output may use restrained ANSI color for headings, status marks, commands, and secondary text. Styling is disabled when:

- `NO_COLOR` is present in the environment;
- stdout is not a TTY for normal command output;
- stderr is not a TTY for prompts and diagnostics.

Plain output remains fully understandable without color. Unicode marks are limited to widely supported symbols with text carrying the same meaning. Dynamic agent IDs and other external values pass through the existing terminal-text sanitizer before rendering.

Successful onboarding and result summaries go to stdout. Prompts and their immediate previews go to stderr so stdout remains composable. Help retains Commander's existing stream behavior. No progress animation or cursor control is introduced.

## Components

- A CLI-local terminal-presentation helper owns ANSI enablement and small reusable primitives such as headings, commands, bullets, and key-value rows.
- An onboarding formatter produces the bare-command screen.
- An agent-setup formatter produces preview, dry-run, and success documents and resolves agent display names.
- `program.ts` routes the bare command to onboarding rather than treating it as a help error.
- `commands/agent.ts` routes only human output through the dedicated formatter and leaves structured output with `Renderer`.

The formatter functions return strings and do not write directly, keeping stream ownership explicit and making exact output straightforward to test.

## Testing

Add unit and CLI end-to-end coverage for:

- bare `klopsi` returning success with structured onboarding sections and the setup invitation;
- `klopsi --help` remaining the full reference and not becoming onboarding;
- onboarding staying ANSI-free under `NO_COLOR` and non-TTY output;
- interactive color appearing only on the correct TTY stream;
- setup confirmation preview and readable agent display names;
- successful setup and dry-run human summaries;
- agent setup JSON remaining schema-compatible and free of human decoration;
- cancellation and existing installer failures invoking no unintended follow-up work;
- terminal-control sanitization for dynamic values.

Run the focused CLI/output tests first, followed by formatting, lint, type checking, the full test suite, and the packed-CLI test before opening the pull request.

## Documentation and Release

Update the root README, packaged CLI README, and command reference only where needed to describe bare-command onboarding and the improved human setup summary. Add a minor package changeset because this is a user-visible CLI enhancement with no breaking machine-interface change.

## Delivery

Implementation will be committed on `codex/improve-cli-onboarding`, pushed to `origin`, and opened as a ready-for-review GitHub pull request after all required checks pass.
