import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_SKILLS,
  renderAgentSkillFiles,
  renderAgentSkillsIndex,
  type AgentSkillCapabilityGuide,
  validateAgentSkills,
  type AgentSkillDefinition,
} from "../src/agent-skills.js";
import {
  COMMAND_MANIFEST,
  GLOBAL_OPTION_MANIFEST,
  type CommandOptionManifest,
  type CommandManifestEntry,
} from "../src/command-manifest.js";
import { VERSION } from "../src/main.js";

const EXPECTED_SKILLS = [
  "opsi",
  "opsi-shared",
  "opsi-catalogue",
  "opsi-resources",
  "opsi-download",
  "opsi-validation",
  "opsi-analysis",
  "opsi-services",
  "opsi-provenance",
  "opsi-local-state",
  "opsi-diagnostics",
] as const;

const EXPECTED_DATA_CAPABILITY_IDS = {
  "opsi-catalogue": ["catalogue-mode", "search-refinement", "dataset-followup"],
  "opsi-resources": ["input-resolution", "access-selection", "structured-selectors"],
  "opsi-download": ["target-resolution", "destination-strategy", "partial-results"],
  "opsi-validation": ["validation-mode", "structured-selectors", "failure-recovery"],
  "opsi-analysis": ["supported-inputs", "bounded-query", "query-export", "safe-conversion"],
  "opsi-provenance": ["record-inspection", "integrity-verification"],
} as const;

const EXPECTED_WFS_CAPABILITY_IDS = [
  "wfs-sequence",
  "feature-selection",
  "spatial-filtering",
  "bounded-export",
] as const;

const REQUIRED_GUIDANCE = {
  opsi: [
    "## End-to-end workflows",
    "Acquire and analyze data",
    "Inspect and export WFS data",
    "Refresh an agent installation",
  ],
  "opsi-shared": [
    "## Default decision sequence",
    "local path",
    "opsi:resource:",
    "--entry",
    "--record-path",
    "--sheet",
    "JSON, NDJSON, CSV, TSV, XLSX, Parquet",
    "offline",
  ],
  "opsi-catalogue": [
    "snapshot",
    "--refresh",
    "--live",
    "--all",
    "dataset resources",
    "dataset schema",
  ],
  "opsi-resources": [
    "resource inspect",
    "resource preview",
    "--entry",
    "--record-path",
    "--sheet",
    "WFS",
  ],
  "opsi-download": [
    "--dataset",
    "--resource",
    "one resource",
    "batch",
    "Partial success",
    "provenance verify",
  ],
  "opsi-validation": ["--metadata", "--entry", "--record-path", "--sheet", "exit 6"],
  "opsi-analysis": [
    "CSV",
    "TSV",
    "JSON",
    "NDJSON",
    "XLSX",
    "Parquet",
    "ZIP",
    "XML",
    "SELECT",
    "WITH",
    "VALUES",
    "--output",
    "--spreadsheet-safe",
    "provenance verify",
  ],
  "opsi-provenance": ["provenance show", "provenance verify", "digest mismatch", "Do not mutate"],
} as const;

const command = (path: string): CommandManifestEntry => ({
  path,
  description: `Run ${path}`,
  arguments: [],
  options: [],
});

const skill = (name: string, commands: readonly string[] = []): AgentSkillDefinition => ({
  name,
  description: `${name} description`,
  commands,
  purpose: `${name} purpose`,
  workflows: [],
  capabilities: [],
  safety: [],
  related: [],
});

const skillWithCapabilities = (
  name: string,
  capabilities: readonly AgentSkillCapabilityGuide[],
  commands: readonly string[] = [],
): AgentSkillDefinition => ({ ...skill(name, commands), capabilities });

const minimalSkills = (): readonly AgentSkillDefinition[] => [
  skill("opsi"),
  skill("opsi-shared"),
  skill("opsi-catalogue", ["search"]),
];

