import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  const cwd = await mkdtemp(join(tmpdir(), "klopsi-generate-skills-"));
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
        count: 13,
        outputDirectory: join(value.cwd, "skills"),
        skills: expect.arrayContaining(["klopsi", "klopsi-analysis", "klopsi-shared"]),
      },
    });
    expect(await readFile(join(value.cwd, "skills", "klopsi", "SKILL.md"), "utf8")).toContain(
      "name: klopsi",
    );
    expect(
      await readFile(join(value.cwd, "skills", "klopsi-analysis", "SKILL.md"), "utf8"),
    ).toContain("klopsi query");
    expect(
      await readFile(
        join(value.cwd, "skills", "klopsi-shared", "references", "presentation-contract.md"),
        "utf8",
      ),
    ).toContain("# KLOPSI dashboard presentation contract");
    expect(
      await readFile(
        join(value.cwd, "skills", "klopsi-shared", "scripts", "verify-dashboard.mjs"),
        "utf8",
      ),
    ).toContain("const MAX_HTML_BYTES = 15 * 1024 * 1024;");
    expect(
      await readFile(
        join(value.cwd, "skills", "klopsi-static-dashboard", "assets", "static-board.html"),
        "utf8",
      ),
    ).toContain("{{PRESENTATION_MANIFEST_JSON}}");
    expect(
      await readFile(
        join(value.cwd, "skills", "klopsi-static-dashboard", "references", "encoding-guide.md"),
        "utf8",
      ),
    ).toContain("known CRS");
    expect(
      await readFile(
        join(
          value.cwd,
          "skills",
          "klopsi-interactive-dashboard",
          "assets",
          "interactive-dashboard.html",
        ),
        "utf8",
      ),
    ).toContain("data-klopsi-filter-region");
    expect(
      await readFile(
        join(
          value.cwd,
          "skills",
          "klopsi-interactive-dashboard",
          "references",
          "interaction-guide.md",
        ),
        "utf8",
      ),
    ).toContain("# Interactive dashboard interaction guide");
    expect(value.stderr).toEqual([]);
  });

  it("supports absolute paths with spaces and idempotent known-target replacement", async () => {
    const value = await fixture();
    const output = join(value.cwd, "custom skill output");

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(0);
    await writeFile(join(output, "sentinel.txt"), "keep me");
    await writeFile(join(output, "klopsi", "SKILL.md"), "stale generated content");
    const nestedSentinel = join(output, "klopsi-shared", "references", "notes.md");
    await writeFile(nestedSentinel, "keep nested notes");
    value.stdout.splice(0);

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(0);

    expect(await readFile(join(output, "sentinel.txt"), "utf8")).toBe("keep me");
    expect(await readFile(nestedSentinel, "utf8")).toBe("keep nested notes");
    expect(await readFile(join(output, "klopsi", "SKILL.md"), "utf8")).toContain(
      "# KLOPSI orchestrator",
    );
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      data: { count: 13, outputDirectory: output },
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

  const symlinkTest: typeof it = process.platform === "win32" ? it.skip : it;

  symlinkTest("rejects a symbolic-link skill directory without following it", async () => {
    const value = await fixture();
    const output = join(value.cwd, "skills");
    const outside = join(value.cwd, "outside");
    await mkdir(output);
    await mkdir(outside);
    await symlink(outside, join(output, "klopsi"));

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(2);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "SKILL_OUTPUT_INVALID", exitCode: 2 },
    });
    await expect(readFile(join(outside, "SKILL.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  symlinkTest(
    "rejects a symbolic-link shared references directory without following it",
    async () => {
      const value = await fixture();
      const output = join(value.cwd, "skills");
      const shared = join(output, "klopsi-shared");
      const outside = join(value.cwd, "outside");
      await mkdir(shared, { recursive: true });
      await mkdir(outside);
      await symlink(outside, join(shared, "references"));

      await expect(
        runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
      ).resolves.toBe(2);
      expect(JSON.parse(value.stdout.join(""))).toMatchObject({
        error: { code: "SKILL_OUTPUT_INVALID", exitCode: 2 },
      });
      await expect(
        readFile(join(outside, "presentation-contract.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  symlinkTest("rejects a symbolic-link generated file without replacing its target", async () => {
    const value = await fixture();
    const output = join(value.cwd, "skills");
    const scripts = join(output, "klopsi-shared", "scripts");
    const outside = join(value.cwd, "outside.mjs");
    await mkdir(scripts, { recursive: true });
    await writeFile(outside, "outside\n");
    await symlink(outside, join(scripts, "verify-dashboard.mjs"));

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(2);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "SKILL_OUTPUT_INVALID", exitCode: 2 },
    });
    expect(await readFile(outside, "utf8")).toBe("outside\n");
  });

  it("returns a typed generation failure when a known file target is a directory", async () => {
    const value = await fixture();
    const output = join(value.cwd, "skills");
    await mkdir(join(output, "klopsi", "SKILL.md"), { recursive: true });

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(1);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "SKILL_GENERATION_FAILED", exitCode: 1 },
    });
  });

  it("returns a typed generation failure when the verifier target is a directory", async () => {
    const value = await fixture();
    const output = join(value.cwd, "skills");
    await mkdir(join(output, "klopsi-shared", "scripts", "verify-dashboard.mjs"), {
      recursive: true,
    });

    await expect(
      runCli(["generate-skills", "--output-dir", output, "--json"], value.io),
    ).resolves.toBe(1);
    expect(JSON.parse(value.stdout.join(""))).toMatchObject({
      error: { code: "SKILL_GENERATION_FAILED", exitCode: 1 },
    });
  });
});
