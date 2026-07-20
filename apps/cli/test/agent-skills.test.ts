import { describe, expect, it } from "vitest";
import {
  AGENT_SKILLS,
  renderAgentSkillFiles,
  renderAgentSkillsIndex,
  validateAgentSkills,
  type AgentSkillDefinition,
} from "../src/agent-skills.js";
import type { CommandManifestEntry } from "../src/command-manifest.js";

const EXPECTED_SKILLS = [
  "opsi",
  "opsi-shared",
  "opsi-catalogue",
  "opsi-resources",
  "opsi-download",
  "opsi-validation",
  "opsi-analysis",
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
});
