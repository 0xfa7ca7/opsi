# PC-Axis Input Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded, reusable dense PC-Axis input support for detection, preview, schema inference, validation, DuckDB query staging, conversion, truthful resource capabilities, diagnostics, public declarations, documentation, and generated skills.

**Architecture:** A focused `pcaxis.ts` adapter parses bounded PX metadata and streams dense cells as deterministic long-form rows. Detection recognizes `.px`, declared aliases, media types, and a PX assignment signature before generic delimiter sniffing; existing preview, validation, staging, query, and conversion paths reuse the adapter. Output formats remain unchanged.

**Tech Stack:** TypeScript 6, Node.js streams and `TextDecoder`, Vitest, DuckDB Node API, pnpm.

## Global Constraints

- Support dense PX only; reject `KEYS` explicitly.
- Support `windows-1250` and `utf-8`; reject other code pages explicitly.
- Preserve labels, zero-padded codes, numeric values, and source data symbols.
- Do not materialize the Cartesian product or full cube for previews or staging.
- Apply hard bounds to source bytes, statements, dimensions, values, cells, strings, notes, tokens, and staging output.
- Keep PC-Axis input-only; do not add it to `SupportedDataFormat` or export targets.

---

### Task 1: Detection and Public Types

**Files:**
- Modify: `packages/data-engine/src/types.ts`
- Modify: `packages/data-engine/src/detect.ts`
- Modify: `packages/data-engine/test/detect.test.ts`
- Modify: `apps/cli/src/public-sdk.d.ts`

**Interfaces:**
- Produces: `SupportedInputFormat` including `"pcaxis"` and detection metadata with PC-Axis encoding.

- [ ] Add failing detection tests for `.px`, `PCAXIS`/`PC-Axis`/`PX`, `text/x-pcaxis`, Windows-1250 and UTF-8 signatures, and comma-heavy PX content.
- [ ] Run `pnpm exec vitest run packages/data-engine/test/detect.test.ts` and confirm the new assertions fail.
- [ ] Register `pcaxis`, add the signature check before delimited sniffing, and map `CODEPAGE` safely.
- [ ] Rerun the focused detection tests and confirm they pass.

### Task 2: Bounded Dense PX Parser

**Files:**
- Create: `packages/data-engine/src/pcaxis.ts`
- Create: `packages/data-engine/test/pcaxis.test.ts`
- Modify: `packages/data-engine/src/index.ts`
- Modify: `packages/data-engine/src/types.ts`

**Interfaces:**
- Produces: `DEFAULT_PCAXIS_LIMITS`, `parsePcAxisMetadata`, `previewPcAxis`, and `writePcAxisRowsAsNdjson`.
- Consumes: `DataRow`, `ValidationIssue`, and configured `PcAxisLimits`.

- [ ] Add failing tests for NIJZ-style 2D Windows-1250, Banka-style UTF-8, SURS-style multilingual 4D, codes, symbols, escaped quotes, multiline assignments, mixed data delimiters, and bounded preview truncation.
- [ ] Add failing safety tests for missing/duplicate/malformed assignments, code mismatch, dimension/cell limits, short/excess data, unsupported encoding, and `KEYS`.
- [ ] Run the new test file and confirm failures are caused by the missing adapter.
- [ ] Implement a bounded statement tokenizer and normalized metadata model.
- [ ] Implement incremental dense-coordinate iteration and deterministic collision-safe columns.
- [ ] Implement streaming NDJSON staging with abort and cleanup behavior.
- [ ] Rerun the parser tests and confirm they pass.

### Task 3: Data Engine Integration

**Files:**
- Modify: `packages/data-engine/src/inspect.ts`
- Modify: `packages/data-engine/src/validate.ts`
- Modify: `packages/data-engine/src/tabular-stage.ts`
- Modify: `packages/data-engine/src/convert.ts`
- Modify: `packages/data-engine/test/preview.test.ts`
- Modify: `packages/data-engine/test/validate.test.ts`
- Modify: `packages/data-engine/test/convert.test.ts`

**Interfaces:**
- Consumes: `previewPcAxis`, `validatePcAxis`, and `writePcAxisRowsAsNdjson`.
- Produces: preview, schema, validation, conversion, and DuckDB staging behavior for `pcaxis`.

- [ ] Add failing end-to-end tests for preview/schema, validation, CSV/JSON conversion, and cleanup.
- [ ] Run the focused tests and confirm the new expectations fail.
- [ ] Dispatch PC-Axis through preview and validation using configured limits.
- [ ] Normalize PC-Axis to invocation-local NDJSON before DuckDB staging.
- [ ] Rerun focused tests and confirm they pass.

### Task 4: Query Cache and Truthful Capabilities

**Files:**
- Modify: `packages/core/src/query-database-cache.ts`
- Modify: `packages/core/src/access.ts`
- Modify: `packages/core/test/query-cache.test.ts`
- Modify: `packages/core/test/access.test.ts`

**Interfaces:**
- Produces: a bumped staging contract and capability lists based on actually supported formats.

- [ ] Add failing tests that PC-Axis query staging uses the new contract and unknown formats only advertise inspection/download.
- [ ] Run the focused core tests and confirm the new assertions fail.
- [ ] Add `pcaxis` to query staging/cache support, bump `QUERY_STAGE_VERSION`, and derive descriptor operations from format support.
- [ ] Rerun the focused core tests and confirm they pass.

### Task 5: Doctor, CLI Contracts, Docs, and Generated Skills

**Files:**
- Modify: `apps/cli/src/commands/doctor.ts`
- Modify: `apps/cli/test/release-contract.test.ts`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `apps/cli/src/public-sdk.d.ts`
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/configuration.md`
- Modify: `docs/formats.md`
- Modify: `docs/commands.md`
- Modify: `docs/recipes.md`
- Modify: generated `skills/klopsi-shared`, `skills/klopsi-resources`, `skills/klopsi-validation`, and `skills/klopsi-analysis`

**Interfaces:**
- Produces: discoverable PC-Axis support and synchronized generated assets.

- [ ] Add failing doctor/release/public-SDK/skill assertions.
- [ ] Run the focused CLI tests and confirm failures.
- [ ] Add a real PC-Axis doctor fixture, public limit declarations, and user-facing documentation of long-form rows, symbol handling, and `KEYS` limitations.
- [ ] Regenerate skills through the repository generator and rerun focused tests.

### Task 6: Verification and Publication

**Files:**
- Review every file changed since the base commit.

- [ ] Run formatter on changed files.
- [ ] Run focused data-engine, core, and CLI tests.
- [ ] Run `pnpm check` and confirm formatting, lint, typecheck, unit, integration, E2E, and packed-package checks pass.
- [ ] Review `git diff --check`, the full diff, and repository status for unrelated changes.
- [ ] Commit the scoped changes, push `codex/pcaxis-input-support`, and open a draft pull request targeting the default branch with issue #32 linked.
