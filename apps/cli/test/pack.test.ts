import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);
let root: string;
let omittedRoot: string | undefined;
let tarball: string;
let files: Array<{ path: string; mode: number }>;
let packDestination: string;

const EXPECTED_FILES = [
  "LICENSE",
  "README.md",
  "dist/main.d.ts",
  "dist/main.js",
  "dist/main.js.map",
  "dist/query-worker.d.ts",
  "dist/query-worker.js",
  "dist/query-worker.js.map",
  "dist/sdk.d.ts",
  "dist/sdk.js",
  "dist/sdk.js.map",
  "package.json",
] as const;

async function tarText(path: string): Promise<string> {
  return (
    await execute("tar", ["-xOf", tarball, `package/${path}`], {
      maxBuffer: 30 * 1024 * 1024,
    })
  ).stdout;
}

async function compileSdkConsumer(directory: string): Promise<void> {
  await writeFile(
    join(directory, "consumer.ts"),
    "import { OpsiClient, ProviderRegistry, type Dataset, type SearchQuery } from 'opsi/sdk';\nconst registry = new ProviderRegistry([]);\nconst client: OpsiClient = new OpsiClient({ registry, providerId: 'opsi' });\nconst query: SearchQuery = { text: 'promet' };\nconst dataset: Dataset | undefined = undefined;\nvoid [client, query, dataset];\n",
  );
  await writeFile(
    join(directory, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2024", skipLibCheck: false }, include: ["consumer.ts"] }, null, 2)}\n`,
  );
  await execute(join(directory, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
    cwd: directory,
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "opsi-pack-"));
  packDestination = process.env.OPSI_PACK_DESTINATION ?? root;
  await mkdir(packDestination, { recursive: true });
  const packed = await execute("npm", ["pack", "--json", "--pack-destination", packDestination], {
    cwd: resolve(process.cwd(), "apps/cli"),
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(packed.stdout) as Array<{
    filename: string;
    files: Array<{ path: string; mode: number }>;
  }>;
  tarball = join(packDestination, result[0]?.filename ?? "missing.tgz");
  files = result[0]?.files ?? [];
  if (process.env.OPSI_PACK_DESTINATION !== undefined)
    await writeFile(join(packDestination, "pack.json"), `${JSON.stringify(result, null, 2)}\n`);
});

afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  if (omittedRoot !== undefined) await rm(omittedRoot, { recursive: true, force: true });
});

describe("canonical npm tarball", () => {
  it("contains only the public runtime, SDK, and package documentation", async () => {
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual([...EXPECTED_FILES].sort());
    expect(paths.some((path) => /(?:test|fixture|\.tsbuildinfo)/iu.test(path))).toBe(false);
    expect(files.find((file) => file.path === "dist/main.js")?.mode & 0o111).toBeGreaterThan(0);

    const metadata = JSON.parse(await tarText("package.json")) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      name: "opsi",
      license: "MIT",
      engines: { node: ">=24.0.0" },
      repository: { type: "git" },
    });
    expect(JSON.stringify(metadata)).not.toContain("workspace:");
    expect(await tarText("dist/main.js")).toMatch(/^#!\/usr\/bin\/env node\n/u);
    for (const file of files.filter((entry) => /\.(?:js|d\.ts|map)$/u.test(entry.path))) {
      const unpacked = await tarText(file.path);
      expect(unpacked).not.toMatch(/(?:\/Users\/|[A-Z]:\\|workspace:)/u);
      if (file.path.endsWith(".js")) {
        expect(unpacked).not.toMatch(/(?:from\s*|import\s*\()\s*["']@opsi\//u);
        expect(unpacked).not.toMatch(/import\.meta\.resolve\(\s*["']@opsi\//u);
      }
      if (file.path.endsWith(".d.ts"))
        expect(unpacked).not.toMatch(/(?:@opsi\/|@duckdb\/node-api|from\s+["']zod["'])/u);
      expect(unpacked).not.toMatch(/(?:api[_-]?key|token|secret)\s*[=:]\s*['"][^'"]+/iu);
    }
  });

  it("installs the exact tarball cleanly and smokes CLI, native formats, and SDK", async () => {
    await execute("npm", ["init", "-y"], { cwd: root });
    await execute("npm", ["install", tarball, "typescript@6.0.3"], {
      cwd: root,
      timeout: 120_000,
    });
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
    ).toMatchObject({ data: { status: "pass" } });
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
    await compileSdkConsumer(root);
  });

  it("reports a typed failure when optional DuckDB dependencies are omitted", async () => {
    const omitted = await mkdtemp(join(tmpdir(), "opsi-pack-omitted-"));
    omittedRoot = omitted;
    await execute("npm", ["init", "-y"], { cwd: omitted });
    await execute("npm", ["install", "--omit=optional", tarball, "typescript@6.0.3"], {
      cwd: omitted,
      timeout: 120_000,
    });
    const binary = join(
      omitted,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "opsi.cmd" : "opsi",
    );
    let nativeFailure: (Error & { code?: number; stdout?: string }) | undefined;
    try {
      await execute(binary, ["doctor", "--json", "--offline"], { cwd: omitted });
    } catch (error) {
      nativeFailure = error as Error & { code?: number; stdout?: string };
    }
    expect(nativeFailure).toMatchObject({
      code: 5,
      stdout: expect.stringContaining("DUCKDB_UNAVAILABLE"),
    });
    const report = JSON.parse(nativeFailure?.stdout ?? "") as {
      data: { checks: Array<{ name: string; status: string }> };
    };
    expect(report.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "format:csv", status: "pass" }),
        expect.objectContaining({ name: "format:xlsx", status: "pass" }),
        expect.objectContaining({ name: "format:parquet", status: "fail" }),
      ]),
    );
    await compileSdkConsumer(omitted);
  });
});
