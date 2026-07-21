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
  "klopsi",
  "klopsi-shared",
  "klopsi-catalogue",
  "klopsi-resources",
  "klopsi-download",
  "klopsi-validation",
  "klopsi-analysis",
  "klopsi-services",
  "klopsi-provenance",
  "klopsi-local-state",
  "klopsi-diagnostics",
] as const;

const EXPECTED_DATA_CAPABILITY_IDS = {
  "klopsi-catalogue": ["catalogue-mode", "search-refinement", "dataset-followup"],
  "klopsi-resources": ["input-resolution", "access-selection", "structured-selectors"],
  "klopsi-download": ["target-resolution", "destination-strategy", "partial-results"],
  "klopsi-validation": ["validation-mode", "structured-selectors", "failure-recovery"],
  "klopsi-analysis": ["supported-inputs", "bounded-query", "query-export", "safe-conversion"],
  "klopsi-provenance": ["record-inspection", "integrity-verification"],
} as const;

const EXPECTED_LOCAL_STATE_CAPABILITY_IDS = {
  "klopsi-local-state": ["cache-tiers", "cache-mutations", "configuration"],
  "klopsi-diagnostics": [
    "environment-diagnostics",
    "shell-integration",
    "skill-generation",
    "agent-refresh",
  ],
} as const;

const EXPECTED_WFS_CAPABILITY_IDS = [
  "wfs-sequence",
  "feature-selection",
  "spatial-filtering",
  "bounded-export",
] as const;

