import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/main.js";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  readonly cwd: string;
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
}> {
  const cwd = await mkdtemp(join(tmpdir(), "opsi-generate-skills-"));
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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generate-skills", () => {
  it("generates the complete repertoire in the default directory", async () => {
    const value = await fixture();

    await expect(runCli(["generate-skills", "--json"], value.io)).resolves.toBe(0);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: {
        count: 10,
        outputDirectory: join(value.cwd, "skills"),
        skills: expect.arrayContaining(["opsi", "opsi-analysis", "opsi-shared"]),
      },
    });
    expect(await readFile(join(value.cwd, "skills", "opsi", "SKILL.md"), "utf8")).toContain(
      "name: opsi",
    );
    expect(
      await readFile(join(value.cwd, "skills", "opsi-analysis", "SKILL.md"), "utf8"),
    ).toContain("opsi query");
    expect(value.stderr).toEqual([]);
  });

  it("supports absolute paths with spaces and idempotent known-target replacement", async () => {
    const value = await fixture();
    const output = join(value.cwd, "custom skill output");

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(0);
    await writeFile(join(output, "sentinel.txt"), "keep me");
    await writeFile(join(output, "opsi", "SKILL.md"), "stale generated content");
    value.stdout.splice(0);

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(0);

    expect(await readFile(join(output, "sentinel.txt"), "utf8")).toBe("keep me");
    expect(await readFile(join(output, "opsi", "SKILL.md"), "utf8")).toContain(
      "# OPSI orchestrator",
    );
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: { count: 10, outputDirectory: output },
    });
  });

  it("returns a typed invalid-input error when the output directory is a file", async () => {
    const value = await fixture();
    const blocked = join(value.cwd, "blocked");
    await writeFile(blocked, "not a directory");

    await expect(
      runCli(["generate-skills", "--output-dir", blocked, "--json"], value.io),
    ).resolves.toBe(2);

    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "SKILL_OUTPUT_INVALID", exitCode: 2 },
    });
  });
});