const optionAttributeName = (option: CommandOptionManifest): string | undefined =>
  option.flags
    .match(/--[a-z][a-z0-9-]*/u)?.[0]
    ?.slice(2)
    .replace(/^no-/u, "")
    .replace(/-([a-z0-9])/gu, (_match, character: string) => character.toUpperCase());

const conflictFlag = (options: readonly CommandOptionManifest[], conflict: string): string =>
  options
    .find((option) => optionAttributeName(option) === conflict)
    ?.flags.match(/--[a-z][a-z0-9-]*/u)?.[0] ?? conflict;

describe("agent skill registry", () => {
  it("covers the complete approved repertoire and command manifest", () => {
    expect(AGENT_SKILLS.map((entry) => entry.name)).toEqual(EXPECTED_SKILLS);
    expect(validateAgentSkills()).toEqual([]);
  });

  it("uses concise discovery triggers for every skill description", () => {
    for (const definition of AGENT_SKILLS) {
      expect(definition.description, definition.name).toMatch(/^Use when /u);
      expect(definition.description.length, definition.name).toBeLessThanOrEqual(500);
    }
  });

  it("assigns the ordered acquisition and analysis capability guides", () => {
    for (const [name, expectedIds] of Object.entries(EXPECTED_DATA_CAPABILITY_IDS)) {
      const definition = AGENT_SKILLS.find((entry) => entry.name === name);
      expect(definition, name).toBeDefined();
      expect(
        definition?.capabilities.map((capability) => capability.id),
        name,
      ).toEqual(expectedIds);
    }
  });

  it("reports duplicate and invalid skill names", () => {
    expect(validateAgentSkills([...minimalSkills(), skill("opsi")], [command("search")])).toContain(
      'Duplicate skill name "opsi".',
    );
    expect(
      validateAgentSkills(
        [skill("opsi"), skill("opsi-shared"), skill("OPSI Bad", ["search"])],
        [command("search")],
      ),
    ).toContain('Invalid skill name "OPSI Bad".');
  });

  it("reports missing required and commandless domain skills", () => {
    expect(validateAgentSkills([skill("opsi-catalogue")], [])).toEqual(
      expect.arrayContaining([
        'Missing required skill "opsi".',
        'Missing required skill "opsi-shared".',
        'Domain skill "opsi-catalogue" must own at least one command.',
      ]),
    );
  });

  it("reports unknown, missing, and multiply owned command paths", () => {
    expect(
      validateAgentSkills(
        [skill("opsi"), skill("opsi-shared"), skill("opsi-catalogue", ["missing"])],
        [command("search")],
      ),
    ).toEqual(
      expect.arrayContaining([
        'Unknown command path "missing" owned by "opsi-catalogue".',
        'Command path "search" is not owned by a domain skill.',
      ]),
    );

    expect(
      validateAgentSkills(
        [...minimalSkills(), skill("opsi-resources", ["search"])],
        [command("search")],
      ),
    ).toContain(
      'Command path "search" is owned by multiple skills: opsi-catalogue, opsi-resources.',
    );
  });

  it("reports relationships that cannot be loaded", () => {
    const configured = minimalSkills().map((entry) =>
      entry.name === "opsi-catalogue" ? { ...entry, related: ["opsi-missing"] } : entry,
    );

    expect(validateAgentSkills(configured, [command("search")])).toContain(
      'Unknown related skill "opsi-missing" referenced by "opsi-catalogue".',
    );
  });

  it("keeps reserved skills commandless and rejects repeated ownership entries", () => {
    expect(
      validateAgentSkills([skill("opsi", ["search"]), skill("opsi-shared")], [command("search")]),
    ).toContain('Reserved skill "opsi" must not own commands.');
    expect(
      validateAgentSkills(
        [skill("opsi"), skill("opsi-shared"), skill("opsi-catalogue", ["search", "search"])],
        [command("search")],
      ),
    ).toContain('Command path "search" is listed more than once by "opsi-catalogue".');
  });

  it("reports malformed capability guides", () => {
    const invalidCapabilities = [
      { id: "Bad ID", title: "Valid title", instructions: ["Valid instruction"] },
      { id: "blank-title", title: " ", instructions: ["Valid instruction"] },
      { id: "blank-instruction", title: "Valid title", instructions: [" "] },
      { id: "empty-instructions", title: "Valid title", instructions: [] },
    ] as const;

    expect(
      validateAgentSkills(
        [
          skill("opsi"),
          skill("opsi-shared"),
          skillWithCapabilities("opsi-catalogue", invalidCapabilities, ["search"]),
        ],
        [command("search")],
      ),
    ).toEqual(
      expect.arrayContaining([
        'Invalid capability ID "Bad ID" in "opsi-catalogue".',
        'Capability "blank-title" in "opsi-catalogue" must have a non-blank title.',
        'Capability "blank-instruction" in "opsi-catalogue" must have non-blank instructions.',
        'Capability "empty-instructions" in "opsi-catalogue" must have non-blank instructions.',
      ]),
    );
  });

  it("reports duplicate capability IDs within a skill", () => {
    expect(
      validateAgentSkills(
        [
          skill("opsi"),
          skill("opsi-shared"),
          skillWithCapabilities(
            "opsi-catalogue",
            [
              { id: "search-refinement", title: "Search", instructions: ["Refine"] },
              { id: "search-refinement", title: "Search again", instructions: ["Refine again"] },
            ],
            ["search"],
          ),
        ],
        [command("search")],
      ),
    ).toContain('Capability ID "search-refinement" is listed more than once by "opsi-catalogue".');
  });
});

