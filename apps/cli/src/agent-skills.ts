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

export interface AgentSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly commands: readonly string[];
  readonly purpose: string;
  readonly workflows: readonly string[];
  readonly safety: readonly string[];
  readonly related: readonly string[];
}

export const AGENT_SKILLS: readonly AgentSkillDefinition[] = [
  {
    name: "opsi",
    description:
      "Route Slovenian public-data requests to the smallest relevant OPSI CLI skill. Use for discovering, inspecting, downloading, validating, querying, converting, or managing data from the Slovenian OPSI portal.",
    commands: [],
    purpose:
      "Classify the request, load shared guidance, and select the smallest relevant domain skill or ordered set of skills.",
    workflows: [
      "Discover data, inspect its metadata, then choose a resource.",
      "Download or preview selected data before validating, querying, or converting it.",
      "Use provenance to verify any artifact produced by a download, conversion, or query export.",
    ],
    safety: [],
    related: [
      "opsi-catalogue",
      "opsi-resources",
      "opsi-download",
      "opsi-validation",
      "opsi-analysis",
      "opsi-provenance",
      "opsi-local-state",
      "opsi-diagnostics",
    ],
  },
  {
    name: "opsi-shared",
    description:
      "Apply shared OPSI CLI installation, structured-output, offline, safety, and error-handling rules. Load with every OPSI domain skill.",
    commands: [],
    purpose: "Provide the common execution contract every OPSI domain skill must follow.",
    workflows: [],
    safety: [
      "Prefer structured output and bounded result sets.",
      "Honor offline requests and existing network safeguards.",
      "Confirm destructive or overwrite operations unless already explicitly authorized.",
    ],
    related: [],
  },
  {
    name: "opsi-catalogue",
    description:
      "Discover and inspect Slovenian OPSI datasets. Use for catalogue search, dataset listing, dataset metadata, embedded resources, schema inference, or opening a public dataset page.",
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
    safety: ["Use explicit live catalogue traversal only when the user needs it."],
    related: ["opsi-resources", "opsi-download", "opsi-validation"],
  },
  {
    name: "opsi-resources",
    description:
      "Inspect OPSI resource metadata, secure remote headers, or bounded local and provider data previews. Use when evaluating a dataset resource before download or analysis.",
    commands: ["resource show", "resource headers", "resource preview"],
    purpose: "Inspect a resource safely without committing to a full data workflow.",
    workflows: [
      "Inspect metadata and headers before downloading an unfamiliar resource.",
      "Preview a bounded number of rows before validation or analysis.",
    ],
    safety: ["Keep previews bounded and do not weaken network controls implicitly."],
    related: ["opsi-catalogue", "opsi-download", "opsi-validation", "opsi-analysis"],
  },
  {
    name: "opsi-download",
    description:
      "Download Slovenian OPSI dataset or resource content securely. Use for destination selection, batch downloads, overwrite handling, and downloaded artifact provenance.",
    commands: ["download"],
    purpose: "Download selected provider resources through the CLI's bounded secure downloader.",
    workflows: ["Resolve a canonical resource or dataset reference, then download it."],
    safety: ["Confirm before replacing an existing artifact with --force."],
    related: ["opsi-catalogue", "opsi-resources", "opsi-validation", "opsi-provenance"],
  },
  {
    name: "opsi-validation",
    description:
      "Validate local or provider tabular data and OPSI dataset or resource metadata. Use to find integrity issues, warnings, and remediation recommendations.",
    commands: ["validate"],
    purpose: "Validate data content or normalized metadata and explain actionable issues.",
    workflows: ["Validate downloaded content before analysis or conversion."],
    safety: ["Treat integrity failures as non-retryable until the input changes."],
    related: ["opsi-resources", "opsi-download", "opsi-analysis"],
  },
  {
    name: "opsi-analysis",
    description:
      "Query or convert bounded tabular data with OPSI CLI. Use for read-only SQL analysis, CSV/TSV/JSON/NDJSON/XLSX/Parquet conversion, and exported query results.",
    commands: ["query", "convert"],
    purpose: "Analyze tabular inputs with bounded read-only SQL or convert supported formats.",
    workflows: [
      "Preview and validate input before running a bounded query.",
      "Convert an input and then verify the generated provenance record.",
    ],
    safety: [
      "Keep SQL read-only and bounded.",
      "Confirm before replacing an existing output with --force.",
    ],
    related: ["opsi-resources", "opsi-validation", "opsi-provenance"],
  },
  {
    name: "opsi-provenance",
    description:
      "Inspect or verify OPSI artifact provenance. Use to explain an artifact's source and transformations or detect integrity mismatches.",
    commands: ["provenance show", "provenance verify"],
    purpose: "Inspect recorded lineage and verify an artifact against its digest.",
    workflows: ["Verify every important downloaded, converted, or query-exported artifact."],
    safety: ["Do not dismiss a digest mismatch or mutate evidence before reporting it."],
    related: ["opsi-download", "opsi-analysis"],
  },
  {
    name: "opsi-local-state",
    description:
      "Inspect or update OPSI CLI cache and non-secret configuration. Use for cache diagnostics, verification, pruning, clearing, or configuration values and paths.",
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
    safety: ["Confirm cache clear or prune unless the exact mutation is already authorized."],
    related: ["opsi-diagnostics"],
  },
  {
    name: "opsi-diagnostics",
    description:
      "Inspect OPSI providers, diagnose an installation, generate shell completion, or generate installable Agent Skills. Use for setup, troubleshooting, capability discovery, CLI integration, and agent setup.",
    commands: ["providers list", "doctor", "completion", "generate-skills", "agent setup"],
    purpose:
      "Generate installable Agent Skills, diagnose the CLI environment, and expose providers and shell integration.",
    workflows: [
      "Use `opsi agent setup` to detect installed agent hosts and install the complete OPSI skill repertoire globally.",
      "Use `--dry-run` to inspect the installation plan, or `--agent` when the target host IDs are already known.",
      "Run offline diagnostics first when network access is unavailable or unwanted.",
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

## Common workflows

${definition.workflows.map((workflow) => `- ${workflow}`).join("\n")}

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

## Global options

${globalOptionsTable()}

## Network and offline behavior

- Pass \`--offline\` when network access is prohibited. Do not imply that an uncached request can succeed offline.
- Preserve HTTPS, DNS, redirect, timeout, download-size, query, memory, thread, cell, and output bounds.
- Use \`--allow-insecure-http\` or \`--allow-private-network\` only after the user explicitly accepts that invocation's risk.
- Do not blindly retry invalid input, unsupported operations, validation failures, or integrity failures.

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

## Commands

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
