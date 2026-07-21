import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import {
  COMMAND_MANIFEST,
  GLOBAL_OPTION_MANIFEST,
  type CommandManifestEntry,
  type CommandOptionManifest,
} from "./command-manifest.js";

export interface AgentSkillCapabilityGuide {
  readonly id: string;
  readonly title: string;
  readonly instructions: readonly string[];
}

export interface AgentSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly commands: readonly string[];
  readonly purpose: string;
  readonly workflows: readonly string[];
  readonly capabilities: readonly AgentSkillCapabilityGuide[];
  readonly safety: readonly string[];
  readonly related: readonly string[];
}

export const AGENT_SKILLS: readonly AgentSkillDefinition[] = [
  {
    name: "opsi",
    description:
      "Use when a Slovenian public-data or OPSI request needs the relevant skill selected.",
    commands: [],
    purpose:
      "Classify the request, load shared guidance, and select the smallest relevant domain skill or ordered set of skills.",
    workflows: [
      "Acquire and analyze data",
      "Inspect and export WFS data",
      "Refresh an agent installation",
    ],
    capabilities: [],
    safety: [],
    related: [
      "opsi-catalogue",
      "opsi-resources",
      "opsi-download",
      "opsi-validation",
      "opsi-analysis",
      "opsi-services",
      "opsi-provenance",
      "opsi-local-state",
      "opsi-diagnostics",
    ],
  },
  {
    name: "opsi-shared",
    description:
      "Use when any OPSI CLI skill needs shared installation, output, offline, safety, or error-handling guidance.",
    commands: [],
    purpose: "Provide the common execution contract every OPSI domain skill must follow.",
    workflows: [
      "Resolve the input, inspect it, preview a bounded sample, validate when useful, perform the requested operation, then verify important artifacts.",
    ],
    capabilities: [],
    safety: [
      "Prefer structured output and bounded result sets.",
      "Honor offline requests and existing network safeguards.",
      "Confirm destructive or overwrite operations unless already explicitly authorized.",
      "Do not fall back to curl or another raw HTTP client for an operation supported by opsi.",
    ],
    related: [],
  },
  {
    name: "opsi-catalogue",
    description:
      "Use when discovering Slovenian public-data or OPSI datasets, metadata, resources, schemas, or public pages.",
    commands: [
      "search",
      "dataset list",
      "dataset show",
      "dataset resources",
      "dataset schema",
      "dataset open",
    ],
    purpose: "Find datasets and inspect their normalized metadata and tabular schemas.",
    workflows: [
      "Search with a narrow limit and fields, then inspect the selected dataset.",
      "List dataset resources before selecting one for preview or download.",
    ],
    capabilities: [
      {
        id: "catalogue-mode",
        title: "Choose catalogue mode",
        instructions: [
          "Use the published snapshot for ordinary discovery; use `dataset list --refresh` only when a fresh snapshot is needed.",
          "Use `dataset list --live` for an explicit paginated live traversal, and do not combine it with `--refresh`.",
        ],
      },
      {
        id: "search-refinement",
        title: "Refine discovery",
        instructions: [
          "Start with `search` using `--limit`, `--fields`, and only the relevant organization, tag, format, license, date, or sort filters.",
          "Use `--all` only when every result page is required; otherwise retain a bounded page and exact IDs returned by the CLI.",
        ],
      },
      {
        id: "dataset-followup",
        title: "Follow a selected dataset",
        instructions: [
          "Run `dataset show`, then `dataset resources` before choosing a resource; use `dataset schema` when tabular structure determines the choice.",
          "Use `dataset open` only to view the provider's public page, not as a replacement for structured CLI metadata.",
        ],
      },
    ],
    safety: ["Use explicit live catalogue traversal only when the user needs it."],
    related: ["opsi-resources", "opsi-download", "opsi-validation"],
  },
  {
    name: "opsi-resources",
    description:
      "Use when inspecting an OPSI resource, its secure access, headers, or bounded preview before the next step.",
    commands: ["resource show", "resource inspect", "resource headers", "resource preview"],
    purpose: "Inspect a resource safely without committing to a full data workflow.",
    workflows: [
      "Inspect metadata and headers before downloading an unfamiliar resource.",
      "Preview a bounded number of rows before validation or analysis.",
    ],
    capabilities: [
      {
        id: "input-resolution",
        title: "Resolve the input",
        instructions: [
          "Use a local path for local data and retain an exact `opsi:resource:` reference for provider data; do not invent either identifier.",
          "Run `resource inspect` to learn supported access operations before choosing download, validation, WFS, or analysis.",
        ],
      },
      {
        id: "access-selection",
        title: "Select safe access",
        instructions: [
          "Use `resource headers` for a secure provider-header probe and `resource preview` with a small `--limit` for a bounded content check.",
          "Route a WFS resource to the services skill after inspection; do not replace OPSI access controls with direct HTTP.",
        ],
      },
      {
        id: "structured-selectors",
        title: "Resolve structured content",
        instructions: [
          "Use one `--entry` or `--record-path` reported by resource inspect or the relevant operation's structured error/output; resource inspect can surface ZIP entries and XML record paths.",
          "Without `--sheet`, XLSX resource preview, validate, or query emits `SHEET_REQUIRED` with `context.sheets` and a suggestion; use one listed sheet.",
        ],
      },
    ],
    safety: ["Keep previews bounded and do not weaken network controls implicitly."],
    related: ["opsi-catalogue", "opsi-download", "opsi-validation", "opsi-analysis"],
  },
  {
    name: "opsi-download",
    description:
      "Use when securely downloading an OPSI dataset or resource and choosing a destination or overwrite handling.",
    commands: ["download"],
    purpose: "Download selected provider resources through the CLI's bounded secure downloader.",
    workflows: ["Resolve a canonical resource or dataset reference, then download it."],
    capabilities: [
      {
        id: "target-resolution",
        title: "Resolve download targets",
        instructions: [
          "Pass canonical resource references when available; use `--dataset` or `--resource` to disambiguate bare identifiers.",
          "Inspect a selected resource first when its format or access method is uncertain.",
        ],
      },
      {
        id: "destination-strategy",
        title: "Choose a destination",
        instructions: [
          "For a batch, `--destination` or `--output` must name an existing directory; a file destination is valid for one resource only.",
          "Otherwise use the configured download directory; do not use `--force` to replace an existing artifact unless that exact overwrite is authorized, and verify the existing artifact first when it matters.",
        ],
      },
      {
        id: "partial-results",
        title: "Handle batch results",
        instructions: [
          "For a batch, report each successful and failed resource separately; exit 8 means Partial success, not complete success.",
          "Run `provenance verify` for important downloaded artifacts before handing them to later workflow steps.",
        ],
      },
    ],
    safety: ["Confirm before replacing an existing artifact with --force."],
    related: ["opsi-catalogue", "opsi-resources", "opsi-validation", "opsi-provenance"],
  },
  {
    name: "opsi-validation",
    description:
      "Use when checking local or provider data, or OPSI metadata, for integrity issues and remediation.",
    commands: ["validate"],
    purpose: "Validate data content or normalized metadata and explain actionable issues.",
    workflows: ["Validate downloaded content before analysis or conversion."],
    capabilities: [
      {
        id: "validation-mode",
        title: "Choose validation mode",
        instructions: [
          "Validate a local path or canonical provider reference before analysis; use `--metadata` when only normalized metadata should be checked.",
          "Use offline validation after acquisition when all required input is local; do not silently retry a failed offline request online.",
        ],
      },
      {
        id: "structured-selectors",
        title: "Select structured data",
        instructions: [
          "Use one `--entry` or `--record-path` reported by resource inspect or the relevant operation's structured error/output; resource inspect can surface ZIP entries and XML record paths.",
          "Without `--sheet`, XLSX resource preview, validate, or query emits `SHEET_REQUIRED` with `context.sheets` and a suggestion; use one listed sheet.",
        ],
      },
      {
        id: "failure-recovery",
        title: "Recover from validation failures",
        instructions: [
          "Treat exit 6 as a validation or integrity failure: report the issues and repair, replace, or reselect the input before retrying.",
          "Do not treat validation or integrity failure as a transient network error or bypass it before analysis.",
        ],
      },
    ],
    safety: ["Treat integrity failures as non-retryable until the input changes."],
    related: ["opsi-resources", "opsi-download", "opsi-analysis"],
  },
  {
    name: "opsi-analysis",
    description:
      "Use when querying or converting bounded data, including ZIP, XML, JSON, XLSX, Parquet, or query exports.",
    commands: ["query", "convert"],
    purpose: "Analyze tabular inputs with bounded read-only SQL or convert supported formats.",
    workflows: [
      "Preview and validate input before running a bounded query.",
      "Convert an input and then verify the generated provenance record.",
    ],
    capabilities: [
      {
        id: "supported-inputs",
        title: "Choose a supported input",
        instructions: [
          "Query or convert CSV, TSV, JSON, NDJSON, XLSX, Parquet, ZIP, or XML only after inspection identifies a usable tabular member.",
          "Use a resolved `--entry`, `--record-path`, or `--sheet` whenever ZIP, XML, or XLSX input is ambiguous.",
        ],
      },
      {
        id: "bounded-query",
        title: "Run bounded read-only SQL",
        instructions: [
          "Use one read-only `SELECT`, `WITH ... SELECT`, or `VALUES` statement, with an explicit `--limit` and a suitable timeout.",
          "Keep global query row, time, memory, and thread bounds appropriate to the requested result; correct exit 7 rather than retrying the same query.",
        ],
      },
      {
        id: "query-export",
        title: "Export query results",
        instructions: [
          "Use `--output` for a bounded query export and choose a new path unless the user explicitly authorizes `--force`.",
          "Run `provenance verify` on an important query export before reporting it as a final artifact.",
        ],
      },
      {
        id: "safe-conversion",
        title: "Convert safely",
        instructions: [
          "Choose a supported conversion target and `--output`; use `--spreadsheet-safe` for CSV or XLSX intended for spreadsheet software.",
          "Validate or inspect the converted result and use `provenance verify`; do not overwrite an existing destination without authorization.",
        ],
      },
    ],
    safety: [
      "Keep SQL read-only and bounded.",
      "Confirm before replacing an existing output with --force.",
    ],
    related: ["opsi-resources", "opsi-validation", "opsi-provenance"],
  },
  {
    name: "opsi-services",
    description:
      "Use when Slovenian public data is exposed through WFS and the request needs capabilities, layers, schemas, bounded feature previews, counts, or CSV exports.",
    commands: [
      "service inspect",
      "service layers",
      "service schema",
      "service preview",
      "service count",
      "service export",
    ],
    purpose: "Access WFS feature services through bounded, schema-validated OPSI workflows.",
    workflows: [
      "Inspect a canonical WFS resource, list layers, then inspect a selected layer schema.",
      "Preview or count a layer with typed equality filters before exporting bounded rows.",
    ],
    capabilities: [
      {
        id: "wfs-sequence",
        title: "Inspect the WFS service and layer",
        instructions: [
          "Keep the exact canonical `opsi:resource:` reference returned by OPSI; run `service inspect`, then `service layers`, then `service schema --layer <name>` before selecting features.",
          "Use the layer schema to choose a layer and its available fields; do not infer feature bounds or paging support from service inspection metadata.",
        ],
      },
      {
        id: "feature-selection",
        title: "Select fields and matching features",
        instructions: [
          "Use a small `service preview` before export; `--property` may repeat or take a comma-separated list to select the fields to return.",
          "Use `--filter-eq <field=value>` for typed lexical equality: values are coerced as booleans, numbers, or strings, not schema-aware XSD coercion.",
          "Use `service count` to measure the filtered selection before choosing an export limit.",
        ],
      },
      {
        id: "spatial-filtering",
        title: "Constrain space and pagination",
        instructions: [
          "Use `--bbox <minx,miny,maxx,maxy>` for a spatial extent, and `--crs <name>` must name the coordinate reference system used for the bbox.",
          "When paging, `--start-index` is zero-based; keep each preview or export bounded with a finite `--limit`.",
        ],
      },
      {
        id: "bounded-export",
        title: "Export and verify a bounded result",
        instructions: [
          "After previewing or counting the selection, use `service export` with a finite `--limit`; export output is CSV only.",
          "Choose a new output path unless the user gives `--force` after explicit overwrite authorization, then run `provenance verify` on an important exported artifact.",
        ],
      },
    ],
    safety: [
      "Use canonical resource references and bounded limits.",
      "Never send transaction requests, raw CQL, arbitrary XML filters, or direct HTTP calls.",
    ],
    related: ["opsi-catalogue", "opsi-resources", "opsi-analysis", "opsi-provenance"],
  },
  {
    name: "opsi-provenance",
    description:
      "Use when inspecting or verifying OPSI artifact provenance, transformations, or integrity mismatches.",
    commands: ["provenance show", "provenance verify"],
    purpose: "Inspect recorded lineage and verify an artifact against its digest.",
    workflows: ["Verify every important downloaded, converted, or query-exported artifact."],
    capabilities: [
      {
        id: "record-inspection",
        title: "Inspect recorded lineage",
        instructions: [
          "Use `provenance show` to inspect an artifact's source, retrieval, and transformation record before explaining where it came from.",
          "Compare the record with the exact local artifact and preserve canonical references returned by OPSI.",
        ],
      },
      {
        id: "integrity-verification",
        title: "Verify artifact integrity",
        instructions: [
          "Use `provenance verify` to recompute and compare the artifact digest after download, conversion, or query export.",
          "Report a digest mismatch as integrity failure; Do not mutate, replace, or discard the evidence before it is reported.",
        ],
      },
    ],
    safety: ["Do not dismiss a digest mismatch or mutate evidence before reporting it."],
    related: ["opsi-download", "opsi-analysis"],
  },
  {
    name: "opsi-local-state",
    description: "Use when inspecting or changing the OPSI cache or non-secret configuration.",
    commands: [
      "cache info",
      "cache list",
      "cache clear",
      "cache prune",
      "cache verify",
      "config get",
      "config set",
      "config list",
      "config path",
    ],
    purpose: "Manage local cache and validated non-secret CLI configuration.",
    workflows: [
      "Inspect cache state before pruning or clearing it.",
      "Locate and inspect configuration before changing a value.",
    ],
    capabilities: [
      {
        id: "cache-tiers",
        title: "Distinguish cache tiers from downloads",
        instructions: [
          "The cache holds the catalogue snapshot and cached raw objects alongside rebuildable derived DuckDB stages; `cache list` labels entries as `raw` or `duckdb-stage`.",
          "Files written by `download` are destination files, not cache entries; preserve them separately when they matter, while a derived DuckDB stage can be rebuilt from its input.",
        ],
      },
      {
        id: "cache-mutations",
        title: "Inspect before mutating cache state",
        instructions: [
          "Use `cache info`, `cache list`, and `cache verify` before `cache prune` or `cache clear` to understand size, entry kind, and integrity.",
          "`cache prune` removes unreferenced raw objects and expired or over-budget derived stages; `cache clear` removes the whole cache. Require explicit authorization before either mutation, then use `--yes` only for that authorized operation.",
        ],
      },
      {
        id: "configuration",
        title: "Inspect validated non-secret configuration",
        instructions: [
          "Use `config path`, `config list`, and `config get <key>` to locate and inspect a value before `config set <key> <value>`; configuration values are validated when written.",
          "Keep secrets out of configuration: secret-like keys cannot be persisted, so provide credentials through environment variables for the current process instead.",
        ],
      },
    ],
    safety: ["Confirm cache clear or prune unless the exact mutation is already authorized."],
    related: ["opsi-diagnostics"],
  },
  {
    name: "opsi-diagnostics",
    description:
      "Use when diagnosing OPSI, generating shell completion or Agent Skills, or performing agent setup.",
    commands: ["providers list", "doctor", "completion", "generate-skills", "agent setup"],
    purpose:
      "Generate installable Agent Skills, diagnose the CLI environment, and expose providers and shell integration.",
    workflows: [
      "Use `opsi agent setup` to detect installed agent hosts and install the complete OPSI skill repertoire globally.",
      "Setup copies generated skills before removing its temporary source, so completed installations remain durable.",
      "Use `--dry-run` to inspect the installation plan, or `--agent` when the target host IDs are already known.",
      "Run offline diagnostics first when network access is unavailable or unwanted.",
    ],
    capabilities: [
      {
        id: "environment-diagnostics",
        title: "Diagnose the environment without network access",
        instructions: [
          "Run `opsi doctor --offline --json` first when network access is unavailable or unwanted; offline mode skips the connectivity check while retaining local environment, cache, DuckDB, and format checks.",
          "Run `opsi providers list --offline --json` to record the registered provider inventory without turning diagnosis into a network request.",
          "Read every failed or skipped check in structured output before changing the environment, configuration, or cache.",
        ],
      },
      {
        id: "shell-integration",
        title: "Generate shell completion",
        instructions: [
          "Use `opsi completion <bash|zsh|fish>` to print completion for the selected shell, then follow that shell's normal installation or sourcing workflow.",
          "Regenerate completion after upgrading OPSI rather than editing generated completion output.",
        ],
      },
      {
        id: "skill-generation",
        title: "Generate a portable skill tree",
        instructions: [
          "`generate-skills` writes the complete portable repertoire to its output directory but does not install it into an agent host.",
          "Use `opsi generate-skills --output-dir ./generated-skills --json` when another workflow needs a portable tree instead of a host installation.",
        ],
      },
      {
        id: "agent-refresh",
        title: "Preview, install, and refresh agent skills",
        instructions: [
          "Detected hosts are used only for a non-dry-run setup without `--agent` or `--all`; `--agent` selects explicit hosts, `--all` selects every supported host, and `--yes` accepts detected hosts for unattended setup.",
          "`--dry-run` reports the planned selection and repertoire without installing or detecting hosts. An empty detection result fails safely and never expands `--yes` to every supported host.",
          "Use this refresh recipe: `opsi doctor --offline --json`; `opsi agent setup --agent codex --dry-run --json`; `opsi agent setup --agent codex --yes --json`.",
          "`agent setup` installs or refreshes the complete repertoire for selected hosts as durable copies. Rerun `opsi agent setup` to refresh a stale repertoire, then verify in structured setup output that `agents` contains the requested host and `skills` contains the complete repertoire. Do not infer an installed host path or use a guessed filesystem location. `generate-skills` does not install or refresh Codex; use it only for a portable tree.",
        ],
      },
    ],
    safety: [
      "Do not turn a diagnostic check into a network request when offline was requested.",
      "In non-interactive use, require `--yes`, `--agent`, or `--all` before installing skills.",
    ],
    related: ["opsi-local-state"],
  },
] as const;