describe("agent skill rendering", () => {
  it("renders one deterministic file per skill and an index", () => {
    const first = renderAgentSkillFiles("1.2.3");
    const second = renderAgentSkillFiles("1.2.3");

    expect([...first.keys()]).toEqual(EXPECTED_SKILLS);
    expect([...second]).toEqual([...first]);
    expect(first.get("opsi")).toContain("name: opsi");
    expect(renderAgentSkillsIndex()).toContain("# OPSI Agent Skills");
  });

  it("renders portable frontmatter and bounded deterministic files", () => {
    const files = renderAgentSkillFiles("1.2.3");

    for (const [name, content] of files) {
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/u)?.[1]?.split("\n");
      expect(frontmatter, name).toEqual([
        `name: ${name}`,
        expect.stringMatching(/^description: "[^"]+"$/u),
      ]);
      expect(content.endsWith("\n"), name).toBe(true);
      expect(content.endsWith("\n\n"), name).toBe(false);
      expect(content.split("\n").length, name).toBeLessThan(500);
      expect(content, name).not.toMatch(/(?:TBD|TODO|API[_ -]?KEY|real token)/iu);
    }
  });

  it("renders a compact main orchestrator with intent routing", () => {
    const content = renderAgentSkillFiles("1.2.3").get("opsi") ?? "";

    expect(content).toContain("## Route requests");
    expect(content).toContain("smallest relevant skill");
    expect(content).toContain("Do not pass `/opsi`, `@opsi`, or `$opsi` to the shell");
    for (const skillName of EXPECTED_SKILLS.slice(2)) {
      expect(content).toContain(`../${skillName}/SKILL.md`);
    }
    expect(content).toContain("Generate installable Agent Skills");
    expect(content).not.toContain("### `search`");
  });

  it("renders the shared execution and safety contract", () => {
    const content = renderAgentSkillFiles("1.2.3").get("opsi-shared") ?? "";

    for (const expected of [
      "npm install --global opsi",
      "opsi --help",
      "--json",
      "--ndjson",
      "stdout",
      "stderr",
      "exit status",
      "error.code",
      "--offline",
      "--allow-insecure-http",
      "--allow-private-network",
      "--force",
      "cache clear",
      "cache prune",
      "Invalid input or configuration",
      "Partial success",
    ]) {
      expect(content).toContain(expected);
    }
    for (const option of GLOBAL_OPTION_MANIFEST) {
      expect(content).toContain(option.flags);
      expect(content).toContain(option.description);
      for (const conflict of option.conflicts ?? []) {
        expect(content).toContain(conflictFlag(GLOBAL_OPTION_MANIFEST, conflict));
      }
    }
    expect(content).toContain("Do not fall back to curl or another raw HTTP client");
  });

  it("renders the required data workflow guidance and capability guides before commands", () => {
    const files = renderAgentSkillFiles("1.2.3");

    for (const [name, requiredTokens] of Object.entries(REQUIRED_GUIDANCE)) {
      const content = files.get(name) ?? "";
      for (const token of requiredTokens) expect(content, `${name}: ${token}`).toContain(token);
    }

    for (const [name] of Object.entries(EXPECTED_DATA_CAPABILITY_IDS)) {
      const definition = AGENT_SKILLS.find((entry) => entry.name === name);
      const content = files.get(name) ?? "";
      const capabilityGuide = content.indexOf("## Capability guide");
      const commands = content.indexOf("## Commands");

      expect(capabilityGuide, name).toBeGreaterThan(-1);
      expect(commands, name).toBeGreaterThan(capabilityGuide);
      for (const capability of definition?.capabilities ?? []) {
        const title = `### ${capability.title}`;
        expect(content.indexOf(title), `${name}: ${title}`).toBeGreaterThan(capabilityGuide);
        expect(content.indexOf(title), `${name}: ${title}`).toBeLessThan(commands);
        for (const instruction of capability.instructions) {
          const bullet = `- ${instruction}`;
          expect(content.indexOf(bullet), `${name}: ${bullet}`).toBeGreaterThan(
            content.indexOf(title),
          );
          expect(content.indexOf(bullet), `${name}: ${bullet}`).toBeLessThan(commands);
        }
      }
    }
  });

  it("renders accurate refresh planning and structured-selector guidance", () => {
    const files = renderAgentSkillFiles("1.2.3");
    const orchestrator = files.get("opsi") ?? "";
    const resources = files.get("opsi-resources") ?? "";
    const shared = files.get("opsi-shared") ?? "";
    const validation = files.get("opsi-validation") ?? "";

    expect(orchestrator).not.toContain("detected targets");
    expect(orchestrator).toContain("planned selection and repertoire");

    expect(resources).toContain("resource inspect can surface ZIP entries and XML record paths");
    for (const content of [resources, shared, validation]) {
      expect(content).toContain("relevant operation's structured error/output");
      expect(content).toContain("SHEET_REQUIRED");
      expect(content).toContain("context.sheets");
      expect(content).toContain("suggestion");
    }
  });

  it("renders bounded WFS service workflows", () => {
    const definition = AGENT_SKILLS.find((entry) => entry.name === "opsi-services");
    const content = renderAgentSkillFiles("1.2.3").get("opsi-services") ?? "";

    expect(definition?.capabilities.map((capability) => capability.id)).toEqual(
      EXPECTED_WFS_CAPABILITY_IDS,
    );
    for (const command of [
      "service inspect",
      "service layers",
      "service schema",
      "service preview",
      "service count",
      "service export",
    ])
      expect(content).toContain(`### \`${command}\``);
    for (const guidance of [
      "canonical `opsi:resource:` reference",
      "`service inspect`",
      "`service layers`",
      "`service schema --layer <name>`",
      "`--property` may repeat or take a comma-separated list",
      "`--filter-eq <field=value>`",
      "booleans, numbers, or strings",
      "not schema-aware XSD coercion",
      "`--bbox <minx,miny,maxx,maxy>`",
      "`--crs <name>` must name the coordinate reference system used for the bbox",
      "`--start-index` is zero-based",
      "`--limit`",
      "`service count`",
      "CSV only",
      "`--force` after explicit overwrite authorization",
      "`provenance verify`",
      "Never send transaction requests, raw CQL, arbitrary XML filters, or direct HTTP calls.",
    ]) {
      expect(content).toContain(guidance);
    }
  });

  it("renders option conflicts as user-facing CLI flags", () => {
    const files = renderAgentSkillFiles("1.2.3");
    const shared = files.get("opsi-shared") ?? "";
    const catalogue = files.get("opsi-catalogue") ?? "";

    expect(shared).toContain("`--ndjson`, `--csv`, `--tsv`, `--output-format`");
    expect(shared).not.toContain("`outputFormat`");
    expect(catalogue).toContain("`--limit`");
    expect(catalogue).not.toContain("| `limit` |");
  });

  it("routes skill generation through diagnostics metadata before loading the body", () => {
    const content = renderAgentSkillFiles("1.2.3").get("opsi-diagnostics") ?? "";
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? "";

    expect(frontmatter).toContain("agent setup");
    expect(content).toContain("Generate installable Agent Skills");
    expect(content).toContain("### `agent setup`");
    expect(content).toContain("opsi agent setup [options]");
    for (const option of ["--agent <ids...>", "--all", "--yes", "--dry-run"]) {
      expect(content).toContain(option);
    }
    expect(content).not.toContain("--copy");
    expect(content).toContain(
      "Setup copies generated skills before removing its temporary source, so completed installations remain durable.",
    );
  });

  it("keeps the installer's copy mode out of public agent setup metadata", () => {
    const setup = COMMAND_MANIFEST.find((entry) => entry.path === "agent setup");

    expect(setup?.options.map((option) => option.flags)).toEqual([
      "--agent <ids...>",
      "--all",
      "--yes",
      "--dry-run",
    ]);
  });

  it("renders every owned command directly from manifest metadata", () => {
    const files = renderAgentSkillFiles("1.2.3");

    for (const definition of AGENT_SKILLS.slice(2)) {
      const content = files.get(definition.name) ?? "";
      expect(content).toContain("../opsi-shared/SKILL.md");
      for (const path of definition.commands) {
        const entry = COMMAND_MANIFEST.find((candidate) => candidate.path === path);
        expect(entry, path).toBeDefined();
        if (entry === undefined) continue;
        expect(content).toContain(`### \`${entry.path}\``);
        expect(content).toContain(entry.description);
        expect(content).toContain(`opsi ${entry.path}`);
        for (const argument of entry.arguments) {
          expect(content).toContain(argument.name);
          expect(content).toContain(argument.description);
          for (const choice of argument.choices ?? []) expect(content).toContain(choice);
        }
        for (const option of entry.options) {
          expect(content).toContain(option.flags);
          expect(content).toContain(option.description);
          for (const choice of option.choices ?? []) expect(content).toContain(choice);
          for (const conflict of option.conflicts ?? []) {
            expect(content).toContain(conflictFlag(entry.options, conflict));
          }
          if (option.mandatory === true) {
            expect(content).toMatch(
              new RegExp(`${option.flags.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}.*yes`, "u"),
            );
          }
        }
      }
      for (const related of definition.related) {
        expect(content).toContain(`../${related}/SKILL.md`);
      }
    }
  });

  it("renders a complete linked index", () => {
    const content = renderAgentSkillsIndex();

    for (const definition of AGENT_SKILLS) {
      expect(content).toContain(`../skills/${definition.name}/SKILL.md`);
      expect(content).toContain(definition.description);
    }
  });

  it("matches the complete checked-in skill tree and index byte for byte", async () => {
    const expected = renderAgentSkillFiles(VERSION);
    const skillRoot = resolve(process.cwd(), "skills");
    const directories = (await readdir(skillRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(directories).toEqual([...expected.keys()].sort());
    for (const [name, content] of expected) {
      expect(await readFile(resolve(skillRoot, name, "SKILL.md"), "utf8"), name).toBe(content);
    }
    expect(await readFile(resolve(process.cwd(), "docs/skills.md"), "utf8")).toBe(
      renderAgentSkillsIndex(),
    );
  });
});
