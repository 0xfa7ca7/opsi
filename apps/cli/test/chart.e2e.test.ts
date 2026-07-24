import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
let input: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "klopsi-chart-e2e-"));
  input = join(home, "input.csv");
  await writeFile(input, "rowid,city,value\n3,Ljubljana,10\n1,Maribor,-5\n2,Koper,7.25\n");
});

afterEach(async () => rm(home, { recursive: true, force: true }));

async function cli(argv: readonly string[]) {
  const child = spawn(process.execPath, [resolve("apps/cli/dist/main.js"), ...argv], {
    cwd: home,
    env: {
      ...process.env,
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

function chartArgs(output: string, type: "bar" | "line" = "bar"): string[] {
  return ["chart", input, "--x", "city", "--y", "value", "--type", type, "--output", output];
}

describe("chart CLI experiment", () => {
  it("renders a bounded bar chart with a stable result and verifiable provenance", async () => {
    const output = join(home, "cities.html");
    const result = await cli([...chartArgs(output), "--title", "City values", "--json"]);

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      json: {
        data: {
          output,
          provenancePath: `${output}.provenance.json`,
          type: "bar",
          x: "city",
          y: "value",
          points: 3,
          limit: 100,
          truncated: false,
          order: "source",
        },
      },
    });
    const html = await readFile(output, "utf8");
    expect(html).toContain("<title>City values</title>");
    expect(html).toContain('class="bar"');
    expect(html).toContain("<td>Ljubljana</td>");
    expect(html.indexOf("<td>Ljubljana</td>")).toBeLessThan(html.indexOf("<td>Maribor</td>"));
    expect(html).not.toMatch(/<script|<link|<img|<iframe|<[^>]*\s(?:src|href)\s*=/iu);
    await expect(cli(["provenance", "verify", output, "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { valid: true } },
    });
  });

  it("renders deterministic line-chart bytes from a canonical local provider reference", async () => {
    const first = join(home, "first.html");
    const second = join(home, "second.html");
    const reference = `local:file:${input}`;
    const args = [
      "chart",
      reference,
      "--x",
      "city",
      "--y",
      "value",
      "--type",
      "line",
      "--title",
      "Trend",
      "--offline",
      "--json",
    ];
    const one = await cli([...args, "--output", first]);
    const two = await cli([
      ...args.filter((argument) => argument !== "--json"),
      "--output",
      second,
    ]);

    expect(one).toMatchObject({ exitCode: 0, json: { data: { type: "line" } } });
    expect(two).toMatchObject({ exitCode: 0 });
    expect(two.stdout).toContain("output");
    expect(two.stdout).toContain("provenancePath");
    expect(await readFile(first, "utf8")).toBe(await readFile(second, "utf8"));
    expect(await readFile(first, "utf8")).toContain('class="series-line"');
  });

  it("limits points, preserves the source prefix, and rejects a request above 500", async () => {
    const output = join(home, "limited.html");
    const limited = await cli([...chartArgs(output), "--limit", "2", "--json"]);
    expect(limited).toMatchObject({
      exitCode: 0,
      json: { data: { points: 2, limit: 2, truncated: true, order: "source" } },
    });
    const html = await readFile(output, "utf8");
    expect(html).toContain("first 2 points");
    expect(html).toContain("<td>Ljubljana</td>");
    expect(html).toContain("<td>Maribor</td>");
    expect(html).not.toContain("<td>Koper</td>");

    const rejected = join(home, "too-many.html");
    await expect(cli([...chartArgs(rejected), "--limit", "501", "--json"])).resolves.toMatchObject({
      exitCode: 2,
      json: { error: { code: "CHART_POINT_LIMIT" } },
    });
    await expect(access(rejected)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects missing, non-numeric, and empty chart data without publishing", async () => {
    const missing = join(home, "missing.html");
    await expect(
      cli([
        "chart",
        input,
        "--x",
        "unknown",
        "--y",
        "value",
        "--type",
        "bar",
        "--output",
        missing,
        "--json",
      ]),
    ).resolves.toMatchObject({ exitCode: 7, json: { error: expect.any(Object) } });
    await expect(access(missing)).rejects.toMatchObject({ code: "ENOENT" });

    const nonNumericInput = join(home, "non-numeric.csv");
    const nonNumeric = join(home, "non-numeric.html");
    await writeFile(nonNumericInput, "city,value\nLjubljana,not-a-number\n");
    await expect(
      cli([
        "chart",
        nonNumericInput,
        "--x",
        "city",
        "--y",
        "value",
        "--type",
        "bar",
        "--output",
        nonNumeric,
        "--json",
      ]),
    ).resolves.toMatchObject({
      exitCode: 2,
      json: { error: { code: "CHART_NON_NUMERIC_Y" } },
    });
    await expect(access(nonNumeric)).rejects.toMatchObject({ code: "ENOENT" });

    const emptyInput = join(home, "empty.csv");
    const empty = join(home, "empty.html");
    await writeFile(emptyInput, "city,value\n");
    await expect(
      cli([
        "chart",
        emptyInput,
        "--x",
        "city",
        "--y",
        "value",
        "--type",
        "line",
        "--output",
        empty,
        "--json",
      ]),
    ).resolves.toMatchObject({ exitCode: 2, json: { error: { code: "CHART_EMPTY" } } });
    await expect(access(empty)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("encodes malicious labels and titles, refuses overwrite, and replaces with force", async () => {
    const attack = `</title><script>alert("x")</script><img src=x onerror=alert(1)>`;
    const maliciousInput = join(home, "malicious.csv");
    const output = join(home, "safe.html");
    await writeFile(maliciousInput, `city,value\n"${attack.replaceAll('"', '""')}",1\n`);
    const args = [
      "chart",
      maliciousInput,
      "--x",
      "city",
      "--y",
      "value",
      "--type",
      "bar",
      "--title",
      attack,
      "--output",
      output,
      "--json",
    ];

    await expect(cli(args)).resolves.toMatchObject({ exitCode: 0 });
    const first = await readFile(output, "utf8");
    expect(first).toContain("&lt;/title&gt;&lt;script&gt;");
    expect(first).not.toContain("<script");
    expect(first).not.toContain("<img");

    await expect(cli(args)).resolves.toMatchObject({
      exitCode: 2,
      json: { error: { code: "CHART_DESTINATION_EXISTS" } },
    });
    expect(await readFile(output, "utf8")).toBe(first);

    await expect(cli([...args, "--title", "Replacement", "--force"])).resolves.toMatchObject({
      exitCode: 0,
    });
    expect(await readFile(output, "utf8")).toContain("<title>Replacement</title>");
    await expect(cli(["provenance", "verify", output, "--json"])).resolves.toMatchObject({
      exitCode: 0,
    });
  });

  it("documents the complete experimental option surface in help", async () => {
    const help = await cli(["chart", "--help"]);
    expect(help).toMatchObject({ exitCode: 0, stderr: "" });
    for (const option of [
      "--x <column>",
      "--y <column>",
      "--type <type>",
      "--output <path>",
      "--title <text>",
      "--limit <points>",
      "--force",
      "--sheet <name>",
      "--entry <path>",
      "--record-path <path>",
    ])
      expect(help.stdout).toContain(option);
  });
});