export function validateAgentSkills(
  skills: readonly AgentSkillDefinition[] = AGENT_SKILLS,
  commands: readonly CommandManifestEntry[] = COMMAND_MANIFEST,
): readonly string[] {
  const problems: string[] = [];
  const skillNames = skills.map((entry) => entry.name);
  const commandPaths = new Set(commands.map((entry) => entry.path));

  for (const required of ["opsi", "opsi-shared"] as const) {
    if (!skillNames.includes(required)) problems.push(`Missing required skill "${required}".`);
  }

  const seenNames = new Set<string>();
  for (const entry of skills) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name)) {
      problems.push(`Invalid skill name "${entry.name}".`);
    }
    if (seenNames.has(entry.name)) problems.push(`Duplicate skill name "${entry.name}".`);
    seenNames.add(entry.name);
    if ((entry.name === "opsi" || entry.name === "opsi-shared") && entry.commands.length > 0) {
      problems.push(`Reserved skill "${entry.name}" must not own commands.`);
    }
    if (entry.name !== "opsi" && entry.name !== "opsi-shared" && entry.commands.length === 0) {
      problems.push(`Domain skill "${entry.name}" must own at least one command.`);
    }
    const seenCapabilityIds = new Set<string>();
    for (const capability of entry.capabilities) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(capability.id)) {
        problems.push(`Invalid capability ID "${capability.id}" in "${entry.name}".`);
      }
      if (seenCapabilityIds.has(capability.id)) {
        problems.push(
          `Capability ID "${capability.id}" is listed more than once by "${entry.name}".`,
        );
      }
      seenCapabilityIds.add(capability.id);
      if (capability.title.trim().length === 0) {
        problems.push(
          `Capability "${capability.id}" in "${entry.name}" must have a non-blank title.`,
        );
      }
      if (
        capability.instructions.length === 0 ||
        capability.instructions.some((instruction) => instruction.trim().length === 0)
      ) {
        problems.push(
          `Capability "${capability.id}" in "${entry.name}" must have non-blank instructions.`,
        );
      }
    }
    const seenCommandPaths = new Set<string>();
    for (const path of entry.commands) {
      if (seenCommandPaths.has(path)) {
        problems.push(`Command path "${path}" is listed more than once by "${entry.name}".`);
      }
      seenCommandPaths.add(path);
      if (!commandPaths.has(path)) {
        problems.push(`Unknown command path "${path}" owned by "${entry.name}".`);
      }
    }
    for (const related of entry.related) {
      if (!skillNames.includes(related)) {
        problems.push(`Unknown related skill "${related}" referenced by "${entry.name}".`);
      }
    }
  }

  for (const path of commandPaths) {
    const owners = skills
      .filter((entry) => entry.commands.includes(path))
      .map((entry) => entry.name);
    if (owners.length === 0) {
      problems.push(`Command path "${path}" is not owned by a domain skill.`);
    } else if (owners.length > 1) {
      problems.push(`Command path "${path}" is owned by multiple skills: ${owners.join(", ")}.`);
    }
  }

  return problems;
}

