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
    `import {
  OpsiClient,
  ProviderRegistry,
  type CanonicalReference,
  type Dataset,
  type DatasetId,
  type DownloadRecord,
  type Field,
  type ParsedCanonicalReference,
  type ProviderId,
  type Provenance,
  type QueryResult,
  type ResourceId,
  type SearchQuery,
  type ValidationIssue,
  type ValidationResult,
} from 'opsi/sdk';

const providerId = 'opsi' as ProviderId;
const datasetId = 'traffic' as DatasetId;
const resourceId = 'traffic-csv' as ResourceId;
const reference = 'opsi:resource:traffic-csv' as CanonicalReference;
const field: Field = { name: 'count', type: 'integer', nullable: false, description: 'Vehicles' };
const issue: ValidationIssue = {
  code: 'MISSING_VALUE',
  message: 'A value is missing.',
  severity: 'warning',
  row: 2,
  field: field.name,
  context: { expected: field.type },
};
const validation: ValidationResult = {
  valid: true,
  errors: [],
  warnings: [issue],
  recommendations: [],
  schema: { fields: [field], rowCount: 1 },
};
const provenance: Provenance = {
  schemaVersion: '1',
  providerId,
  datasetId,
  resourceId,
  retrievedAt: '2026-01-01T00:00:00.000Z',
  sha256: 'a'.repeat(64),
  localPath: '/tmp/traffic.csv',
  transformations: [{ operation: 'download', timestamp: '2026-01-01T00:00:00.000Z' }],
};
const download: DownloadRecord = {
  file: { path: provenance.localPath, sha256: provenance.sha256, sizeBytes: 42, source: reference },
  source: reference,
  downloadedAt: provenance.retrievedAt,
  provenance,
};
const queryResult: QueryResult = {
  sql: 'select count from data',
  columns: [field.name],
  rows: [{ count: 42 }],
  returnedCount: 1,
  durationMs: 2,
  truncated: false,
  source: reference,
  provenance,
};
const dataset: Dataset = {
  id: datasetId,
  providerId,
  title: 'Traffic',
  providerMetadata: { raw: { source: 'catalog' } },
  resources: [{
    id: resourceId,
    datasetId,
    providerId,
    title: 'CSV',
    url: 'https://example.invalid/traffic.csv',
    providerMetadata: { raw: { table: 'traffic' } },
  }],
};
const parsed: ParsedCanonicalReference = { providerId, kind: 'resource', id: resourceId };
if (parsed.kind === 'resource') parsed.id.toUpperCase();

const registry = new ProviderRegistry([]);
const client: OpsiClient = new OpsiClient({
  registry,
  providerId,
  downloads: { downloadDir: '/tmp', limits: { maxBytes: 1_000, timeoutMs: 1_000 } },
});
const search: SearchQuery = { text: 'promet', filters: { formats: ['csv'] } };
const operations = [
  client.search(search).then((page) => page.items[0]?.providerMetadata?.raw),
  client.datasets.get(datasetId).then((item) => item.resources[0]?.providerMetadata?.raw),
  client.datasets.resources(datasetId).then((items) => items[0]?.mediaType),
  client.resources.get(resourceId).then((item) => item.providerMetadata?.raw),
  client.providers.list(),
  client.downloads?.resource(resourceId, { destination: '/tmp/traffic.csv' }).then((item) => item.provenancePath),
  client.downloads?.headers(resourceId, { allowPrivateNetwork: false }).then((probe) => probe.headers),
  client.cache?.info().then((info) => info.root),
  client.cache?.list().then((items) => items[0]?.bytes),
  client.cache?.clear(),
  client.cache?.prune().then((result) => result.removed),
  client.cache?.verify().then((result) => result.errors[0]),
  client.data.withResolvedInput('/tmp/traffic.csv', {}, async (source) => typeof source === 'string' ? source : source.path),
  client.data.inspect('/tmp/traffic.csv').then((inspection) => inspection.confidence),
  client.data.preview('/tmp/traffic.csv', { limit: 5 }).then((preview) => preview.warnings[0]?.recommendation),
  client.data.inferSchema('/tmp/traffic.csv', { limit: 5 }).then((schema) => schema.fields[0]?.evidence),
  client.data.validate('/tmp/traffic.csv').then((result) => result.schema?.fields[0]?.nullable),
  client.data.convert('/tmp/traffic.csv', { output: '/tmp/traffic.json', targetFormat: 'json' }).then((result) => result.warnings),
  client.conversions.convert('/tmp/traffic.csv', { output: '/tmp/traffic.tsv', targetFormat: 'tsv' }).then((result) => result.provenancePath),
  client.query.execute('/tmp/traffic.csv', { sql: 'select * from data', limit: 5 }).then((result) => [result.source, result.durationMs]),
];
void [dataset.providerMetadata?.raw.source, validation.schema?.fields[0]?.nullable,
  download.provenance.transformations[0]?.operation, queryResult.rows[0]?.count, operations];
`,
  );
  await writeFile(
    join(directory, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2024", skipLibCheck: false }, include: ["consumer.ts"] }, null, 2)}\n`,
  );
  try {
    await execute(join(directory, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], {
      cwd: directory,
    });
  } catch (error) {
    const failure = error as Error & { readonly stdout?: string; readonly stderr?: string };
    throw new Error([failure.message, failure.stdout, failure.stderr].filter(Boolean).join("\n"), {
      cause: error,
    });
  }
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
    expect(
      paths.filter(
        (path) =>
          /(?:^|\/)(?:latest|index)\.json$/u.test(path) ||
          /(?:^|\/)v1\/snapshots\/[^/]+\.json$/u.test(path) ||
          /(?:^|\/)catalogue-snapshot(?:\/|$)/u.test(path),
      ),
    ).toEqual([]);
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
    const sdkDeclaration = await tarText("dist/sdk.d.ts");
    expect(sdkDeclaration).not.toMatch(
      /readonly (?:data|conversions|query): unknown|type (?:DownloadRecord|Provenance|QueryResult|ValidationIssue|ValidationResult|ParsedCanonicalReference) = Readonly<Record<string, unknown>>/u,
    );
    expect(sdkDeclaration).toContain("readonly downloads?: DownloadService");
    expect(sdkDeclaration).toContain("readonly cache?: CacheService");
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
    const datasetListHelp = (await execute(binary, ["dataset", "list", "--help"], { cwd: root }))
      .stdout;
    expect(datasetListHelp).toContain("--refresh");
    expect(datasetListHelp).toContain("--live");
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
