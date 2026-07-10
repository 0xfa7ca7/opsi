import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";

const temporaryDirectories: string[] = [];

async function fixtureIo(options: { readonly invalidConfig?: boolean } = {}): Promise<{
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
}> {
  const cwd = await mkdtemp(join(tmpdir(), "opsi-runtime-"));
  temporaryDirectories.push(cwd);
  const home = join(cwd, "home");
  await mkdir(home, { recursive: true });
  if (options.invalidConfig === true) {
    await writeFile(join(cwd, "opsi.config.json"), JSON.stringify({ unknown: true }));
  }
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd,
      home,
      env: {},
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

describe("CLI runtime", () => {
  it("writes version output only to stdout and returns success", async () => {
    const fixture = await fixtureIo();

    await expect(runCli(["--version"], fixture.io)).resolves.toBe(0);
    expect(fixture.stdout.join("")).toMatch(/^\d+\.\d+\.\d+\n$/u);
    expect(fixture.stderr).toEqual([]);
  });

  it("maps conflicting format flags to invalid input on stderr", async () => {
    const fixture = await fixtureIo();

    await expect(runCli(["--json", "--csv"], fixture.io)).resolves.toBe(2);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr.join("")).toContain("cannot be used with option");
  });

  it("writes readable configuration errors only to stderr by default", async () => {
    const fixture = await fixtureIo({ invalidConfig: true });

    await expect(runCli([], fixture.io)).resolves.toBe(2);
    expect(fixture.stdout).toEqual([]);
    expect(fixture.stderr.join("")).toContain("INVALID_CONFIGURATION");
  });

  it("writes structured errors only to stdout when JSON is explicitly requested", async () => {
    const fixture = await fixtureIo({ invalidConfig: true });

    await expect(runCli(["--json"], fixture.io)).resolves.toBe(2);
    expect(JSON.parse(fixture.stdout.join(""))).toMatchObject({
      schemaVersion: "1",
      data: null,
      error: { code: "INVALID_CONFIGURATION", exitCode: 2 },
    });
    expect(fixture.stderr).toEqual([]);
  });
});