function frontmatter(definition: AgentSkillDefinition): string {
  return `---
name: ${definition.name}
description: ${JSON.stringify(definition.description)}
---
`;
}

function tableText(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function optionValue(option: CommandOptionManifest): string {
  if (option.choices !== undefined) {
    return option.choices.map((choice) => `\`${choice}\``).join(", ");
  }
  return option.flags.match(/[<[]([^>\]]+)[>\]]/u)?.[1] ?? "—";
}

function optionLabel(option: CommandOptionManifest): string {
  return `\`${tableText(option.flags)}\``;
}

function longOptionFlag(option: CommandOptionManifest): string | undefined {
  return option.flags.match(/--[a-z][a-z0-9-]*/u)?.[0];
}

function optionAttributeName(option: CommandOptionManifest): string | undefined {
  return longOptionFlag(option)
    ?.slice(2)
    .replace(/^no-/u, "")
    .replace(/-([a-z0-9])/gu, (_match, character: string) => character.toUpperCase());
}

function optionConflicts(
  option: CommandOptionManifest,
  availableOptions: readonly CommandOptionManifest[],
): string {
  return option.conflicts === undefined
    ? "—"
    : option.conflicts
        .map((item) => {
          const conflictingOption = availableOptions.find(
            (candidate) => optionAttributeName(candidate) === item,
          );
          const conflictLabel =
            conflictingOption === undefined ? item : (longOptionFlag(conflictingOption) ?? item);
          return `\`${conflictLabel}\``;
        })
        .join(", ");
}

