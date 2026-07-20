import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentInstallerRunner } from "../src/agent-setup.js";
import type { AgentHostRegistry } from "../src/agent-hosts.js";
import { runCli, type CliIo } from "../src/main.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  readonly cwd: string;
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
}> {
  const cwd = await mkdtemp(join(tmpdir(), "opsi-agent-setup-e2e-"));
  temporaryDirectories.push(cwd);
  const home = join(cwd, "home");
  await mkdir(home, { recursive: true });
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    cwd,
    stdout,
    stderr,
    io: {
      cwd,
      home,
      env: { NO_COLOR: "1" },
      stdin: { isTTY: false },
      stdout: { isTTY: false, write: (chunk) => void stdout.push(chunk) },
      stderr: { isTTY: false, write: (chunk) => void stderr.push(chunk) },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agent setup", () => {
  it("returns a structured dry-run without invoking or resolving the installer", async () => {
    const value = await fixture();

    await expect(runCli(["agent", "setup", "--dry-run", "--json"], value.io)).resolves.toBe(0);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: {
        installer: "skills@1.5.19",
        scope: "global",
        selection: "detected",
        skills: expect.arrayContaining(["opsi", "opsi-analysis", "opsi-shared"]),
        dryRun: true,
      },
    });
    expect(value.stderr).toEqual([]);
    await expect(access(join(value.cwd, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(value.cwd, "skills-lock.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("installs all generated skills for explicit agents without polluting structured output", async () => {
    const value = await fixture();
    let sourceDirectory = "";
    const runner: AgentInstallerRunner = {
      run: vi.fn(async (request) => {
        sourceDirectory = request.arguments[1] ?? "";
        expect(request.interactive).toBe(false);
        expect(request.arguments).toEqual([
          "add",
          sourceDirectory,
          "--global",
          "--skill",
          "*",
          "--agent",
          "codex",
          "claude-code",
          "--copy",
          "--yes",
        ]);
        expect(await readFile(join(sourceDirectory, "opsi", "SKILL.md"), "utf8")).toContain(
          "name: opsi",
        );
        return { exitCode: 0, stdout: "decorated installer output", stderr: "" };
      }),
    };

    await expect(
      runCli(["agent", "setup", "--agent", "codex", "claude-code", "--yes", "--json"], value.io, {
        agentInstallerRunner: runner,
      }),
    ).resolves.toBe(0);

    expect(runner.run).toHaveBeenCalledOnce();
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: { selection: ["codex", "claude-code"], dryRun: false },
    });
    expect(value.stdout.join("")).not.toContain("decorated installer output");
    expect(value.stderr).toEqual([]);
    await expect(access(sourceDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires an explicit non-interactive selection before mutation", async () => {
    const value = await fixture();
    const runner: AgentInstallerRunner = { run: vi.fn() };

    await expect(
      runCli(["agent", "setup", "--json"], value.io, { agentInstallerRunner: runner }),
    ).resolves.toBe(2);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "AGENT_SETUP_NONINTERACTIVE_REQUIRED", exitCode: 2 },
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("rejects conflicting selection flags before invoking the installer", async () => {
    const value = await fixture();
    const runner: AgentInstallerRunner = { run: vi.fn() };

    await expect(
      runCli(["agent", "setup", "--all", "--agent", "codex", "--json"], value.io, {
        agentInstallerRunner: runner,
      }),
    ).resolves.toBe(2);

    expect(runner.run).not.toHaveBeenCalled();
  });

  it("returns a typed setup failure from a nonzero installer result", async () => {
    const value = await fixture();
    const runner: AgentInstallerRunner = {
      run: vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "permission denied" })),
    };

    await expect(
      runCli(["agent", "setup", "--agent", "codex", "--json"], value.io, {
        agentInstallerRunner: runner,
      }),
    ).resolves.toBe(1);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: {
        code: "AGENT_SETUP_FAILED",
        context: { installerExitCode: 1, diagnostic: "permission denied" },
      },
    });
  });

  it("does not expand --yes to every profile when no host is detected", async () => {
    const value = await fixture();
    const runner: AgentInstallerRunner = { run: vi.fn() };
    const agentHostRegistry: AgentHostRegistry = {
      supportedAgentIds: ["codex", "claude-code"],
      detect: vi.fn(async () => []),
    };

    await expect(
      runCli(["agent", "setup", "--yes", "--json"], value.io, {
        agentInstallerRunner: runner,
        agentHostRegistry,
      }),
    ).resolves.toBe(2);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "AGENT_HOSTS_NOT_DETECTED", exitCode: 2 },
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("confirms multiple detected hosts itself and keeps the installer non-interactive", async () => {
    const value = await fixture();
    const confirm = vi.fn(async () => true);
    const runner: AgentInstallerRunner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: "installed", stderr: "" })),
    };
    const agentHostRegistry: AgentHostRegistry = {
      supportedAgentIds: ["codex", "claude-code"],
      detect: vi.fn(async () => ["codex", "claude-code"]),
    };

    await expect(
      runCli(
        ["agent", "setup"],
        {
          ...value.io,
          stdin: { isTTY: true },
          stdout: { isTTY: true, write: value.io.stdout.write },
          confirm,
        },
        { agentInstallerRunner: runner, agentHostRegistry },
      ),
    ).resolves.toBe(0);

    expect(confirm).toHaveBeenCalledWith(
      "Install OPSI skills for detected agents: codex, claude-code?",
    );
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        interactive: false,
        arguments: expect.arrayContaining(["--agent", "codex", "claude-code", "--yes"]),
      }),
    );
  });

  it("classifies unsupported explicit agent IDs as invalid input", async () => {
    const value = await fixture();
    const runner: AgentInstallerRunner = { run: vi.fn() };

    await expect(
      runCli(["agent", "setup", "--agent", "not-an-agent", "--json"], value.io, {
        agentInstallerRunner: runner,
      }),
    ).resolves.toBe(2);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: {
        code: "AGENT_SETUP_OPTIONS_INVALID",
        exitCode: 2,
        context: { invalidAgents: ["not-an-agent"] },
      },
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("documents every public setup option in help", async () => {
    const value = await fixture();

    await expect(runCli(["agent", "setup", "--help"], value.io)).resolves.toBe(0);

    for (const option of ["--agent", "--all", "--copy", "--yes", "--dry-run"]) {
      expect(value.stdout.join("")).toContain(option);
    }
  });
});
