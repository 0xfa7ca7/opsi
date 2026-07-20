import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentInstallerArguments,
  setupAgents,
  type AgentInstallerRunner,
} from "../src/agent-setup.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix = "opsi-agent-setup-test-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agent setup argument construction", () => {
  it("builds a global all-skills install that delegates agent detection", () => {
    expect(buildAgentInstallerArguments("/tmp/source", {})).toEqual([
      "add",
      "/tmp/source",
      "--global",
      "--skill",
      "*",
    ]);
  });

  it("passes explicit agents and install-mode options as literal argv elements", () => {
    expect(
      buildAgentInstallerArguments("/tmp/source with spaces", {
        agents: ["codex", "claude-code"],
        copy: true,
        yes: true,
      }),
    ).toEqual([
      "add",
      "/tmp/source with spaces",
      "--global",
      "--skill",
      "*",
      "--agent",
      "codex",
      "claude-code",
      "--copy",
      "--yes",
    ]);
  });

  it("maps all-agent setup to the installer's explicit all mode", () => {
    expect(buildAgentInstallerArguments("/tmp/source", { all: true })).toEqual([
      "add",
      "/tmp/source",
      "--global",
      "--skill",
      "*",
      "--all",
    ]);
  });

  it("rejects conflicting, empty, and duplicate agent selections", () => {
    for (const request of [
      { agents: ["codex"], all: true },
      { agents: [] },
      { agents: [""] },
      { agents: ["codex", "codex"] },
    ]) {
      expect(() => buildAgentInstallerArguments("/tmp/source", request)).toThrowError(
        expect.objectContaining({ code: "AGENT_SETUP_OPTIONS_INVALID", exitCode: 2 }),
      );
    }
  });
});

describe("agent setup orchestration", () => {
  it("returns a mutation-free dry-run plan without creating a source or calling the runner", async () => {
    const createTemporaryDirectory = vi.fn(async () => temporaryDirectory());
    const runner: AgentInstallerRunner = { run: vi.fn() };

    await expect(
      setupAgents({
        cwd: "/workspace",
        env: {},
        version: "1.2.3",
        request: { dryRun: true },
        runner,
        interactive: false,
        createTemporaryDirectory,
      }),
    ).resolves.toMatchObject({
      installer: "skills@1.5.19",
      scope: "global",
      selection: "detected",
      dryRun: true,
      skills: expect.arrayContaining(["opsi", "opsi-analysis", "opsi-shared"]),
    });
    expect(createTemporaryDirectory).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("generates the installed version, delegates setup, and removes the temporary source", async () => {
    const cwd = await temporaryDirectory();
    let sourceDirectory = "";
    const runner: AgentInstallerRunner = {
      run: vi.fn(async (request) => {
        sourceDirectory = request.arguments[1] ?? "";
        expect(request).toMatchObject({ cwd, env: { NO_COLOR: "1" }, interactive: false });
        expect(await readFile(join(sourceDirectory, "opsi", "SKILL.md"), "utf8")).toContain(
          "Generated for `opsi` 1.2.3",
        );
        return { exitCode: 0, stdout: "installed", stderr: "" };
      }),
    };

    await expect(
      setupAgents({
        cwd,
        env: { NO_COLOR: "1" },
        version: "1.2.3",
        request: { agents: ["codex"] },
        runner,
        interactive: false,
      }),
    ).resolves.toMatchObject({
      installer: "skills@1.5.19",
      scope: "global",
      selection: ["codex"],
      skills: expect.arrayContaining(["opsi", "opsi-shared"]),
      dryRun: false,
    });
    expect(runner.run).toHaveBeenCalledOnce();
    await expect(access(sourceDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes the temporary source and preserves diagnostics when installation fails", async () => {
    const cwd = await temporaryDirectory();
    let sourceDirectory = "";
    const runner: AgentInstallerRunner = {
      run: vi.fn(async (request) => {
        sourceDirectory = request.arguments[1] ?? "";
        return { exitCode: 1, stdout: "", stderr: "Invalid agents: unknown-agent" };
      }),
    };

    await expect(
      setupAgents({
        cwd,
        env: {},
        version: "1.2.3",
        request: { agents: ["unknown-agent"] },
        runner,
        interactive: false,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_SETUP_FAILED",
      exitCode: 1,
      context: { installerExitCode: 1, diagnostic: "Invalid agents: unknown-agent" },
    });
    await expect(access(sourceDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