function commandUsage(entry: CommandManifestEntry): string {
  const commandArguments = entry.arguments.map((argument) => argument.name).join(" ");
  const requiredOptions = entry.options
    .filter((option) => option.mandatory === true)
    .map((option) => option.flags)
    .join(" ");
  const optional = entry.options.some((option) => option.mandatory !== true) ? "[options]" : "";
  return ["opsi", entry.path, commandArguments, requiredOptions, optional]
    .filter((part) => part.length > 0)
    .join(" ");
}

function renderArguments(entry: CommandManifestEntry): string {
  if (entry.arguments.length === 0) return "";
  const rows = entry.arguments
    .map((argument) => {
      const choices =
        argument.choices === undefined
          ? "—"
          : argument.choices.map((choice) => `\`${choice}\``).join(", ");
      return `| \`${tableText(argument.name)}\` | ${choices} | ${tableText(argument.description)} |`;
    })
    .join("\n");
  return `#### Arguments

| Argument | Values | Description |
| --- | --- | --- |
${rows}

`;
}

function renderOptions(entry: CommandManifestEntry): string {
  if (entry.options.length === 0) return "";
  const rows = entry.options
    .map(
      (option) =>
        `| ${optionLabel(option)} | ${option.mandatory === true ? "yes" : "no"} | ${optionValue(option)} | ${optionConflicts(option, entry.options)} | ${tableText(option.description)} |`,
    )
    .join("\n");
  return `#### Options

| Option | Required | Values | Conflicts | Description |
| --- | --- | --- | --- | --- |
${rows}

`;
}

