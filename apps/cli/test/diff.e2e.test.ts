import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let home: string;
let before: string;
let after: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "klopsi-diff-e2e-"));
  before = join(home, "before.csv");
  after = join(home, "after.csv");
  await writeFile(before, "id,value\n2,removed\n1,old\n");
  await writeFile(after, "id,value\n3,added\n1,new\n");
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
  return { exitCode, stdout, stderr };
}

describe("klopsi diff", () => {
  it("reports semantic changes in the stable JSON envelope", async () => {
    const result = await cli(["diff", before, after, "--key", "id", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: "1",
      data: {
        before,
        after,
        key: ["id"],
        summary: { beforeRows: 2, afterRows: 2, added: 1, removed: 1, changed: 1 },
        samples: {
          added: [{ key: { id: 3 } }],
          removed: [{ key: { id: 2 } }],
          changed: [{ key: { id: 1 }, changedColumns: ["value"] }],
        },
      },
    });
    expect(result.stderr).toBe("");
  });

  it("renders a compact experimental human report", async () => {
    const result = await cli(["diff", before, after, "--key", "id"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Experimental dataset diff");
    expect(result.stdout).toContain("1 added");
    expect(result.stdout).toContain("Changed samples");
  });

  it.each([
    ["null", "id,value\n,missing\n", "DIFF_NULL_KEY"],
    ["duplicate", "id,value\n1,a\n1,b\n", "DIFF_DUPLICATE_KEY"],
  ])("rejects %s keys with a structured diagnostic", async (_name, contents, code) => {
    await writeFile(before, contents);
    const result = await cli(["diff", before, after, "--key", "id", "--json"]);
    expect(result.exitCode).toBe(6);
    expect(JSON.parse(result.stdout)).toMatchObject({ error: { code } });
  });
});