const REQUIRED_GUIDANCE = {
  klopsi: [
    "## End-to-end workflows",
    "Acquire and analyze data",
    "Inspect and export WFS data",
    "Refresh an agent installation",
  ],
  "klopsi-shared": [
    "## Default decision sequence",
    "local path",
    "klopsi:resource:",
    "--entry",
    "--record-path",
    "--sheet",
    "JSON, NDJSON, CSV, TSV, XLSX, Parquet",
    "offline",
  ],
  "klopsi-catalogue": [
    "snapshot",
    "--refresh",
    "--live",
    "--all",
    "dataset resources",
    "dataset schema",
  ],
  "klopsi-resources": [
    "resource inspect",
    "resource preview",
    "--entry",
    "--record-path",
    "--sheet",
    "WFS",
  ],
  "klopsi-download": [
    "--dataset",
    "--resource",
    "one resource",
    "batch",
    "Partial success",
    "provenance verify",
  ],
  "klopsi-validation": ["--metadata", "--entry", "--record-path", "--sheet", "exit 6"],
  "klopsi-analysis": [
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
  "klopsi-provenance": ["provenance show", "provenance verify", "digest mismatch", "Do not mutate"],
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
  skill("klopsi"),
  skill("klopsi-shared"),
  skill("klopsi-catalogue", ["search"]),
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

  it("assigns the ordered local-state and diagnostics capability guides", () => {
    for (const [name, expectedIds] of Object.entries(EXPECTED_LOCAL_STATE_CAPABILITY_IDS)) {
      const definition = AGENT_SKILLS.find((entry) => entry.name === name);
      expect(definition, name).toBeDefined();
      expect(
        definition?.capabilities.map((capability) => capability.id),
        name,
      ).toEqual(expectedIds);
    }
  });

  it("reports duplicate and invalid skill names", () => {
    expect(
      validateAgentSkills([...minimalSkills(), skill("klopsi")], [command("search")]),
    ).toContain('Duplicate skill name "klopsi".');
    expect(
      validateAgentSkills(
        [skill("klopsi"), skill("klopsi-shared"), skill("KLOPSI Bad", ["search"])],
        [command("search")],
      ),
    ).toContain('Invalid skill name "KLOPSI Bad".');
  });

  it("reports missing required and commandless domain skills", () => {
    expect(validateAgentSkills([skill("klopsi-catalogue")], [])).toEqual(
      expect.arrayContaining([
        'Missing required skill "klopsi".',
        'Missing required skill "klopsi-shared".',
        'Domain skill "klopsi-catalogue" must own at least one command.',
      ]),
    );
  });

  it("reports unknown, missing, and multiply owned command paths", () => {
    expect(
      validateAgentSkills(
        [skill("klopsi"), skill("klopsi-shared"), skill("klopsi-catalogue", ["missing"])],
        [command("search")],
      ),
    ).toEqual(
      expect.arrayContaining([
        'Unknown command path "missing" owned by "klopsi-catalogue".',
        'Command path "search" is not owned by a domain skill.',
      ]),
    );

    expect(
      validateAgentSkills(
        [...minimalSkills(), skill("klopsi-resources", ["search"])],
        [command("search")],
      ),
    ).toContain(
      'Command path "search" is owned by multiple skills: klopsi-catalogue, klopsi-resources.',
    );
  });

  it("reports relationships that cannot be loaded", () => {
    const configured = minimalSkills().map((entry) =>
      entry.name === "klopsi-catalogue" ? { ...entry, related: ["klopsi-missing"] } : entry,
    );

    expect(validateAgentSkills(configured, [command("search")])).toContain(
      'Unknown related skill "klopsi-missing" referenced by "klopsi-catalogue".',
    );
  });

  it("keeps reserved skills commandless and rejects repeated ownership entries", () => {
    expect(
      validateAgentSkills(
        [skill("klopsi", ["search"]), skill("klopsi-shared")],
        [command("search")],
      ),
    ).toContain('Reserved skill "klopsi" must not own commands.');
    expect(
      validateAgentSkills(
        [skill("klopsi"), skill("klopsi-shared"), skill("klopsi-catalogue", ["search", "search"])],
        [command("search")],
      ),
    ).toContain('Command path "search" is listed more than once by "klopsi-catalogue".');
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
          skill("klopsi"),
          skill("klopsi-shared"),
          skillWithCapabilities("klopsi-catalogue", invalidCapabilities, ["search"]),
        ],
        [command("search")],
      ),
    ).toEqual(
      expect.arrayContaining([
        'Invalid capability ID "Bad ID" in "klopsi-catalogue".',
        'Capability "blank-title" in "klopsi-catalogue" must have a non-blank title.',
        'Capability "blank-instruction" in "klopsi-catalogue" must have non-blank instructions.',
        'Capability "empty-instructions" in "klopsi-catalogue" must have non-blank instructions.',
      ]),
    );
  });

  it("reports duplicate capability IDs within a skill", () => {
    expect(
      validateAgentSkills(
        [
          skill("klopsi"),
          skill("klopsi-shared"),
          skillWithCapabilities(
            "klopsi-catalogue",
            [
              { id: "search-refinement", title: "Search", instructions: ["Refine"] },
              { id: "search-refinement", title: "Search again", instructions: ["Refine again"] },
            ],
            ["search"],
          ),
        ],
        [command("search")],
      ),
    ).toContain(
      'Capability ID "search-refinement" is listed more than once by "klopsi-catalogue".',
    );
  });
});