function renderCommand(entry: CommandManifestEntry): string {
  return `### \`${entry.path}\`

${entry.description}.

\`\`\`sh
${commandUsage(entry)}
\`\`\`

${renderArguments(entry)}${renderOptions(entry)}`;
}

function renderOrchestrator(definition: AgentSkillDefinition, version: string): string {
  const routes = definition.related
    .map((name) => {
      const target = AGENT_SKILLS.find((candidate) => candidate.name === name);
      if (target === undefined) throw new Error(`Missing related skill: ${name}`);
      return `| ${tableText(target.purpose)} | [${name}](../${name}/SKILL.md) |`;
    })
    .join("\n");
  return `${frontmatter(definition)}
# OPSI orchestrator

Use this skill as the main entry point for Slovenian public-data work with the \`opsi\` CLI. Generated for \`opsi\` ${version}.

## Route requests

1. Read [opsi-shared](../opsi-shared/SKILL.md).
2. Classify the request and load the smallest relevant skill from this table.
3. Load more than one domain skill only when the workflow crosses domains.
4. Execute the documented \`opsi\` commands and summarize structured results.

| Intent | Skill |
| --- | --- |
${routes}

Do not pass \`/opsi\`, \`@opsi\`, or \`$opsi\` to the shell. Those are host-specific ways to invoke this skill; shell commands begin with \`opsi\`.

## End-to-end workflows

### ${definition.workflows[0]}

1. Search with a bounded result set, inspect the selected dataset and resource, then preview and validate the chosen input.
2. Download it to a new destination when local processing is needed; then use \`--offline\` for the local validation, query, conversion, and provenance steps.
3. Keep queries read-only and bounded, authorize any overwrite, and run \`provenance verify\` for important outputs.

### ${definition.workflows[1]}

1. Inspect the canonical WFS resource, list its layers, and inspect the selected layer schema.
2. Preview or count a finite selection before exporting a bounded CSV; preserve the CLI's network safeguards and never send WFS transactions.
3. Verify the exported artifact with provenance.

### ${definition.workflows[2]}

1. Run \`opsi agent setup --dry-run\` to inspect the planned selection and repertoire.
2. With explicit authorization, select the intended host with \`--agent <id>\` and use \`--yes\` for non-interactive installation.
3. Confirm the result includes the current repertoire, including \`opsi-services\`; use \`generate-skills\` only when a portable skill tree is needed rather than an installation.

## Routing rules

- Prefer the narrowest skill that fully handles the request.
- Inspect \`opsi <command> --help\` if runtime syntax might differ from the generated reference.
- Keep identifiers returned by the CLI exact; do not invent dataset or resource IDs.
- Return a concise result grounded in stdout, stderr, and the process exit status.
`;
}

