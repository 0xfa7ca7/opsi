# OPSI Agent Skill Capability Audit Design

## Goal

Ensure the installable OPSI Agent Skills let a user-facing coding agent discover and use the complete public `opsi` CLI safely and effectively. The repertoire must teach practical workflows and decision points, not merely repeat command syntax, while remaining focused on public-data users rather than OPSI contributors or TypeScript SDK consumers.

## Scope

The audit covers every public command, argument, option, conflict, supported input and output format, safety boundary, structured-output contract, and cross-command workflow exposed by the CLI. It includes catalogue access, resource inspection, downloads, validation, local analysis, conversion, WFS access, provenance, cache and configuration management, diagnostics, skill generation, and agent installation.

The audit does not add TypeScript SDK guidance, contributor workflows, internal architecture documentation, or model-provider integrations. If evaluation exposes a defect that prevents a documented user-facing skill workflow from working, this work may fix that public CLI behavior with a focused regression test. It does not invent a shell or HTTP workaround.

## Existing State

The current registry assigns every command in `COMMAND_MANIFEST` to exactly one domain skill, and drift tests keep generated `SKILL.md` files synchronized with the registry. That provides complete syntactic ownership. The generated domain skills, however, contain only short workflow bullets plus manifest-derived syntax, so agents receive little help choosing among inputs, formats, modes, outputs, or safe recovery paths.

The repository contains eleven skills: an orchestrator, a shared execution contract, and nine domain skills. A locally installed older repertoire can legitimately be stale and omit recently added domains such as WFS services; `opsi agent setup` and `opsi generate-skills` must therefore explain refresh and verification clearly.

Baseline evaluation also exposed a defect in automatic setup: OPSI generated the repertoire in a temporary directory, let the pinned installer create symlinks by default, and then removed the temporary source. The resulting installation could contain dangling symlinks. Because the generated source is intentionally ephemeral, `agent setup` always installs durable copies before cleanup. Copying is an internal invariant rather than a public mode choice.

## Chosen Approach

Keep the current eleven-skill topology and enrich the generator's curated domain definitions. Each domain remains the smallest independently discoverable unit for its user intent. The orchestrator continues to route broad requests, while the shared skill owns rules that apply everywhere.

The generator remains the source of truth. Checked-in skills and `docs/skills.md` remain generated artifacts protected by exact-byte drift tests. Capability guidance is represented in structured registry fields or focused renderer helpers so tests can verify required topics without maintaining handwritten generated files.

The `agent setup` orchestration continues to own a private, mode-`0700` temporary source and remove it on both success and failure. It always asks the pinned installer to copy generated skills into selected global agent locations, making those targets independent of temporary-source cleanup. A real-installer integration test must read installed skill content after `setupAgents()` has returned and the temporary source no longer exists.

This approach is preferred over one comprehensive skill, which would consume unnecessary context and weaken routing, and over a large new reference-file hierarchy, which would add indirection without enough content to justify it.

## Skill Content Design

### Orchestrator

The `opsi` skill routes both single-domain and common end-to-end requests. It names the complete public repertoire, includes WFS and agent setup, and distinguishes discovery, inspection, acquisition, validation, analysis, conversion, export, provenance, and local-state work. It tells agents to load only the domains needed for the current workflow.

### Shared execution contract

`opsi-shared` explains how to verify installation and runtime help, choose structured output, keep results bounded, resolve local paths versus canonical provider references, preserve offline and network controls, interpret stdout/stderr/exit status, and handle mutation confirmation. It defines the default decision order: discover or resolve input, inspect, preview, validate when useful, perform the requested operation, and verify important artifacts.

### Domain skills

Each domain skill contains concise capability guidance before its manifest-derived command reference:

- `opsi-catalogue`: snapshot, refresh, live traversal, search filters, pagination, metadata, resources, schema inference, and public-page opening.
- `opsi-resources`: local/provider inputs, access inspection, secure header probes, bounded previews, format ambiguity, and handoff to download, validation, services, or analysis.
- `opsi-download`: dataset/resource disambiguation, single versus batch destinations, overwrite behavior, partial success, and provenance verification.
- `opsi-validation`: data versus metadata validation, archive/XML/XLSX selectors, integrity failures, and actionable remediation.
- `opsi-analysis`: supported tabular inputs, safe read-only SQL, limits and deadlines, query exports, conversion destinations, spreadsheet safety, overwrites, and provenance.
- `opsi-services`: canonical WFS discovery, layers, schema, typed equality filters, properties, bounding boxes and CRS, pagination, counts, bounded CSV exports, and prohibited transaction/raw-query fallbacks.
- `opsi-provenance`: show versus verify, digest mismatches, source and transformation interpretation, and evidence preservation.
- `opsi-local-state`: raw and derived cache visibility, verification, pruning and clearing, configuration inspection and validated updates, confirmation, and non-secret constraints.
- `opsi-diagnostics`: providers, offline diagnostics, shell completion, skill generation, host detection, targeted/all-host installation, durable-copy behavior, dry runs, non-interactive confirmation, and refreshing stale installations.

Guidance uses concrete command sequences where sequence matters and concise decision tables where agents must choose among modes. It does not duplicate general programming knowledge or internal implementation details.

## Capability Coverage Contract

Structural coverage remains mandatory: every manifest command belongs to exactly one domain, and every argument, option, choice, required marker, and conflict appears in generated output.

Behavioral coverage adds explicit, testable capability topics derived from the public documentation and command behavior. Tests assert that the appropriate generated skill contains each required topic and that routing descriptions expose every domain before a skill body is loaded. This prevents a future command or major mode from being technically listed yet operationally undiscoverable.

Generated frontmatter retains only `name` and `description`, uses third-person trigger descriptions beginning with `Use when`, and stays within Agent Skills limits. References remain one level deep. Generated files remain deterministic, below 500 lines each, and free of secrets, placeholders, and machine-specific paths.

## Evaluation Strategy

Before editing skill content, fresh agents receive realistic user tasks without the relevant OPSI domain skill. Scenarios cover at least:

1. Discovering and extracting an ambiguous ZIP or XML-backed dataset into a bounded query/export workflow.
2. Inspecting and exporting a filtered WFS layer without bypassing OPSI safeguards.
3. Diagnosing and refreshing an incomplete or stale installed skill repertoire.

Baseline results record missed capabilities, unsafe fallbacks, incorrect command sequences, and rationalizations verbatim. After the minimal guidance changes, fresh agents receive equivalent tasks with the improved skills and must choose valid OPSI commands, preserve bounds and safeguards, and include appropriate verification. Any new failure pattern is addressed and re-evaluated.

Repository tests then verify registry integrity, generated output, drift, formatting, lint, type checking, unit/integration/e2e behavior, packaging, and the full project check.

## Error Handling and Safety

Skills never advise raw HTTP, direct DuckDB access, WFS transactions, arbitrary CQL/XML filters, or other bypasses when OPSI supports the operation. They require explicit user acceptance for insecure HTTP or private-network access and explicit authorization for destructive cache operations or overwrites.

Agents treat invalid input, unsupported operations, validation/integrity failures, query failures, provider/network failures, and partial success according to the stable exit categories. Offline mode never silently falls back to the network. Important generated artifacts are verified through provenance when available.

## Documentation and Delivery

Regenerate all checked-in skills and the skill index from the updated renderer. Update user-facing skill documentation only where installation, refresh, or capability descriptions change. Add a Changeset if the repository's release policy treats richer distributed skills as a user-visible package change.

The completed work is reviewed against this specification, committed on a `codex/` branch, pushed to `origin`, and opened as a pull request against `main` with verification evidence and a concise capability-audit summary.