describe("agent skill rendering", () => {
  it("renders one deterministic file per skill and an index", () => {
    const first = renderAgentSkillFiles("1.2.3");
    const second = renderAgentSkillFiles("1.2.3");

    expect([...first.keys()]).toEqual(EXPECTED_SKILLS);
    expect([...second]).toEqual([...first]);
    expect(first.get("klopsi")).toContain("name: klopsi");
    expect(renderAgentSkillsIndex()).toContain("# KLOPSI Agent Skills");
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
    const content = renderAgentSkillFiles("1.2.3").get("klopsi") ?? "";

    expect(content).toContain("## Route requests");
    expect(content).toContain("smallest relevant skill");
    expect(content).toContain("Do not pass `/klopsi`, `@klopsi`, or `$klopsi` to the shell");
    for (const skillName of EXPECTED_SKILLS.slice(2)) {
      expect(content).toContain(`../${skillName}/SKILL.md`);
    }
    expect(content).toContain("Generate installable Agent Skills");
    expect(content).not.toContain("### `search`");
  });

  it("renders the shared execution and safety contract", () => {
    const content = renderAgentSkillFiles("1.2.3").get("klopsi-shared") ?? "";

    for (const expected of [
      "npm install --global klopsi",
      "klopsi --help",
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

  it("guides batch downloads to an explicit existing destination directory", () => {
    const content = renderAgentSkillFiles("1.2.3").get("klopsi-download") ?? "";
    const download = COMMAND_MANIFEST.find((entry) => entry.path === "download");

    expect(content).toContain(
      "For a batch, `--destination` or `--output` must name an existing directory; a file destination is valid for one resource only.",
    );
    expect(
      download?.options.find((option) => option.flags.includes("--destination"))?.description,
    ).toBe("destination path (a file for one resource, or an existing directory for a batch)");
  });

  it("renders accurate refresh planning and structured-selector guidance", () => {
    const files = renderAgentSkillFiles("1.2.3");
    const orchestrator = files.get("klopsi") ?? "";
    const resources = files.get("klopsi-resources") ?? "";
    const shared = files.get("klopsi-shared") ?? "";
    const validation = files.get("klopsi-validation") ?? "";

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
    const definition = AGENT_SKILLS.find((entry) => entry.name === "klopsi-services");
    const content = renderAgentSkillFiles("1.2.3").get("klopsi-services") ?? "";

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
      "canonical `klopsi:resource:` reference",
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
    const shared = files.get("klopsi-shared") ?? "";
    const catalogue = files.get("klopsi-catalogue") ?? "";

    expect(shared).toContain("`--ndjson`, `--csv`, `--tsv`, `--output-format`");
    expect(shared).not.toContain("`outputFormat`");
    expect(catalogue).toContain("`--limit`");
    expect(catalogue).not.toContain("| `limit` |");
  });

  it("routes skill generation through diagnostics metadata before loading the body", () => {
    const content = renderAgentSkillFiles("1.2.3").get("klopsi-diagnostics") ?? "";
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? "";

    expect(frontmatter).toContain("agent setup");
    expect(content).toContain("Generate installable Agent Skills");
    expect(content).toContain("### `agent setup`");
    expect(content).toContain("klopsi agent setup [options]");
    for (const option of ["--agent <ids...>", "--all", "--yes", "--dry-run"]) {
      expect(content).toContain(option);
    }
    expect(content).not.toContain("--copy");
    expect(content).toContain(
      "Setup copies generated skills before removing its temporary source, so completed installations remain durable.",
    );
  });

  it("renders cautious local-state maintenance and agent refresh guidance", () => {
    const files = renderAgentSkillFiles("1.2.3");
    const localState = files.get("klopsi-local-state") ?? "";
    const diagnostics = files.get("klopsi-diagnostics") ?? "";

    for (const guidance of [
      "catalogue snapshot and cached raw objects",
      "rebuildable derived DuckDB stages",
      "`cache info`, `cache list`, and `cache verify` before `cache prune` or `cache clear`",
      "explicit authorization",
      "Keep secrets out of configuration",
    ])
      expect(localState).toContain(guidance);

    for (const guidance of [
      "`klopsi doctor --offline --json`",
      "`klopsi providers list --offline --json`",
      "`klopsi agent setup --agent codex --dry-run --json`",
      "`klopsi agent setup --agent codex --yes --json`",
      "`klopsi generate-skills --output-dir ./generated-skills --json`",
      "does not install it",
      "installs or refreshes the complete repertoire",
      "Detected hosts are used only for a non-dry-run setup without `--agent` or `--all`",
      "`--agent` selects explicit hosts",
      "`--all` selects every supported host",
      "`--dry-run` reports the planned selection and repertoire without installing or detecting hosts",
      "`--yes` accepts detected hosts for unattended setup",
      "empty detection result",
      "durable copies",
      "Rerun `klopsi agent setup` to refresh a stale repertoire",
      "`agents` contains the requested host",
      "`skills` contains the complete repertoire",
      "Do not infer an installed host path",
      "`generate-skills` does not install or refresh Codex",
    ])
      expect(diagnostics).toContain(guidance);
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
      expect(content).toContain("../klopsi-shared/SKILL.md");
      for (const path of definition.commands) {
        const entry = COMMAND_MANIFEST.find((candidate) => candidate.path === path);
        expect(entry, path).toBeDefined();
        if (entry === undefined) continue;
        expect(content).toContain(`### \`${entry.path}\``);
        expect(content).toContain(entry.description);
        expect(content).toContain(`klopsi ${entry.path}`);
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
