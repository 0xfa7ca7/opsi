import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { KlopsiError, EXIT_CODES } from "@klopsi/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliIo } from "../src/context.js";
import type { DuckDbCliInfo, DuckDbUiRunner } from "../src/duckdb-ui-runner.js";
import { runCli } from "../src/main.js";

const temporaryDirectories: string[] = [];
const available: DuckDbCliInfo = {
  executable: "duckdb",
  version: "v1.5.4 test",
};

async function fixture(): Promise<{
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly cwd: string;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "klopsi-duckdb-e2e-"));
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
      stdout: { isTTY: false, write: (chunk) => void stdout.push(chunk) },
      stderr: { isTTY: false, write: (chunk) => void stderr.push(chunk) },
    },
  };
}

async function countRows(databasePath: string): Promise<number> {
  const instance = await DuckDBInstance.create(databasePath, {
    access_mode: "READ_ONLY",
  });
  const connection = await instance.connect();
  try {
    const result = await connection.runAndReadAll("SELECT count(*)::INTEGER AS count FROM data");
    return Number(result.getRowObjectsJS()[0]?.count);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("DuckDB UI commands", () => {
  it("opens a resolved tabular input and holds the staged database until UI exit", async () => {
    const value = await fixture();
    const input = join(value.cwd, "computed.csv");
    await writeFile(input, "name,value\na,1\nb,2\n");
    let leasedPath = "";
    const runner: DuckDbUiRunner = {
      inspect: vi.fn(async () => available),
      install: vi.fn(),
      open: vi.fn(async (info, databasePath) => {
        leasedPath = databasePath;
        await expect(access(databasePath)).resolves.toBeUndefined();
        await expect(countRows(databasePath)).resolves.toBe(2);
        await writeFile(join(dirname(databasePath), "workbench.duckdb"), "");
        return info;
      }),
    };

    await expect(
      runCli(["duckdb", "open", input, "--json"], value.io, {
        duckDbUiRunner: runner,
      }),
    ).resolves.toBe(0);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: {
        opened: true,
        source: input,
        table: "data",
        installed: false,
        duckdb: { version: "v1.5.4 test" },
        cache: { kind: "duckdb-stage" },
      },
    });
    expect(runner.install).not.toHaveBeenCalled();
    expect(runner.open).toHaveBeenCalledWith(available, leasedPath);
    await expect(access(leasedPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(dirname(leasedPath), "workbench.duckdb"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(value.stderr).toEqual([]);
  });

  it("supports one-call installation only when explicitly requested", async () => {
    const value = await fixture();
    const input = join(value.cwd, "acquired.csv");
    await writeFile(input, "id\n1\n");
    const runner: DuckDbUiRunner = {
      inspect: vi.fn(async () => undefined),
      install: vi.fn(async () => available),
      open: vi.fn(async (info) => info),
    };

    await expect(
      runCli(["duckdb", "open", input, "--install", "--json"], value.io, {
        duckDbUiRunner: runner,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: { opened: true, installed: true, duckdb: { version: "v1.5.4 test" } },
    });
    expect(runner.install).toHaveBeenCalledOnce();
    expect(runner.open).toHaveBeenCalledOnce();
  });

  it("fails safely when open cannot find DuckDB and installation was not authorized", async () => {
    const value = await fixture();
    const input = join(value.cwd, "data.csv");
    await writeFile(input, "id\n1\n");
    const runner: DuckDbUiRunner = {
      inspect: vi.fn(async () => undefined),
      install: vi.fn(),
      open: vi.fn(),
    };

    await expect(
      runCli(["duckdb", "open", input, "--json"], value.io, {
        duckDbUiRunner: runner,
      }),
    ).resolves.toBe(5);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "DUCKDB_CLI_UNAVAILABLE", exitCode: 5 },
    });
    expect(runner.install).not.toHaveBeenCalled();
    expect(runner.open).not.toHaveBeenCalled();
  });

  it("requires confirmation for installation but leaves an existing CLI unchanged", async () => {
    const missingValue = await fixture();
    const missing: DuckDbUiRunner = {
      inspect: vi.fn(async () => undefined),
      install: vi.fn(),
      open: vi.fn(),
    };
    await expect(
      runCli(["duckdb", "install", "--json"], missingValue.io, {
        duckDbUiRunner: missing,
      }),
    ).resolves.toBe(2);
    expect(JSON.parse(missingValue.stdout.join(""))).toMatchObject({
      error: { code: "CONFIRMATION_REQUIRED", exitCode: 2 },
    });
    expect(missing.install).not.toHaveBeenCalled();

    const existingValue = await fixture();
    const existing: DuckDbUiRunner = {
      inspect: vi.fn(async () => available),
      install: vi.fn(),
      open: vi.fn(),
    };
    await expect(
      runCli(["duckdb", "install", "--json"], existingValue.io, {
        duckDbUiRunner: existing,
      }),
    ).resolves.toBe(0);
    expect(JSON.parse(existingValue.stdout.join(""))).toMatchObject({
      data: { installed: false, duckdb: { version: "v1.5.4 test" } },
    });
    expect(existing.install).not.toHaveBeenCalled();
  });

  it("returns a typed UI failure from the attached child", async () => {
    const value = await fixture();
    const input = join(value.cwd, "data.csv");
    await writeFile(input, "id\n1\n");
    const runner: DuckDbUiRunner = {
      inspect: vi.fn(async () => available),
      install: vi.fn(),
      open: vi.fn(async () => {
        throw new KlopsiError({
          code: "DUCKDB_UI_FAILED",
          message: "DuckDB UI did not complete successfully.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        });
      }),
    };

    await expect(
      runCli(["duckdb", "open", input, "--json"], value.io, {
        duckDbUiRunner: runner,
      }),
    ).resolves.toBe(6);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "DUCKDB_UI_FAILED", exitCode: 6 },
    });
  });
});
