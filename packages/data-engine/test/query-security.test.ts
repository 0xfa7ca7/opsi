import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbQueryRunner } from "../src/query.js";
import { executeQueryWorker } from "../src/query-worker.js";
import { stageTabularInput } from "../src/tabular-stage.js";

let directory: string;
let input: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "opsi-query-security-"));
  input = join(directory, "data.csv");
  await writeFile(input, "name,value\na,1\nb,2\nc,3\n");
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe("DuckDbQueryRunner security", () => {
  it("documents DuckDB 1.5 rejecting an explicit temp directory on read-only open", async () => {
    const database = join(directory, "probe.duckdb");
    const writable = await DuckDBInstance.create(database);
    const writableConnection = await writable.connect();
    await writableConnection.run("CREATE TABLE data AS SELECT 1 AS value");
    writableConnection.closeSync();
    writable.closeSync();
    await mkdir(join(directory, "spill"));
    await expect(async () => {
      const readOnly = await DuckDBInstance.create(database, {
        access_mode: "READ_ONLY",
        enable_external_access: "false",
        autoinstall_known_extensions: "false",
        autoload_known_extensions: "false",
        allow_community_extensions: "false",
        memory_limit: "1GB",
        temp_directory: join(directory, "spill"),
      });
      try {
        await readOnly.connect();
      } finally {
        readOnly.closeSync();
      }
    }).rejects.toThrow("Failed to set config");
  });
  it.each([
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM read_text('/etc/passwd')",
    "SELECT * FROM read_blob('/etc/passwd')",
    "SELECT * FROM read_json('/etc/passwd')",
    "SELECT * FROM read_parquet('/etc/passwd')",
    "SELECT * FROM glob('/etc/*')",
    "SELECT * FROM read_csv('https://example.invalid/data.csv')",
  ])("denies external reads: %s", async (sql) => {
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    await expect(runner.execute({ input, sql })).rejects.toMatchObject({ exitCode: 7 });
  });

  it("imports only data and applies limit plus one truncation", async () => {
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    await expect(
      runner.execute({ input, sql: "SELECT * FROM data ORDER BY value", rowLimit: 2 }),
    ).resolves.toMatchObject({
      columns: ["name", "value"],
      rows: [
        { name: "a", value: "1" },
        { name: "b", value: "2" },
      ],
      returnedCount: 2,
      truncated: true,
      sql: "SELECT * FROM data ORDER BY value",
    });
  });

  it("locks security and resource settings before parsing user SQL", async () => {
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    const result = await runner.execute({
      input,
      sql: `SELECT
        current_setting('enable_external_access') AS external,
        current_setting('autoinstall_known_extensions') AS autoinstall,
        current_setting('autoload_known_extensions') AS autoload,
        current_setting('allow_community_extensions') AS community,
        current_setting('lock_configuration') AS locked`,
    });
    expect(result.rows).toEqual([
      { external: false, autoinstall: false, autoload: false, community: false, locked: true },
    ]);
    await expect(
      runner.execute({ input, sql: "SELECT set_config('enable_external_access', 'true', false)" }),
    ).rejects.toMatchObject({ exitCode: 7 });
  });

  it("caps columns, cells, and total serialized output", async () => {
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    await expect(
      runner.execute({ input, sql: "SELECT repeat('x', 100) AS huge FROM data", maxCellBytes: 16 }),
    ).rejects.toMatchObject({ code: "QUERY_CELL_LIMIT", exitCode: 7 });
    await expect(
      runner.execute({ input, sql: "SELECT * FROM data", maxColumns: 1 }),
    ).rejects.toMatchObject({ code: "QUERY_COLUMN_LIMIT", exitCode: 7 });
    await expect(
      runner.execute({ input, sql: "SELECT * FROM data", maxOutputBytes: 20 }),
    ).rejects.toMatchObject({ code: "QUERY_OUTPUT_LIMIT", exitCode: 7 });
  });

  it("does not modify the trusted input", async () => {
    const beforeBytes = await readFile(input);
    const before = await stat(input);
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    await runner.execute({ input, sql: "SELECT count(*) AS count FROM data" });
    expect(await readFile(input)).toEqual(beforeBytes);
    expect((await stat(input)).mtimeMs).toBe(before.mtimeMs);
  });

  it("keeps the imported database byte-for-byte stable in read-only execution", async () => {
    const databasePath = join(directory, "stable.duckdb");
    const stage = await stageTabularInput({
      input,
      databasePath,
      xlsxRowsPath: join(directory, "xlsx.ndjson"),
      xlsxSharedStringsByteLimit: 1024 * 1024,
      preserveDatabaseOnClose: true,
    });
    await stage.connection.run("CHECKPOINT");
    await stage.close();
    const before = await readFile(databasePath);
    const beforeStat = await stat(databasePath);
    await executeQueryWorker({
      databasePath,
      invocationDirectory: directory,
      sql: "SELECT count(*) FROM data",
      limits: {
        rowLimit: 10,
        timeoutMs: 1_000,
        maxSqlBytes: 1024,
        maxColumns: 10,
        maxCellBytes: 1024,
        maxOutputBytes: 1024,
        memoryLimit: "128MB",
        threads: 1,
      },
    });
    expect(await readFile(databasePath)).toEqual(before);
    expect((await stat(databasePath)).mtimeMs).toBe(beforeStat.mtimeMs);
  });
});