function globalOptionsTable(): string {
  const rows = GLOBAL_OPTION_MANIFEST.map(
    (option) =>
      `| ${optionLabel(option)} | ${optionValue(option)} | ${optionConflicts(option, GLOBAL_OPTION_MANIFEST)} | ${tableText(option.description)} |`,
  ).join("\n");
  return `| Option | Values | Conflicts | Description |
| --- | --- | --- | --- |
${rows}`;
}

function renderShared(definition: AgentSkillDefinition, version: string): string {
  return `${frontmatter(definition)}
# OPSI shared execution contract

Read this before using any OPSI domain skill. Generated for \`opsi\` ${version}.

## Install and discover

\`\`\`sh
npm install --global opsi
opsi --version
opsi --help
opsi <command> --help
\`\`\`

Use the installed CLI as the source of truth when its help differs from generated skill text.

## Structured output

- Prefer \`--json\` for one bounded result envelope or \`--ndjson\` for streamed records.
- Use \`--fields\` and command-specific row limits to keep agent context small.
- Read result data from stdout, diagnostics from stderr, and the exit status as the authoritative success signal.
- Inspect the structured \`error.code\` together with the exit status before choosing remediation.
- Never parse a human-readable table when structured output is available.

## Default decision sequence

1. Resolve a local path, a local:file reference, or an exact \`opsi:resource:\` reference.
2. Inspect unknown inputs, then preview a bounded sample and validate when the next operation depends on content integrity.
3. Download provider data before local-only work, then use \`--offline\` for the remaining local steps when network access is unavailable or unwanted.
4. Perform the requested bounded operation and verify important artifacts with provenance.

## Input and selector choices

- Use a local path for data already on disk and a canonical \`opsi:resource:\` reference for provider data; do not invent IDs or references.
- Use one \`--entry\` or \`--record-path\` reported by resource inspect or the relevant operation's structured error/output; resource inspect can surface ZIP entries and XML record paths.
- Without \`--sheet\`, XLSX resource preview, validate, or query emits \`SHEET_REQUIRED\` with \`context.sheets\` and a suggestion; use one listed sheet.

## Formats and outputs

- Supported tabular workflow formats include JSON, NDJSON, CSV, TSV, XLSX, Parquet, ZIP, and XML when their selected content is supported.
- Choose \`--json\` for one bounded envelope, \`--ndjson\` for records, and command-specific \`--output\` for a persisted artifact; use spreadsheet-safe output when needed.

## Global options

${globalOptionsTable()}

## Network and offline behavior

- Pass \`--offline\` when network access is prohibited. Do not imply that an uncached request can succeed offline.
- Preserve HTTPS, DNS, redirect, timeout, download-size, query, memory, thread, cell, and output bounds.
- Use \`--allow-insecure-http\` or \`--allow-private-network\` only after the user explicitly accepts that invocation's risk.
- Do not blindly retry invalid input, unsupported operations, validation failures, or integrity failures.

## Safety

${definition.safety.map((item) => `- ${item}`).join("\n")}

## Confirm mutations

- Confirm before \`cache clear\` or \`cache prune\` unless the user already requested that exact operation.
- Confirm before using \`--force\` to replace an artifact unless that exact overwrite is already authorized.
- Do not persist secret-like configuration values; use the environment for secrets.

## Exit categories

| Exit | Meaning | Response |
| --- | --- | --- |
| 0 | Success | Use the structured result. |
| 1 | Internal failure | Report diagnostics; retry only when evidence suggests a transient failure. |
| 2 | Invalid input or configuration | Correct the command or configuration before retrying. |
| 3 | Not found | Check the exact dataset, resource, or local path. |
| 4 | Provider or network failure | Respect offline mode and retry only transient failures. |
| 5 | Unsupported operation | Choose a supported provider, format, or installed native dependency. |
| 6 | Validation or integrity failure | Report issues and repair or replace the input. |
| 7 | Query failure | Correct the bounded read-only SQL or resource input. |
| 8 | Partial success | Report successes and failures separately. |

## Shell discipline

- Quote paths and user-provided values safely.
- Never print credentials, authorization headers, cookies, or secret environment values.
- Use canonical references returned by \`opsi\` when available.
`;
}

