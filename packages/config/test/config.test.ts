import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigStore,
  loadConfiguration,
  resolveConfigPaths,
  type LoadConfigurationOptions,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), label));
  temporaryDirectories.push(directory);
  return directory;
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function fixtureSources(
  sources: {
    readonly user?: unknown;
    readonly project?: unknown;
    readonly env?: NodeJS.ProcessEnv;
    readonly cli?: LoadConfigurationOptions["cli"];
  } = {},
): Promise<LoadConfigurationOptions> {
  const root = await temporaryDirectory("opsi-config-");
  const cwd = join(root, "project");
  const home = join(root, "home");
  await mkdir(cwd, { recursive: true });
  const paths = resolveConfigPaths({ cwd, home });

  if (sources.user !== undefined) {
    await mkdir(dirname(paths.userFile), { recursive: true });
    await writeFile(paths.userFile, JSON.stringify(sources.user));
  }
  if (sources.project !== undefined) {
    await writeFile(paths.projectFile, JSON.stringify(sources.project));
  }

  return { cwd, paths, env: sources.env ?? {}, cli: sources.cli ?? {} };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("configuration", () => {
  it.each(["1GB", "1GiB", "1024MiB"])("accepts DuckDB memory limit %s", async (memoryLimit) => {
    await expect(
      loadConfiguration(await fixtureSources({ project: { duckdb: { memoryLimit } } })),
    ).resolves.toMatchObject({ duckdb: { memoryLimit } });
  });

  it.each(["100GB", "1.1GiB", "unlimited", "1XB", ""])(
    "rejects unsafe DuckDB memory limit %s",
    async (memoryLimit) => {
      await expect(
        loadConfiguration(await fixtureSources({ project: { duckdb: { memoryLimit } } })),
      ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION", exitCode: 2 });
    },
  );
  it("applies CLI over env over project over user over defaults", async () => {
    const config = await loadConfiguration(
      await fixtureSources({
        user: { query: { rowLimit: 10 } },
        project: { query: { rowLimit: 20 } },
        env: { OPSI_QUERY_ROW_LIMIT: "30" },
        cli: { queryRowLimit: 40 },
      }),
    );

    expect(config.query.rowLimit).toBe(40);
  });

  it("does not create config directories while resolving paths", async () => {
    const root = await temporaryDirectory("opsi-paths-");
    const home = join(root, "missing-home");
    const project = join(root, "missing-project");

    const resolved = resolveConfigPaths({ home, cwd: project });

    expect(resolved.userFile).toContain("opsi.config.json");
    await expect(pathExists(dirname(resolved.userFile))).resolves.toBe(false);
    await expect(pathExists(project)).resolves.toBe(false);
  });

  it("rejects unknown configuration keys with a stable input error", async () => {
    await expect(
      loadConfiguration(
        await fixtureSources({ project: { query: { rowLimit: 10, surprise: true } } }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION", exitCode: 2 });
  });

  it("loads API credentials from the environment without persisting them", async () => {
    const options = await fixtureSources({ env: { OPSI_API_KEY: "environment-only" } });
    const config = await loadConfiguration(options);
    const store = new ConfigStore(options.paths?.userFile ?? "");

    expect(config.apiKey).toBe("environment-only");
    await expect(store.set("apiKey", "must-not-persist")).rejects.toMatchObject({
      code: "SECRET_CONFIGURATION_KEY",
      exitCode: 2,
    });
    await expect(pathExists(options.paths?.userFile ?? "")).resolves.toBe(false);
  });

  it("honors NO_COLOR from the process environment when no environment is injected", async () => {
    const options = await fixtureSources();
    const paths = options.paths;
    if (paths === undefined) throw new Error("fixture paths are required");
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const config = await loadConfiguration({ paths });
      expect(config.terminal.color).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  it("stores validated non-secret values and creates the directory only on write", async () => {
    const options = await fixtureSources();
    const userFile = options.paths?.userFile ?? "";
    const store = new ConfigStore(userFile);

    await expect(pathExists(dirname(userFile))).resolves.toBe(false);
    await store.set("query.rowLimit", 321);

    expect(JSON.parse(await readFile(userFile, "utf8"))).toEqual({
      query: { rowLimit: 321 },
    });
  });
});
