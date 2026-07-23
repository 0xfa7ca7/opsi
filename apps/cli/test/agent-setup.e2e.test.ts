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
  const cwd = await mkdtemp(join(tmpdir(), "klopsi-agent-setup-e2e-"));
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
  it("renders a readable human dry-run without changing files", async () => {
    const value = await fixture();

    await expect(runCli(["agent", "setup", "--dry-run"], value.io)).resolves.toBe(0);

    const output = value.stdout.join("");
    expect(output).toContain("Setup preview");
    expect(output).toContain("No files will be changed");
    expect(output).toContain("Detected agents will be selected during installation");
    expect(output).toContain("14 KLOPSI skills");
    expect(output).toContain("klopsi agent setup --yes");
    expect(output).not.toMatch(/^installer\s+scope\s+selection/mu);
    expect(value.stderr).toEqual([]);
    await expect(access(join(value.cwd, ".agents"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("renders a readable human success summary with next steps", async () => {
    const value = await fixture();
    const runner: AgentInstallerRunner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: "installed", stderr: "" })),
    };

    await expect(
      runCli(["agent", "setup", "--agent", "codex", "--yes"], value.io, {
        agentInstallerRunner: runner,
      }),
    ).resolves.toBe(0);

    const output = value.stdout.join("");
    expect(output).toContain("KLOPSI agent setup complete");
    expect(output).toContain("Installed for");
    expect(output).toContain("Codex");
    expect(output).toContain("Skills installed");
    expect(output).toContain("Next steps");
    expect(output).toContain("klopsi agent setup --dry-run");
    expect(output).not.toMatch(/^installer\s+scope\s+selection/mu);
    expect(value.stderr).toEqual([]);
  });

  it("returns a structured dry-run without invoking or resolving the installer", async () => {
    const value = await fixture();

    await expect(runCli(["agent", "setup", "--dry-run", "--json"], value.io)).resolves.toBe(0);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: {
        installer: "skills@1.5.19",
        scope: "global",
        selection: "detected",
        skills: expect.arrayContaining(["klopsi", "klopsi-analysis", "klopsi-shared"]),
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
        expect(await readFile(join(sourceDirectory, "klopsi", "SKILL.md"), "utf8")).toContain(
          "name: klopsi",
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

    expect(value.stderr.join("")).toContain("KLOPSI agent setup");
    expect(value.stderr.join("")).toContain("Detected agents");
    expect(value.stderr.join("")).toContain("Codex");
    expect(value.stderr.join("")).toContain("Claude Code");
    expect(value.stderr.join("")).toContain("14 KLOPSI skills");
    expect(confirm).toHaveBeenCalledWith("Install KLOPSI skills for these agents?");
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

  it("styles readable errors only on color-enabled interactive stderr", async () => {
    const value = await fixture();
    const interactiveErrorIo: CliIo = {
      ...value.io,
      env: {},
      stderr: { isTTY: true, write: value.io.stderr.write },
    };

    await expect(
      runCli(["agent", "setup", "--agent", "not-an-agent"], interactiveErrorIo),
    ).resolves.toBe(2);

    expect(value.stderr.join("")).toContain("AGENT_SETUP_OPTIONS_INVALID");
    expect(value.stderr.join("")).toContain("Suggestion:");
    expect(value.stderr.join("")).toContain("\u001b[");

    value.stderr.splice(0);
    await expect(
      runCli(["agent", "setup", "--agent", "not-an-agent"], {
        ...interactiveErrorIo,
        env: { NO_COLOR: "1" },
      }),
    ).resolves.toBe(2);
    expect(value.stderr.join("")).toContain("AGENT_SETUP_OPTIONS_INVALID");
    expect(value.stderr.join("")).not.toContain("\u001b[");
  });

  it("documents public setup options without exposing the internal copy mode", async () => {
    const value = await fixture();

    await expect(runCli(["agent", "setup", "--help"], value.io)).resolves.toBe(0);

    for (const option of ["--agent", "--all", "--yes", "--dry-run"]) {
      expect(value.stdout.join("")).toContain(option);
    }
    expect(value.stdout.join("")).not.toContain("--copy");
  });
});
