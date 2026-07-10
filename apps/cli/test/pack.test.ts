import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);
let root: string;
let omittedRoot: string | undefined;
let tarball: string;
let files: Array<{ path: string; mode: number }>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "opsi-pack-"));
  const packed = await execute("npm", ["pack", "--json", "--pack-destination", root], {
    cwd: resolve(process.cwd(), "apps/cli"),
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(packed.stdout) as Array<{
    filename: string;
    files: Array<{ path: string; mode: number }>;
  }>;
  tarball = join(root, result[0]?.filename ?? "missing.tgz");
  files = result[0]?.files ?? [];
});

afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  if (omittedRoot !== undefined) await rm(omittedRoot, { recursive: true, force: true });
});

describe("canonical npm tarball", () => {
  it("contains only the public runtime, SDK, and package documentation", async () => {
    const paths = files.map((file) => file.path).sort();
    expect(paths).toContain("dist/main.js");
    expect(paths).toContain("dist/query-worker.js");
    expect(paths).toContain("dist/sdk.js");
    expect(paths).toContain("dist/sdk.d.ts");
    expect(paths.map((path) => path.toLowerCase())).toEqual(
      expect.arrayContaining(["readme.md", "license"]),
    );
    expect(
      paths.every((path) => /^(?:dist\/|package\.json$|readme\.md$|license$)/iu.test(path)),
    ).toBe(true);
    expect(paths.some((path) => /(?:test|fixture|\.tsbuildinfo)/iu.test(path))).toBe(false);
    expect(files.find((file) => file.path === "dist/main.js")?.mode & 0o111).toBeGreaterThan(0);

    const metadata = JSON.parse(
      await readFile(resolve(process.cwd(), "apps/cli/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      name: "opsi",
      license: "MIT",
      engines: { node: ">=24.0.0" },
      repository: { type: "git" },
    });
    expect(JSON.stringify(metadata)).not.toContain("workspace:");
    for (const file of files.filter((entry) => /\.(?:js|d\.ts|map)$/u.test(entry.path))) {
      const unpacked = await execute("tar", ["-xOf", tarball, `package/${file.path}`], {
        maxBuffer: 20 * 1024 * 1024,
      });
      expect(unpacked.stdout).not.toMatch(/(?:\/Users\/|[A-Z]:\\|workspace:)/u);
      if (file.path.endsWith(".js"))
        expect(unpacked.stdout).not.toMatch(/(?:from\s*|import\s*\()\s*["']@opsi\//u);
      expect(unpacked.stdout).not.toMatch(/(?:api[_-]?key|token|secret)\s*[=:]\s*['"][^'"]+/iu);
    }
  });

  it("installs the exact tarball cleanly and smokes CLI, native formats, and SDK", async () => {
    await execute("npm", ["init", "-y"], { cwd: root });
    await execute("npm", ["install", tarball], { cwd: root, timeout: 120_000 });
    const binary = join(
      root,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "opsi.cmd" : "opsi",
    );
    if (process.platform !== "win32") await chmod(binary, 0o755);
    expect((await stat(binary)).isFile()).toBe(true);
    expect((await execute(binary, ["--version"], { cwd: root })).stdout).toMatch(/^0\.1\.0\n$/u);
    expect(
      JSON.parse((await execute(binary, ["doctor", "--json", "--offline"], { cwd: root })).stdout),
    ).toMatchObject({ data: { duckdb: { ok: true } } });
    const csv = resolve(process.cwd(), "packages/testing/fixtures/data/valid.csv");
    expect(
      JSON.parse(
        (
          await execute(binary, ["query", csv, "--sql", "select 42 as answer", "--json"], {
            cwd: root,
          })
        ).stdout,
      ),
    ).toMatchObject({ data: [{ answer: 42 }] });
    const xlsx = resolve(process.cwd(), "packages/testing/fixtures/data/data.xlsx");
    expect(
      JSON.parse(
        (
          await execute(binary, ["resource", "preview", xlsx, "--sheet", "Cities", "--json"], {
            cwd: root,
          })
        ).stdout,
      ).data.length,
    ).toBeGreaterThan(0);
    const sdk = await execute(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import('opsi/sdk').then(m=>{if(!m.OpsiClient||!m.ProviderRegistry)process.exit(1)})",
      ],
      { cwd: root },
    );
    expect(sdk.stderr).toBe("");
  });

  it("reports a typed failure when optional DuckDB dependencies are omitted", async () => {
    const omitted = await mkdtemp(join(tmpdir(), "opsi-pack-omitted-"));
    omittedRoot = omitted;
    await execute("npm", ["init", "-y"], { cwd: omitted });
    await execute("npm", ["install", "--omit=optional", tarball], {
      cwd: omitted,
      timeout: 120_000,
    });
    const binary = join(
      omitted,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "opsi.cmd" : "opsi",
    );
    await expect(
      execute(binary, ["doctor", "--json", "--offline"], { cwd: omitted }),
    ).rejects.toMatchObject({
      code: 5,
      stdout: expect.stringContaining("DUCKDB_UNAVAILABLE"),
    });
  });
});
