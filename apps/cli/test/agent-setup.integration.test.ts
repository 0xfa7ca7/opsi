import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillsAgentInstallerRunner } from "../src/agent-installer-runner.js";
import {
  setupAgents,
  type AgentInstallerRunRequest,
  type AgentInstallerRunResult,
  type AgentInstallerRunner,
} from "../src/agent-setup.js";
import type { AgentHostRegistry } from "../src/agent-hosts.js";

const temporaryDirectories: string[] = [];
const registry: AgentHostRegistry = {
  supportedAgentIds: ["universal", "codex"],
  detect: async () => [],
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "klopsi-real-agent-setup-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("real pinned agent installer integration", () => {
  it("installs all generated skills locally without prompts or remote recommendations", async () => {
    const root = await fixture();
    const home = join(root, "home");
    const cwd = join(root, "workspace");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    const realRunner = new SkillsAgentInstallerRunner();
    let installerRequest: AgentInstallerRunRequest | undefined;
    let installerResult: AgentInstallerRunResult | undefined;
    const runner: AgentInstallerRunner = {
      run: async (request) => {
        installerRequest = request;
        installerResult = await realRunner.run(request);
        return installerResult;
      },
    };

    await expect(
      setupAgents({
        cwd,
        home,
        env: { ...process.env, HOME: home, NO_COLOR: "1" },
        version: "1.2.3",
        request: { agents: ["universal"] },
        runner,
        registry,
        interactive: true,
      }),
    ).resolves.toMatchObject({ agents: ["universal"], dryRun: false });

    expect(installerRequest).toMatchObject({ interactive: false });
    expect(installerRequest?.arguments).toEqual(
      expect.arrayContaining(["--agent", "universal", "--copy", "--yes"]),
    );
    expect(`${installerResult?.stdout}\n${installerResult?.stderr}`).not.toContain("find-skills");
    for (const skill of ["klopsi", "klopsi-shared", "klopsi-analysis", "klopsi-diagnostics"]) {
      expect(await readFile(join(home, ".agents", "skills", skill, "SKILL.md"), "utf8")).toContain(
        `name: ${skill}`,
      );
    }
    expect(
      await readFile(
        join(home, ".agents", "skills", "klopsi-shared", "scripts", "verify-dashboard.mjs"),
        "utf8",
      ),
    ).toContain("const MAX_HTML_BYTES = 15 * 1024 * 1024;");
    expect(
      await readFile(
        join(home, ".agents", "skills", "klopsi-static-dashboard", "assets", "static-board.html"),
        "utf8",
      ),
    ).toContain("{{PRESENTATION_MANIFEST_JSON}}");
    expect(
      await readFile(
        join(
          home,
          ".agents",
          "skills",
          "klopsi-interactive-dashboard",
          "assets",
          "interactive-dashboard.html",
        ),
        "utf8",
      ),
    ).toContain("data-klopsi-filter-region");
    await expect(access(join(cwd, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(cwd, "skills-lock.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recognizes a real zero-exit installer target failure as partial success", async () => {
    const root = await fixture();
    const blockedHome = join(root, "blocked-home");
    const cwd = join(root, "workspace");
    await writeFile(blockedHome, "not a directory");
    await mkdir(cwd, { recursive: true });

    await expect(
      setupAgents({
        cwd,
        home: blockedHome,
        env: { ...process.env, HOME: blockedHome, NO_COLOR: "1" },
        version: "1.2.3",
        request: { agents: ["codex"] },
        runner: new SkillsAgentInstallerRunner(),
        registry,
        interactive: false,
      }),
    ).rejects.toMatchObject({ code: "AGENT_SETUP_PARTIAL", exitCode: 8 });
  });
});
