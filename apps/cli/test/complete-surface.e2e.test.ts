import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";
import { createProgram } from "../src/program.js";
import { registerDatasetOpenCommand } from "../src/commands/open.js";
import { normalizeError } from "../src/errors.js";
import { Command } from "commander";
import type { OpsiClient } from "@opsi/core";

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
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: {
        node: { ok: true },
        configuration: { ok: true },
        connectivity: { skipped: true },
        duckdb: { ok: true },
      },
    });
  });

  it("opens only the derived public provider page through the injected adapter", async () => {
    const value = await fixture();
    const opened: string[] = [];
    const parent = new Command();
    const dataset = parent.command("dataset");
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
      dataset,
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
    expect(output).toContain("--json");
    expect(output).toContain("opsi");
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
});
