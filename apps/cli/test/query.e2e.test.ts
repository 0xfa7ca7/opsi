import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
let input: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "opsi-query-e2e-"));
  input = join(home, "input.csv");
  await writeFile(input, "city,value\nLjubljana,1\nMaribor,2\nKoper,3\n");
});
afterEach(async () => rm(home, { recursive: true, force: true }));

async function cli(argv: readonly string[]) {
  const child = spawn(process.execPath, [resolve("apps/cli/dist/main.js"), ...argv], {
    cwd: home,
    env: { ...process.env, HOME: home, OPSI_CACHE_DIR: join(home, "cache"), NO_COLOR: "1" },
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

describe("query CLI", () => {
  it("queries only the data table and includes executed SQL metadata", async () => {
    const sql = "SELECT city, value FROM data ORDER BY city";
    await expect(cli(["query", input, "--sql", sql, "--json"])).resolves.toMatchObject({
      exitCode: 0,
      stderr: "",
      json: {
        data: [
          { city: "Koper", value: "3" },
          { city: "Ljubljana", value: "1" },
          { city: "Maribor", value: "2" },
        ],
        meta: { sql, returnedCount: 3, truncated: false, source: input },
      },
    });
  });

  it.each([
    ["--ndjson", /^\{"city":"Ljubljana","value":"1"\}\n/u],
    ["--csv", /^city,value\nLjubljana,1\n/u],
    ["--tsv", /^city\tvalue\nLjubljana\t1\n/u],
  ])("renders %s rows", async (flag, expected) => {
    const result = await cli(["query", input, "--sql", "SELECT * FROM data LIMIT 1", flag]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toMatch(expected);
  });

  it("reports truncation and maps forbidden SQL and timeout to exit 7", async () => {
    await expect(
      cli(["query", input, "--sql", "SELECT * FROM data", "--limit", "1", "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: { meta: { returnedCount: 1, truncated: true } },
    });
    await expect(cli(["query", input, "--sql", "PRAGMA version", "--json"])).resolves.toMatchObject(
      {
        exitCode: 7,
        json: { error: { code: "QUERY_FORBIDDEN" } },
      },
    );
    await expect(
      cli([
        "query",
        input,
        "--sql",
        "SELECT sum(a.i * b.i) FROM range(1000000000) a(i), range(1000000000) b(i)",
        "--timeout-ms",
        "100",
        "--json",
      ]),
    ).resolves.toMatchObject({ exitCode: 7, json: { error: { code: "QUERY_TIMEOUT" } } });
  });

  it("exports bounded results with query provenance", async () => {
    const output = join(home, "result.csv");
    const sql = "SELECT city FROM data ORDER BY city LIMIT 2";
    await expect(
      cli(["query", input, "--sql", sql, "--output", output, "--json"]),
    ).resolves.toMatchObject({ exitCode: 0, json: { meta: { sql }, data: expect.any(Array) } });
    expect(await readFile(output, "utf8")).toBe("city\nKoper\nLjubljana\n");
    await expect(cli(["provenance", "verify", output, "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { valid: true } },
    });
    const provenance = JSON.parse(await readFile(`${output}.provenance.json`, "utf8")) as {
      transformations: { operation: string; details?: { sql?: string } }[];
    };
    expect(provenance.transformations).toEqual([
      expect.objectContaining({ operation: "query", details: expect.objectContaining({ sql }) }),
    ]);
  });

  it.each([
    ["csv", "city,value\n"],
    ["tsv", "city\tvalue\n"],
  ])("exports known headers for an empty %s query result", async (format, expected) => {
    const output = join(home, `empty.${format}`);
    await expect(
      cli([
        "query",
        input,
        "--sql",
        "SELECT city, value FROM data WHERE false",
        "--output",
        output,
        "--json",
      ]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: [] } });
    expect(await readFile(output, "utf8")).toBe(expected);
  });
});
