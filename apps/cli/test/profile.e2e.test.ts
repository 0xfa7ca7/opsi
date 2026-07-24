import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
let input: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "klopsi-profile-e2e-"));
  input = join(home, "input.csv");
  await writeFile(input, "city,amount,active\nLjubljana,1,true\nLjubljana,2,true\nCelje,,false\n");
});

afterEach(async () => rm(home, { recursive: true, force: true }));

async function cli(argv: readonly string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [resolve("apps/cli/dist/main.js"), ...argv], {
    cwd: home,
    env: {
      ...process.env,
      ...env,
      HOME: home,
      KLOPSI_CACHE_DIR: join(home, "cache"),
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const [exitCode] = (await once(child, "exit")) as [number];
  let json: unknown;
  try {
    json = JSON.parse(stdout) as unknown;
  } catch {
    json = undefined;
  }
  return { exitCode, stdout, stderr, json };
}

describe("profile CLI", () => {
  it("returns exact field profiles with bounded categorical values", async () => {
    const result = await cli(["profile", input, "--top", "1", "--json"]);

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      json: {
        data: [
          {
            name: "city",
            type: "VARCHAR",
            rowCount: 3,
            nullCount: 0,
            nullRate: 0,
            distinctCount: 2,
            min: "Celje",
            max: "Ljubljana",
            mean: null,
            topValues: [{ value: "Ljubljana", count: 2, rate: 2 / 3 }],
          },
          {
            name: "amount",
            type: "BIGINT",
            rowCount: 3,
            nullCount: 1,
            nullRate: 1 / 3,
            distinctCount: 2,
            min: 1,
            max: 2,
            mean: 1.5,
            topValues: [],
          },
          {
            name: "active",
            type: "BOOLEAN",
            rowCount: 3,
            nullCount: 0,
            nullRate: 0,
            distinctCount: 2,
            min: false,
            max: true,
            mean: null,
            topValues: [{ value: true, count: 2, rate: 2 / 3 }],
          },
        ],
        meta: {
          source: input,
          rowCount: 3,
          columnCount: 3,
          top: 1,
          durationMs: expect.any(Number),
          cache: { status: "miss", kind: "duckdb-stage" },
        },
      },
    });
  });

  it("renders a self-contained human table", async () => {
    const result = await cli(["profile", input, "--top", "1"]);

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("name");
    expect(result.stdout).toContain("rowCount");
    expect(result.stdout).toContain("nullRate");
    expect(result.stdout).toContain("topValues");
    expect(result.stdout).toContain("Ljubljana");
  });

  it("reports a transparent miss followed by a hit", async () => {
    const argv = ["profile", input, "--json"];
    const first = await cli(argv);
    const second = await cli(argv);

    expect(first).toMatchObject({
      exitCode: 0,
      json: { meta: { cache: { status: "miss", kind: "duckdb-stage" } } },
    });
    expect(second).toMatchObject({
      exitCode: 0,
      json: {
        data: (first.json as { data: unknown }).data,
        meta: { cache: { status: "hit", kind: "duckdb-stage" } },
      },
    });
  });

  it("reports bypass when the derived cache budget is zero", async () => {
    await expect(
      cli(["profile", input, "--json"], {
        KLOPSI_DUCKDB_CACHE_MAX_BYTES: "0B",
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      stderr: "",
      json: { meta: { cache: { status: "bypass", kind: "duckdb-stage" } } },
    });
  });

  it("rejects an unbounded top-value request with a typed invalid-input error", async () => {
    await expect(cli(["profile", input, "--top", "21", "--json"])).resolves.toMatchObject({
      exitCode: 2,
      stderr: "",
      json: { error: { code: "PROFILE_TOP_LIMIT", exitCode: 2 } },
    });
  });
});
