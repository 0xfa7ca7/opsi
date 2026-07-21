# KLOPSI CLI agent skills design

## Goal

Ship an installable repertoire of Agent Skills that lets an AI agent discover and safely use the complete `klopsi` command surface. Follow the Google Workspace CLI model: skills live in the repository as `SKILL.md` files, users install them with a standard skill installer, and the host agent selects and executes them. Do not embed a model, prompt runner, API key, or agent runtime in `klopsi`.

The main skill is named `klopsi`. Agent hosts may expose it as `/klopsi`, `@klopsi`, `$klopsi`, or automatic skill selection. Those prefixes belong to the host; the CLI only supplies standards-compatible skills and documents the host-dependent invocation.

## Architecture

Use a hybrid generated-and-curated design:

- A small curated registry defines skill names, routing descriptions, command ownership, workflows, and safety notes.
- The existing `GLOBAL_OPTION_MANIFEST` and `COMMAND_MANIFEST` remain the source of truth for CLI syntax, arguments, options, choices, conflicts, and command descriptions.
- A deterministic renderer combines both sources into a complete skill tree.
- Generated `skills/*/SKILL.md` files are checked into the repository so `npx skills add https://github.com/0xfa7ca7/opsi` can discover them without first installing the CLI.
- `klopsi generate-skills [--output-dir <path>]` writes the same tree for local installation and development.
- Tests fail when a CLI command is unowned, multiply owned, rendered inaccurately, missing from the checked-in tree, or omitted from the npm package behavior.

The generator must not fetch network documentation. Generation is deterministic and works offline.

## Skill repertoire

The initial repertoire covers every current CLI command:

| Skill | Responsibility |
| --- | --- |
| `klopsi` | Main orchestrator. Classify the request, load `klopsi-shared`, select the smallest relevant domain skill or ordered set of skills, and coordinate multi-step work. |
| `klopsi-shared` | Installation, command discovery, structured output, bounded context, offline behavior, exit categories, confirmation rules, and security constraints shared by every domain. |
| `klopsi-catalogue` | Search the catalogue and list or inspect datasets, including resources, schemas, and public dataset pages. |
| `klopsi-resources` | Inspect resource metadata, headers, and bounded previews. |
| `klopsi-download` | Download dataset or resource content with destination, overwrite, network-override, and provenance guidance. |
| `klopsi-validation` | Validate local/provider data and dataset or resource metadata. |
| `klopsi-analysis` | Query bounded tabular data and convert supported formats. |
| `klopsi-provenance` | Show and verify artifact provenance. |
| `klopsi-local-state` | Inspect and mutate cache/configuration state, including explicit confirmation for destructive cache operations. |
| `klopsi-diagnostics` | Inspect providers, diagnose an installation, and generate shell completion. |

The orchestrator contains a compact intent-to-skill routing table rather than duplicating command documentation. Domain skills link to `../klopsi-shared/SKILL.md` as a prerequisite and may link to each other for multi-stage workflows.

## Skill format and routing

Each skill uses portable frontmatter containing only `name` and `description`. Descriptions carry all trigger guidance because hosts use them before loading the skill body. Bodies use imperative instructions and include:

- a prerequisite link to shared guidance where applicable;
- owned command syntax rendered from the manifest;
- focused workflows and examples;
- read/write/network behavior;
- failure and recovery guidance;
- links to related skills when a task crosses domains.

The `klopsi` orchestrator routes by user intent, not literal command names. It should prefer one domain skill, add related skills only when required, inspect `klopsi <command> --help` when syntax is uncertain, and return a concise result grounded in structured CLI output. It never treats `@`, `/`, or `$` as CLI arguments.

## Generator command

Add `generate-skills` to the command manifest and register it like other commands. Its contract is:

```text
klopsi generate-skills [--output-dir <path>]
```

The default output directory is `./skills`. The command creates one directory per skill and atomically writes its `SKILL.md`. It may replace only the known generated `SKILL.md` targets; it must not delete unrelated files or directories. Diagnostics go to stderr and a concise summary goes through the normal renderer so `--json` remains available.

