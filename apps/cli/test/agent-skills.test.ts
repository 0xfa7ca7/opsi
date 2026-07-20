import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_SKILLS,
  renderAgentSkillFiles,
  renderAgentSkillsIndex,
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
  safety: [],
  related: [],
});

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

  it("renders bounded WFS service workflows", () => {
    const content = renderAgentSkillFiles("1.2.3").get("opsi-services") ?? "";
    for (const command of ["service inspect", "service layers", "service schema", "service preview", "service count", "service export"]) expect(content).toContain(`### \`${command}\``);
    expect(content).toContain("Never send transaction requests");
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

    expect(frontmatter).toContain("generate installable Agent Skills");
    expect(content).toContain("Generate installable Agent Skills");
    expect(content).toContain("### `agent setup`");
    expect(content).toContain("opsi agent setup [options]");
    for (const option of ["--agent <ids...>", "--all", "--copy", "--yes", "--dry-run"]) {
      expect(content).toContain(option);
    }
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
