import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfiguration, resolveConfigPaths } from "@opsi/config";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";
import { cliConfigurationFromArgv, requestedOutputFormat } from "../src/options.js";
import { createProgram } from "../src/program.js";

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

  it.each([
    ["separate-token", ["--query-row-limit", "nope"]],
    ["equals-form", ["--query-row-limit=nope"]],
  ])(
    "maps %s invalid numeric option values to invalid input without internal diagnostics",
    async (_form, argv) => {
      const fixture = await fixtureIo();

      await expect(runCli(argv, fixture.io)).resolves.toBe(2);
      expect(fixture.stdout).toEqual([]);
      expect(fixture.stderr.join("")).toContain("must be a positive integer");
      expect(fixture.stderr.join("")).not.toContain("INTERNAL_ERROR");
    },
  );

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

  it("writes structured configuration errors for equals-form output selection", async () => {
    const fixture = await fixtureIo({ invalidConfig: true });

    await expect(runCli(["--output-format=json"], fixture.io)).resolves.toBe(2);
    expect(JSON.parse(fixture.stdout.join(""))).toMatchObject({
      schemaVersion: "1",
      data: null,
      error: { code: "INVALID_CONFIGURATION", exitCode: 2 },
    });
    expect(fixture.stderr).toEqual([]);
  });
});

describe("CLI bootstrap options", () => {
  it("gives convert direct ownership of --output and documents no hidden destination", async () => {
    const fixture = await fixtureIo();
    const program = createProgram({ io: fixture.io, version: "1.0.0" });
    const convert = program.commands.find((candidate) => candidate.name() === "convert");
    expect(convert).toBeDefined();
    expect(program.options.map((option) => option.flags)).toContain("--output-format <format>");
    expect(program.options.map((option) => option.flags)).not.toContain("--output <format>");
    expect(convert?.helpInformation()).toContain("--output <path>");
    expect(convert?.helpInformation()).not.toContain("--destination");
    convert?.parseOptions(["input.csv", "--to", "csv", "--output", "json"]);
    expect(convert?.opts()).toMatchObject({ output: "json", to: "csv" });
  });

  it("applies equals-form values for every bootstrap configuration option", () => {
    expect(
      cliConfigurationFromArgv([
        "--provider=custom",
        "--output-format=json",
        "--cache-dir=/tmp/cache",
        "--download-dir=/tmp/downloads",
        "--http-timeout-ms=100",
        "--max-download-bytes=200",
        "--preview-row-limit=20",
        "--query-row-limit=30",
        "--query-timeout-ms=400",
        "--duckdb-memory-limit=2GB",
        "--duckdb-threads=3",
      ]),
    ).toEqual({
      provider: "custom",
      output: "json",
      cacheDir: "/tmp/cache",
      downloadDir: "/tmp/downloads",
      httpTimeoutMs: 100,
      maxDownloadBytes: 200,
      previewRowLimit: 20,
      queryRowLimit: 30,
      queryTimeoutMs: 400,
      duckdbMemoryLimit: "2GB",
      duckdbThreads: 3,
    });
    expect(requestedOutputFormat(["--output-format=json"])).toBe("json");
  });

  it("retains separate-token bootstrap option parsing", () => {
    expect(
      cliConfigurationFromArgv([
        "--provider",
        "custom",
        "--output-format",
        "json",
        "--query-row-limit",
        "30",
      ]),
    ).toMatchObject({ provider: "custom", output: "json", queryRowLimit: 30 });
    expect(requestedOutputFormat(["--output-format", "json"])).toBe("json");
  });

  it("gives equals-form output CLI precedence over the environment", async () => {
    const fixture = await fixtureIo();
    const { cwd, home } = fixture.io;
    if (cwd === undefined || home === undefined) throw new Error("fixture locations are required");
    const paths = resolveConfigPaths({ cwd, home });

    const configuration = await loadConfiguration({
      cwd,
      home,
      paths,
      env: { OPSI_OUTPUT: "csv" },
      cli: cliConfigurationFromArgv(["--output-format=json"]),
    });

    expect(configuration.output).toBe("json");
  });

  it("maps the table output-format spelling to human rendering", () => {
    expect(cliConfigurationFromArgv(["--output-format", "table"])).toMatchObject({
      output: "human",
    });
    expect(requestedOutputFormat(["--output-format=table"])).toBe("human");
  });

  it("never treats convert destination names as renderer options", () => {
    const argv = ["convert", "input.csv", "--to", "parquet", "--output", "json"];
    expect(requestedOutputFormat(argv)).toBeUndefined();
    expect(cliConfigurationFromArgv(argv)).not.toHaveProperty("output");
  });
});
