import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentInstallerArguments,
  setupAgents,
  type AgentInstallerRunner,
} from "../src/agent-setup.js";
import type { AgentHostRegistry } from "../src/agent-hosts.js";

const temporaryDirectories: string[] = [];

function registry(
  options: {
    readonly supported?: readonly string[];
    readonly detected?: readonly string[];
  } = {},
): AgentHostRegistry {
  return {
    supportedAgentIds: options.supported ?? ["codex", "claude-code", "cursor"],
    detect: vi.fn(async () => options.detected ?? ["codex"]),
  };
}

async function temporaryDirectory(prefix = "klopsi-agent-setup-test-"): Promise<string> {
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
  it("passes only resolved agents to a non-prompting global install", () => {
    expect(
      buildAgentInstallerArguments("/tmp/source with spaces", ["codex", "claude-code"]),
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
});

describe("agent setup orchestration", () => {
  it("returns a mutation-free dry-run plan without creating a source or calling the runner", async () => {
    const createTemporaryDirectory = vi.fn(async () => temporaryDirectory());
    const runner: AgentInstallerRunner = { run: vi.fn() };

    await expect(
      setupAgents({
        cwd: "/workspace",
        home: "/home/user",
        env: {},
        version: "1.2.3",
        request: { dryRun: true },
        runner,
        registry: registry(),
        interactive: false,
        createTemporaryDirectory,
      }),
    ).resolves.toMatchObject({
      installer: "skills@1.5.19",
      scope: "global",
      selection: "detected",
      dryRun: true,
      skills: expect.arrayContaining(["klopsi", "klopsi-analysis", "klopsi-shared"]),
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
        expect(await readFile(join(sourceDirectory, "klopsi", "SKILL.md"), "utf8")).toContain(
          "Generated for `klopsi` 1.2.3",
        );
        expect(
          await readFile(
            join(sourceDirectory, "klopsi-shared", "scripts", "verify-dashboard.mjs"),
            "utf8",
          ),
        ).toContain("const MAX_HTML_BYTES = 15 * 1024 * 1024;");
        expect(
          await readFile(
            join(sourceDirectory, "klopsi-static-dashboard", "assets", "static-board.html"),
            "utf8",
          ),
        ).toContain("{{PRESENTATION_MANIFEST_JSON}}");
        expect(
          await readFile(
            join(
              sourceDirectory,
              "klopsi-interactive-dashboard",
              "assets",
              "interactive-dashboard.html",
            ),
            "utf8",
          ),
        ).toContain("data-klopsi-filter-region");
        return { exitCode: 0, stdout: "installed", stderr: "" };
      }),
    };

    await expect(
      setupAgents({
        cwd,
        home: join(cwd, "home"),
        env: { NO_COLOR: "1" },
        version: "1.2.3",
        request: { agents: ["codex"] },
        runner,
        registry: registry(),
        interactive: false,
      }),
    ).resolves.toMatchObject({
      installer: "skills@1.5.19",
      scope: "global",
      selection: ["codex"],
      skills: expect.arrayContaining(["klopsi", "klopsi-shared"]),
      dryRun: false,
    });
    expect(runner.run).toHaveBeenCalledOnce();
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        interactive: false,
        arguments: expect.arrayContaining(["--agent", "codex", "--copy", "--yes"]),
      }),
    );
    await expect(access(sourceDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unknown explicit agents before generating skills or invoking the installer", async () => {
    const cwd = await temporaryDirectory();
    const runner: AgentInstallerRunner = { run: vi.fn() };

    await expect(
      setupAgents({
        cwd,
        home: join(cwd, "home"),
        env: {},
        version: "1.2.3",
        request: { agents: ["unknown-agent"] },
        runner,
        registry: registry(),
        interactive: false,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_SETUP_OPTIONS_INVALID",
      exitCode: 2,
      context: { invalidAgents: ["unknown-agent"] },
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("fails safely when automatic detection finds no globally installable host", async () => {
    const runner: AgentInstallerRunner = { run: vi.fn() };

    await expect(
      setupAgents({
        cwd: "/workspace",
        home: "/isolated/home",
        env: {},
        version: "1.2.3",
        request: { yes: true },
        runner,
        registry: registry({ detected: [] }),
        interactive: false,
      }),
    ).rejects.toMatchObject({ code: "AGENT_HOSTS_NOT_DETECTED", exitCode: 2 });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("maps an installer's zero-exit partial failure report to partial success", async () => {
    const cwd = await temporaryDirectory();
    const runner: AgentInstallerRunner = {
      run: vi.fn(async () => ({
        exitCode: 0,
        stdout: "Installation complete\nFailed to install 1\npermission denied",
        stderr: "",
      })),
    };

    await expect(
      setupAgents({
        cwd,
        home: join(cwd, "home"),
        env: {},
        version: "1.2.3",
        request: { agents: ["codex"] },
        runner,
        registry: registry(),
        interactive: false,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_SETUP_PARTIAL",
      exitCode: 8,
      context: { diagnostic: expect.stringContaining("Failed to install 1") },
    });
  });

  it("preserves the primary installer error when temporary cleanup also fails", async () => {
    const cwd = await temporaryDirectory();
    const sourceDirectory = await temporaryDirectory();

    await expect(
      setupAgents({
        cwd,
        home: join(cwd, "home"),
        env: {},
        version: "1.2.3",
        request: { agents: ["codex"] },
        runner: {
          run: async () => ({ exitCode: 1, stdout: "", stderr: "installer failed" }),
        },
        registry: registry(),
        interactive: false,
        createTemporaryDirectory: async () => sourceDirectory,
        removeTemporaryDirectory: async () => {
          throw new Error("cleanup failed");
        },
      }),
    ).rejects.toMatchObject({
      code: "AGENT_SETUP_FAILED",
      context: { diagnostic: "installer failed" },
    });
  });
});
