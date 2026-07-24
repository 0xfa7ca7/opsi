import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DUCKDB_CLI_VERSION,
  ProcessDuckDbUiRunner,
  type SpawnDuckDbProcess,
} from "../src/duckdb-ui-runner.js";

interface FakeChild extends ChildProcess {
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
}

const temporaryDirectories: string[] = [];

function fakeChild(options: {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: NodeJS.ErrnoException;
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

function missingExecutable(): NodeJS.ErrnoException {
  return Object.assign(new Error("spawn duckdb ENOENT"), { code: "ENOENT" });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("DuckDB UI process runner", () => {
  it("discovers DuckDB and launches a writable workbench over the read-only staged database without a shell", async () => {
    const spawnProcess = vi.fn<SpawnDuckDbProcess>((_command, arguments_) =>
      arguments_[0] === "-version"
        ? fakeChild({ stdout: "v1.5.4 (Variegata) 08e34c447b\n" })
        : fakeChild({ interactive: true }),
    );
    const runner = new ProcessDuckDbUiRunner({
      home: "/home/test",
      env: { PATH: "/usr/bin" },
      spawnProcess,
    });

    const info = await runner.inspect();
    expect(info).toEqual({
      executable: "duckdb",
      version: "v1.5.4 (Variegata) 08e34c447b",
    });
    if (info === undefined) throw new Error("DuckDB should be available");
    await expect(runner.open(info, "/tmp/data's stage/data.duckdb")).resolves.toEqual(info);

    expect(spawnProcess).toHaveBeenLastCalledWith(
      "duckdb",
      [
        "/tmp/data's stage/workbench.duckdb",
        "-cmd",
        "ATTACH '/tmp/data''s stage/data.duckdb' AS dataset (READ_ONLY); " +
          "CREATE VIEW main.data AS SELECT * FROM dataset.main.data;",
        "-ui",
      ],
      {
        env: { PATH: "/usr/bin" },
        shell: false,
        stdio: "inherit",
      } satisfies SpawnOptions,
    );
    expect(spawnProcess.mock.calls.every((call) => call[2].shell === false)).toBe(true);
  });

  it("returns undefined for a missing executable and types UI process failures", async () => {
    const missing = new ProcessDuckDbUiRunner({
      home: "/home/test",
      env: {},
      spawnProcess: () => fakeChild({ error: missingExecutable() }),
    });
    await expect(missing.inspect()).resolves.toBeUndefined();

    const nonzero = new ProcessDuckDbUiRunner({
      home: "/home/test",
      env: {},
      spawnProcess: () => fakeChild({ code: 9, interactive: true }),
    });
    await expect(
      nonzero.open({ executable: "duckdb", version: "v1.5.4" }, "/tmp/data.duckdb"),
    ).rejects.toMatchObject({
      code: "DUCKDB_UI_FAILED",
      exitCode: 6,
      context: { childExitCode: 9 },
    });

    const denied = new ProcessDuckDbUiRunner({
      home: "/home/test",
      env: {},
      spawnProcess: () =>
        fakeChild({ error: Object.assign(new Error("denied"), { code: "EACCES" }) }),
    });
    await expect(
      denied.open({ executable: "duckdb", version: "v1.5.4" }, "/tmp/data.duckdb"),
    ).rejects.toMatchObject({ code: "DUCKDB_UI_FAILED", exitCode: 6 });
  });

  it("runs the bounded official installer with a pinned version and verifies its candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "klopsi-duckdb-runner-test-"));
    temporaryDirectories.push(root);
    const home = join(root, "home");
    let installerDirectory = "";
    const makeTemporaryDirectory = vi.fn(async () => {
      installerDirectory = await mkdtemp(join(root, "installer-"));
      return installerDirectory;
    });
    const fetchInstaller = vi.fn(async () => new Response("#!/bin/sh\nexit 0\n"));
    const spawnProcess = vi.fn<SpawnDuckDbProcess>((command, arguments_, options) => {
      if (command === "sh") {
        expect(arguments_).toHaveLength(1);
        expect(options).toMatchObject({
          shell: false,
          stdio: "inherit",
          env: expect.objectContaining({ DUCKDB_VERSION: DUCKDB_CLI_VERSION }),
        });
        return fakeChild({ interactive: true });
      }
      if (command === "duckdb") return fakeChild({ error: missingExecutable() });
      expect(command).toBe(join(home, ".duckdb", "cli", DUCKDB_CLI_VERSION, "duckdb"));
      return fakeChild({ stdout: `v${DUCKDB_CLI_VERSION} test\n` });
    });
    const runner = new ProcessDuckDbUiRunner({
      home,
      env: { PATH: "/usr/bin" },
      platform: "darwin",
      arch: "arm64",
      fetchInstaller,
      spawnProcess,
      makeTemporaryDirectory,
    });

    await expect(runner.install()).resolves.toEqual({
      executable: join(home, ".duckdb", "cli", DUCKDB_CLI_VERSION, "duckdb"),
      version: `v${DUCKDB_CLI_VERSION} test`,
    });
    expect(fetchInstaller).toHaveBeenCalledWith("https://install.duckdb.org", {
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(makeTemporaryDirectory).toHaveBeenCalledOnce();
    await expect(access(installerDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    expect(spawnProcess.mock.calls.every((call) => call[2].shell === false)).toBe(true);
  });

  it("rejects unsupported installer targets before making a network request", async () => {
    const fetchInstaller = vi.fn();
    const runner = new ProcessDuckDbUiRunner({
      home: "/home/test",
      env: {},
      platform: "linux",
      arch: "arm64",
      fetchInstaller,
      spawnProcess: vi.fn(),
    });

    await expect(runner.install()).rejects.toMatchObject({
      code: "DUCKDB_CLI_INSTALL_UNSUPPORTED",
      exitCode: 5,
    });
    expect(fetchInstaller).not.toHaveBeenCalled();
  });

  it("rejects oversized or failed installer responses without executing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "klopsi-duckdb-runner-limit-"));
    temporaryDirectories.push(root);
    const spawnProcess = vi.fn<SpawnDuckDbProcess>();
    const oversized = new ProcessDuckDbUiRunner({
      home: root,
      env: {},
      platform: "linux",
      arch: "x64",
      fetchInstaller: async () => new Response(new Uint8Array(1024 * 1024 + 1)),
      spawnProcess,
    });
    await expect(oversized.install()).rejects.toMatchObject({
      code: "DUCKDB_CLI_INSTALL_FAILED",
      exitCode: 5,
    });
    expect(spawnProcess).not.toHaveBeenCalled();

    const unavailable = new ProcessDuckDbUiRunner({
      home: root,
      env: {},
      platform: "linux",
      arch: "x64",
      fetchInstaller: async () => new Response("no", { status: 503 }),
      spawnProcess,
    });
    await expect(unavailable.install()).rejects.toMatchObject({
      code: "DUCKDB_CLI_INSTALL_FAILED",
      exitCode: 5,
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps the installer timeout active while streaming the response body", async () => {
    const root = await mkdtemp(join(tmpdir(), "klopsi-duckdb-runner-timeout-"));
    temporaryDirectories.push(root);
    const spawnProcess = vi.fn<SpawnDuckDbProcess>((command) =>
      command === "sh"
        ? fakeChild({ interactive: true })
        : fakeChild({ stdout: `v${DUCKDB_CLI_VERSION} test\n` }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("#!/bin/sh\n"));
        setTimeout(() => controller.close(), 100);
      },
    });
    const runner = new ProcessDuckDbUiRunner({
      home: root,
      env: {},
      platform: "linux",
      arch: "x64",
      installerTimeoutMs: 5,
      fetchInstaller: async () => new Response(body),
      spawnProcess,
    });

    await expect(runner.install()).rejects.toMatchObject({
      code: "DUCKDB_CLI_INSTALL_FAILED",
      exitCode: 5,
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