function renderRelated(definition: AgentSkillDefinition): string {
  if (definition.related.length === 0) return "";
  return `## Related skills

${definition.related.map((name) => `- [${name}](../${name}/SKILL.md)`).join("\n")}

`;
}

function renderCapabilities(definition: AgentSkillDefinition): string {
  if (definition.capabilities.length === 0) return "";
  const sections = definition.capabilities
    .map(
      ({ title, instructions }) =>
        `### ${title}\n\n${instructions.map((instruction) => `- ${instruction}`).join("\n")}`,
    )
    .join("\n\n");
  return `## Capability guide\n\n${sections}\n\n`;
}

function renderDomainSkill(definition: AgentSkillDefinition, version: string): string {
  const entries = definition.commands.map((path) => {
    const entry = COMMAND_MANIFEST.find((candidate) => candidate.path === path);
    if (entry === undefined) throw new Error(`Missing command manifest entry: ${path}`);
    return entry;
  });
  const safety =
    definition.safety.length === 0
      ? ""
      : `## Safety\n\n${definition.safety.map((item) => `- ${item}`).join("\n")}\n\n`;
  return `${frontmatter(definition)}
# ${definition.name}

> **Prerequisite:** Read [opsi-shared](../opsi-shared/SKILL.md) before executing these commands.

${definition.purpose} Generated for \`opsi\` ${version}.

## Workflow

${definition.workflows.map((workflow) => `- ${workflow}`).join("\n")}

${renderCapabilities(definition)}## Commands

${entries.map(renderCommand).join("\n")}${safety}${renderRelated(definition)}`;
}