Generation accepts absolute or relative output paths, rejects a path whose existing non-directory components make generation unsafe, and reports typed invalid-input or filesystem errors. Partial publication must not leave a half-written individual file. Re-running the command is idempotent.

The checked-in tree is regenerated from the same renderer. A drift test compares exact bytes rather than relying on manually maintained snapshots.

## Data flow

1. A user installs all repository skills or a selected domain skill with a compatible skill installer.
2. The host sees the `klopsi` description and loads the main skill for broad KLOPSI requests.
3. The main skill maps the request to the minimum domain repertoire and loads `klopsi-shared` plus those skills.
4. The agent uses the documented CLI syntax, preferring JSON/NDJSON and narrow fields or row limits.
5. The existing CLI performs all authentication, networking, validation, querying, filesystem, and rendering work. Skills do not bypass CLI safeguards.
6. The agent interprets stdout, stderr, and exit status using the shared contract and reports results or remediation.

For explicit narrow requests, a host may select a domain skill directly without loading the orchestrator. Each domain skill therefore remains independently understandable once its shared prerequisite is read.

## Safety and error handling

- Require user confirmation before `cache clear`, `cache prune`, or overwriting artifacts with `--force`, unless the user already explicitly requested that exact mutation.
- Preserve existing HTTPS, private-network, size, timeout, query, and output bounds. Do not suggest bypass flags unless the user explicitly accepts the risk.
- Prefer `--offline` when the user requests no network access; never imply offline mode can satisfy an uncached request.
- Never parse human tables when structured output is available.
- Treat stdout as results, stderr as diagnostics, and process status as the authoritative success/failure signal.
- On failure, use the stable exit category and structured error code to choose remediation. Do not blindly retry validation, integrity, unsupported, or invalid-input failures.
- Keep generated examples free of real identifiers, secrets, API keys, and machine-specific paths.

## Documentation and distribution

Update the main README with an Agent Skills section modeled on Google Workspace CLI:

```sh
npx skills add https://github.com/0xfa7ca7/opsi
npx skills add https://github.com/0xfa7ca7/opsi/tree/main/skills/klopsi-analysis
```

Document automatic routing and the host-dependent `/klopsi`, `@klopsi`, or `$klopsi` forms without claiming every host implements every prefix. Link a generated `docs/skills.md` index that lists the full repertoire and its responsibilities.

The npm package must retain the `generate-skills` implementation so globally installed users can generate the same skills. The root checked-in skill tree is distributed through GitHub rather than duplicated as package assets.

## Testing

Follow test-driven development:

- Unit-test registry validation, command ownership, frontmatter, deterministic rendering, escaping, and error cases.
- Assert every command in `COMMAND_MANIFEST` belongs to exactly one domain skill, including `generate-skills` itself under diagnostics.
- Add CLI integration coverage for default and explicit output directories, JSON output, idempotent regeneration, safe handling of existing unrelated files, and filesystem failures.
- Add a drift test comparing rendered output with every checked-in `skills/*/SKILL.md` and `docs/skills.md` file.
- Extend help/completion/release-contract tests for the new command.
- Extend pack tests to run `generate-skills` from the packed npm artifact and validate representative generated skills.
- Run skill frontmatter validation and the repository's full formatting, lint, typecheck, test, build, and pack checks before opening the PR.

## Release and compatibility

This is an additive CLI feature and receives a minor Changeset for `klopsi`. Existing commands, structured envelopes, exit codes, and SDK exports remain compatible. The implementation introduces no runtime network dependency and no AI-provider dependency.

## Out of scope

- Running an LLM or interactive natural-language shell inside `klopsi`.
- Guaranteeing one universal invocation prefix across agent hosts.
- Adding an MCP server, editor extension, or hosted agent.
- Shipping personas or task recipes beyond the complete command-oriented repertoire in this first release.
