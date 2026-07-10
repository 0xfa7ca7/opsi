import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";
import { createProgram } from "../src/program.js";
import { registerDatasetOpenCommand } from "../src/commands/open.js";
import { normalizeError } from "../src/errors.js";
import { handleDoctorReport, runDoctorChecks, type DoctorReport } from "../src/commands/doctor.js";
import { Command } from "commander";
import type { OpsiClient } from "@opsi/core";
import { COMMAND_MANIFEST, registerCommandManifest } from "../src/command-manifest.js";
import { Renderer } from "@opsi/output";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly cwd: string;
  readonly home: string;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "opsi-complete-surface-"));
  temporaryDirectories.push(cwd);
  const home = join(cwd, "home");
  await mkdir(home, { recursive: true });
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    cwd,
    home,
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("complete command surface", () => {
  it("registers every approved command through the program", async () => {
    const value = await fixture();
    const program = createProgram({ io: value.io, version: "1.2.3" });
    const paths = program.commands.flatMap((command) =>
      command.commands.length === 0
        ? [command.name()]
        : command.commands.map((child) => `${command.name()} ${child.name()}`),
    );

    expect(paths).toEqual(
      expect.arrayContaining([
        "search",
        "dataset show",
        "dataset resources",
        "dataset schema",
        "dataset open",
        "resource show",
        "resource preview",
        "resource headers",
        "download",
        "query",
        "convert",
        "validate",
        "provenance show",
        "provenance verify",
        "providers list",
        "cache info",
        "cache list",
        "cache clear",
        "cache prune",
        "cache verify",
        "config get",
        "config set",
        "config list",
        "config path",
        "doctor",
        "completion",
      ]),
    );
  });

  it("keeps registered arguments and options identical to the normalized manifest", async () => {
    const value = await fixture();
    const program = createProgram({ io: value.io, version: "1.2.3" });
    const registered = program.commands.flatMap((parent) =>
      (parent.commands.length === 0 ? [parent] : parent.commands).map((leaf) => ({
        path: parent === leaf ? parent.name() : `${parent.name()} ${leaf.name()}`,
        arguments: leaf.registeredArguments.map((argument) => argument.name()),
        options: leaf.options
          .filter((option) => option.long !== "--help")
          .map((option) => option.flags)
          .sort(),
      })),
    );
    type ManifestLeaf = {
      path: string;
      arguments: Array<{ name: string }>;
      options: Array<{ flags: string }>;
      commands?: never;
    };
    const declared = (COMMAND_MANIFEST as unknown as ManifestLeaf[]).map((entry) => ({
      path: entry.path,
      arguments: entry.arguments.map((argument) => argument.name.replace(/[.[\]{}<>]/gu, "")),
      options: entry.options.map((option) => option.flags).sort(),
    }));
    expect(registered).toEqual(declared);
  });

  it("keeps Commander metadata out of action-only command adapters", async () => {
    const adapters = [
      "cache",
      "completion",
      "config",
      "convert",
      "dataset",
      "doctor",
      "download",
      "open",
      "preview",
      "provenance",
      "providers",
      "query",
      "resource",
      "search",
      "validate",
    ];
    for (const adapter of adapters) {
      const source = await readFile(
        join(process.cwd(), `apps/cli/src/commands/${adapter}.ts`),
        "utf8",
      );
      expect(source, adapter).not.toMatch(
        /\.(?:command|description|argument|addArgument|option|requiredOption|addOption)\s*\(/u,
      );
    }
  });

  it("gets, sets, lists, and locates non-secret user configuration", async () => {
    const value = await fixture();
    await expect(
      runCli(["config", "set", "query.rowLimit", "25", "--json"], value.io),
    ).resolves.toBe(0);
    expect(JSON.parse(value.stdout.splice(0).join(""))).toMatchObject({
      data: { key: "query.rowLimit", value: 25 },
    });

    await expect(runCli(["config", "get", "query.rowLimit", "--json"], value.io)).resolves.toBe(0);
    expect(JSON.parse(value.stdout.splice(0).join(""))).toMatchObject({
      data: { key: "query.rowLimit", value: 25 },
    });

    await expect(runCli(["config", "list", "--json"], value.io)).resolves.toBe(0);
    expect(JSON.parse(value.stdout.splice(0).join(""))).toMatchObject({
      data: { query: { rowLimit: 25 } },
    });

    await expect(runCli(["config", "path", "--json"], value.io)).resolves.toBe(0);
    const pathEnvelope = JSON.parse(value.stdout.splice(0).join("")) as {
      data: { user: string; project: string };
    };
    expect(pathEnvelope).toMatchObject({ data: { project: join(value.cwd, "opsi.config.json") } });
    expect(await readFile(pathEnvelope.data.user, "utf8")).not.toMatch(/apiKey|token|secret/iu);
  });

  it("rejects secret-like configuration keys", async () => {
    const value = await fixture();
    await expect(
      runCli(["config", "set", "apiKey", "do-not-store", "--json"], value.io),
    ).resolves.toBe(2);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "SECRET_CONFIGURATION_KEY" },
    });
  });

  it("runs an offline JSON doctor without network access", async () => {
    const value = await fixture();
    await expect(runCli(["doctor", "--json", "--offline"], value.io)).resolves.toBe(0);
    const envelope = JSON.parse(value.stdout.join("")) as {
      data: { status: string; checks: Array<{ name: string; status: string }> };
    };
    expect(envelope.data.status).toBe("pass");
    expect(envelope.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "node", status: "pass" }),
        expect.objectContaining({ name: "configuration", status: "pass" }),
        expect.objectContaining({ name: "cache", status: "pass" }),
        expect.objectContaining({ name: "temp", status: "pass" }),
        expect.objectContaining({ name: "connectivity", status: "skip" }),
        expect.objectContaining({ name: "duckdb", status: "pass" }),
        expect.objectContaining({
          name: "format:tsv",
          status: "pass",
          detail: expect.objectContaining({ columns: 2 }),
        }),
        ...["csv", "tsv", "json", "ndjson", "xlsx", "parquet"].map((format) =>
          expect.objectContaining({ name: `format:${format}`, status: "pass" }),
        ),
      ]),
    );
  });

  it("aggregates later native and format checks after connectivity fails", async () => {
    const value = await fixture();
    const context = {
      io: value.io,
      version: "1.0.0",
      configuration: {
        provider: "opsi",
        output: "json" as const,
        locale: "sl-SI",
        offline: false,
        paths: { cacheDir: join(value.cwd, "cache"), downloadDir: join(value.cwd, "downloads") },
        http: { timeoutMs: 100, maxDownloadBytes: 1_000 },
        preview: { rowLimit: 20 },
        query: { rowLimit: 20, timeoutMs: 100 },
        duckdb: { memoryLimit: "1GB", threads: 1 },
        terminal: { color: false },
      },
    };
    const client = {
      search: async () => {
        throw new Error("controlled connectivity failure");
      },
    } as unknown as OpsiClient;
    const report = await runDoctorChecks(context, client, false);
    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "connectivity", status: "fail" }),
        expect.objectContaining({ name: "duckdb", status: "pass" }),
        expect.objectContaining({ name: "format:parquet", status: "pass" }),
      ]),
    );
  });

  it("renders every failed doctor check for humans before returning a typed failure", async () => {
    const value = await fixture();
    const report: DoctorReport = {
      status: "fail",
      checks: [
        { name: "connectivity", status: "fail", message: "network unavailable" },
        { name: "format:parquet", status: "fail", message: "native adapter unavailable" },
        { name: "format:csv", status: "pass" },
      ],
    };
    const context = {
      io: value.io,
      version: "1.0.0",
      configuration: { output: "human" },
      renderer: new Renderer({ format: "human", stdout: value.io.stdout }),
    } as Parameters<typeof handleDoctorReport>[0];

    expect(() => handleDoctorReport(context, report)).toThrowError(
      expect.objectContaining({ code: "DOCTOR_FAILED", exitCode: 4 }),
    );
    const output = value.stdout.join("");
    expect(output).toContain("connectivity");
    expect(output).toContain("network unavailable");
    expect(output).toContain("format:parquet");
    expect(output).toContain("native adapter unavailable");
  });

  it("reads back doctor filesystem probes and uses a real multi-column TSV fixture", async () => {
    const source = await readFile(join(process.cwd(), "apps/cli/src/commands/doctor.ts"), "utf8");
    expect(source).toContain("readFile(probe");
    expect(source).not.toContain("access(probe)");
    expect(source).toContain('"answer\\tlabel\\n42\\tok\\n"');
  });

  it("opens only the derived public provider page through the injected adapter", async () => {
    const value = await fixture();
    const opened: string[] = [];
    const parent = new Command();
    registerCommandManifest(parent);
    const client = {
      datasets: {
        get: async () => ({
          id: "dataset-traffic-001",
          providerId: "opsi",
          title: "Traffic",
          resources: [],
          providerMetadata: { raw: { name: "traffic-data" } },
        }),
      },
    } as unknown as OpsiClient;
    registerDatasetOpenCommand(
      parent,
      { io: value.io, version: "1.0.0", openUrl: async (url) => void opened.push(url) },
      client,
    );
    await parent.parseAsync(["dataset", "open", "dataset-traffic-001"], { from: "user" });
    expect(opened).toEqual(["https://podatki.gov.si/dataset/traffic-data"]);
  });

  it("maps raw optional-native loader failures without exposing a stack", () => {
    const failure = Object.assign(new Error("Cannot find package '@duckdb/node-api'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(normalizeError(failure)).toMatchObject({ code: "DUCKDB_UNAVAILABLE", exitCode: 5 });
  });

  it("never prompts on a non-TTY and requires explicit cache confirmation", async () => {
    const value = await fixture();
    await expect(runCli(["cache", "clear", "--json"], value.io)).resolves.toBe(2);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "CONFIRMATION_REQUIRED" },
    });
  });

  it.each(["bash", "zsh", "fish"])("generates static %s completion", async (shell) => {
    const value = await fixture();
    await expect(runCli(["completion", shell], value.io)).resolves.toBe(0);
    const output = value.stdout.join("");
    expect(output).toContain("dataset");
    expect(output).toContain(shell === "fish" ? "-l 'json'" : "--json");
    expect(output).toContain("opsi");
    if (shell === "bash") expect(output).toContain('case "$COMP_LINE"');
    if (shell === "zsh") {
      expect(output).not.toContain("# enum choices:");
      expect(output).toContain("convert)");
      expect(output).toContain(
        "--to[destination data format]:format:(csv tsv json ndjson xlsx parquet)",
      );
      expect(output).toContain("--output[destination file path]:path:_files");
      expect(output).toContain("dataset)");
      expect(output).toContain("schema)");
      expect(output).toContain(
        "--resource[resource identifier or canonical resource reference]:id:",
      );
      expect(output).toContain("search)");
      expect(output).toContain("--limit[maximum results]:number:");
    }
    if (shell === "fish") expect(output).toContain("__fish_seen_subcommand_from dataset");
    expect(output).toContain("parquet");
    expect(output).toContain("local");
    expect(value.stderr).toEqual([]);
  });

  it("keeps help/version output stack-free and non-interactive", async () => {
    const value = await fixture();
    await expect(runCli(["--help"], value.io)).resolves.toBe(0);
    expect(value.stdout.join("")).toContain("Usage: opsi");
    expect(value.stderr).toEqual([]);

    value.stdout.splice(0);
    await expect(runCli(["--version"], value.io)).resolves.toBe(0);
    expect(value.stdout.join("")).toMatch(/^\d+\.\d+\.\d+\n$/u);
    expect(value.stderr.join("")).not.toContain(" at ");
  });

  it("honors NO_COLOR with no ANSI control sequences", async () => {
    const value = await fixture();
    await expect(runCli(["--help"], value.io)).resolves.toBe(0);
    expect(value.stdout.join("") + value.stderr.join("")).not.toContain(String.fromCharCode(27));
  });
});
