import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  SkillsAgentInstallerRunner,
  type SpawnAgentInstallerProcess,
} from "../src/agent-installer-runner.js";

interface FakeChild extends ChildProcess {
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
}

function fakeChild(options: {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error;
  readonly interactive?: boolean;
}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, {
    stdout: options.interactive === true ? null : new PassThrough(),
    stderr: options.interactive === true ? null : new PassThrough(),
  });
  queueMicrotask(() => {
    if (options.error !== undefined) {
      child.emit("error", options.error);
      return;
    }
    child.stdout?.end(options.stdout ?? "");
    child.stderr?.end(options.stderr ?? "");
    child.emit("close", options.code ?? 0, null);
  });
  return child;
}

describe("pinned skills installer runner", () => {
  it("executes the resolved installer with Node and literal argv without a shell", async () => {
    const spawnProcess = vi.fn<SpawnAgentInstallerProcess>(() =>
      fakeChild({ code: 0, stdout: "installed\n" }),
    );
    const runner = new SkillsAgentInstallerRunner({
      resolveInstaller: () => "/installed/skills/bin/cli.mjs",
      spawnProcess,
    });

    await expect(
      runner.run({
        arguments: ["add", "/tmp/source with spaces", "--agent", "codex"],
        cwd: "/workspace",
        env: { NO_COLOR: "1" },
        interactive: false,
      }),
    ).resolves.toEqual({ exitCode: 0, stdout: "installed\n", stderr: "" });
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      ["/installed/skills/bin/cli.mjs", "add", "/tmp/source with spaces", "--agent", "codex"],
      {
        cwd: "/workspace",
        env: { NO_COLOR: "1" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      } satisfies SpawnOptions,
    );
  });

  it("inherits terminal streams in interactive mode", async () => {
    const spawnProcess = vi.fn<SpawnAgentInstallerProcess>(() => fakeChild({ interactive: true }));
    const runner = new SkillsAgentInstallerRunner({
      resolveInstaller: () => "/installed/skills/bin/cli.mjs",
      spawnProcess,
    });

    await expect(
      runner.run({
        arguments: ["add", "/tmp/source"],
        cwd: "/workspace",
        env: {},
        interactive: true,
      }),
    ).resolves.toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      ["/installed/skills/bin/cli.mjs", "add", "/tmp/source"],
      expect.objectContaining({ shell: false, stdio: "inherit" }),
    );
  });

  it("returns the child exit and bounded diagnostics", async () => {
    const spawnProcess: SpawnAgentInstallerProcess = () =>
      fakeChild({ code: 2, stdout: "out", stderr: "bad agent" });
    const runner = new SkillsAgentInstallerRunner({
      resolveInstaller: () => "/installed/skills/bin/cli.mjs",
      spawnProcess,
    });

    await expect(
      runner.run({ arguments: [], cwd: "/workspace", env: {}, interactive: false }),
    ).resolves.toEqual({ exitCode: 2, stdout: "out", stderr: "bad agent" });
  });

  it("marks captured installer output that exceeds the diagnostic limit", async () => {
    const oversized = "x".repeat(1024 * 1024 + 100);
    const runner = new SkillsAgentInstallerRunner({
      resolveInstaller: () => "/installed/skills/bin/cli.mjs",
      spawnProcess: () => fakeChild({ stderr: oversized }),
    });

    const result = await runner.run({
      arguments: [],
      cwd: "/workspace",
      env: {},
      interactive: false,
    });

    expect(result.stderr.length).toBeLessThan(oversized.length);
    expect(result.stderr).toMatch(/\n\[installer output truncated\]\n$/u);
  });

  it("maps resolution and spawn failures to a typed unavailable error", async () => {
    const resolutionFailure = new SkillsAgentInstallerRunner({
      resolveInstaller: () => {
        throw new Error("missing package");
      },
      spawnProcess: vi.fn(),
    });
    await expect(
      resolutionFailure.run({ arguments: [], cwd: "/workspace", env: {}, interactive: false }),
    ).rejects.toMatchObject({ code: "AGENT_INSTALLER_UNAVAILABLE", exitCode: 5 });

    const spawnFailure = new SkillsAgentInstallerRunner({
      resolveInstaller: () => "/installed/skills/bin/cli.mjs",
      spawnProcess: () => fakeChild({ error: new Error("spawn denied") }),
    });
    await expect(
      spawnFailure.run({ arguments: [], cwd: "/workspace", env: {}, interactive: false }),
    ).rejects.toMatchObject({ code: "AGENT_INSTALLER_UNAVAILABLE", exitCode: 5 });
  });
});