function renderSkill(definition: AgentSkillDefinition, version: string): string {
  if (definition.name === "opsi") return renderOrchestrator(definition, version);
  if (definition.name === "opsi-shared") return renderShared(definition, version);
  return renderDomainSkill(definition, version);
}

export function renderAgentSkillFiles(version: string): ReadonlyMap<string, string> {
  const problems = validateAgentSkills();
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return new Map(
    AGENT_SKILLS.map((entry) => [entry.name, `${renderSkill(entry, version).trimEnd()}\n`]),
  );
}

export function renderAgentSkillsIndex(): string {
  const rows = AGENT_SKILLS.map(
    (entry) => `| [${entry.name}](../skills/${entry.name}/SKILL.md) | ${entry.description} |`,
  ).join("\n");
  return `# OPSI Agent Skills

Installable Agent Skills for using the OPSI CLI from compatible AI agents. Run \`opsi agent setup\` for automatic host detection and global installation of the complete repertoire. To manage a project-local installation manually, install the repertoire with a compatible Agent Skills installer, or install one focused domain skill and its \`opsi-shared\` prerequisite.

| Skill | Description |
| --- | --- |
${rows}
`;
}

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

function invalidSkillOutput(path: string, cause?: unknown): OpsiError {
  return new OpsiError({
    code: "SKILL_OUTPUT_INVALID",
    message: `The Agent Skills output must be a writable directory: ${path}`,
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Choose a directory path with --output-dir.",
    ...(cause === undefined ? {} : { cause }),
  });
}

async function ensurePlainDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw invalidSkillOutput(path);
  } catch (error) {
    if (error instanceof OpsiError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTDIR") throw invalidSkillOutput(path, error);
    throw error;
  }
}

async function writeSkillFile(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function generateAgentSkills(
  options: GenerateAgentSkillsOptions,
): Promise<GenerateAgentSkillsResult> {
  const requested = options.outputDirectory ?? "skills";
  const outputDirectory = isAbsolute(requested)
    ? resolve(requested)
    : resolve(options.cwd, requested);
  const files = renderAgentSkillFiles(options.version);

  try {
    await ensurePlainDirectory(outputDirectory);
    for (const [name, content] of files) {
      const directory = join(outputDirectory, name);
      await ensurePlainDirectory(directory);
      await writeSkillFile(join(directory, "SKILL.md"), content);
    }
  } catch (error) {
    if (error instanceof OpsiError) throw error;
    throw new OpsiError({
      code: "SKILL_GENERATION_FAILED",
      message: `Agent Skills could not be written to ${outputDirectory}.`,
      exitCode: EXIT_CODES.INTERNAL,
      suggestion: "Check directory permissions and available disk space, then try again.",
      cause: error,
    });
  }

  return {
    outputDirectory,
    count: files.size,
    skills: [...files.keys()],
  };
}
