import { COMMAND_MANIFEST, type CommandManifestEntry } from "./command-manifest.js";

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
      "Inspect OPSI providers, diagnose an installation, or generate shell completion. Use for setup, troubleshooting, capability discovery, and CLI integration.",
    commands: ["providers list", "doctor", "completion"],
    purpose: "Diagnose the CLI environment and expose supported providers and shell integration.",
    workflows: ["Run offline diagnostics first when network access is unavailable or unwanted."],
    safety: ["Do not turn a diagnostic check into a network request when offline was requested."],
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
    if (entry.name !== "opsi" && entry.name !== "opsi-shared" && entry.commands.length === 0) {
      problems.push(`Domain skill "${entry.name}" must own at least one command.`);
    }
    for (const path of entry.commands) {
      if (!commandPaths.has(path)) {
        problems.push(`Unknown command path "${path}" owned by "${entry.name}".`);
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

function renderInitialSkill(definition: AgentSkillDefinition, version: string): string {
  const commandList = definition.commands.map((path) => `- \`opsi ${path}\``).join("\n");
  return `---
name: ${definition.name}
description: ${JSON.stringify(definition.description)}
---

# ${definition.name}

${definition.purpose}

Version: ${version}
${commandList.length === 0 ? "" : `\n## Commands\n\n${commandList}\n`}`;
}

export function renderAgentSkillFiles(version: string): ReadonlyMap<string, string> {
  const problems = validateAgentSkills();
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return new Map(AGENT_SKILLS.map((entry) => [entry.name, renderInitialSkill(entry, version)]));
}

export function renderAgentSkillsIndex(): string {
  const rows = AGENT_SKILLS.map(
    (entry) => `| [${entry.name}](../skills/${entry.name}/SKILL.md) | ${entry.description} |`,
  ).join("\n");
  return `# OPSI Agent Skills

Installable skills for using the OPSI CLI from compatible AI agents.

| Skill | Description |
| --- | --- |
${rows}
`;
}
