import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbQueryRunner } from "../src/query.js";
import { stageTabularInput } from "../src/tabular-stage.js";

let directory: string;
let input: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "opsi-query-timeout-"));
  input = join(directory, "data.csv");
  await writeFile(input, "value\n1\n");
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe("DuckDbQueryRunner deadlines", () => {
  it("cancels an injected slow import before any child starts and removes its directory", async () => {
    let invocationDirectory: string | undefined;
    let stageStarted!: () => void;
    const started = new Promise<void>((resolve) => (stageStarted = resolve));
    const controller = new AbortController();
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/hanging-query-worker.mjs", import.meta.url),
      makeTemporaryDirectory: async () => {
        invocationDirectory = await mkdtemp(join(tmpdir(), "opsi-query-injected-"));
        return invocationDirectory;
      },
      stage: async (options) => {
        stageStarted();
        return await new Promise((_, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("cancelled import"), { name: "AbortError" })),
            { once: true },
          );
        });
      },
    });
    const query = runner.execute({ input, sql: "SELECT 1", signal: controller.signal });
    await started;
    controller.abort();
    await expect(query).rejects.toMatchObject({ code: "QUERY_CANCELLED", exitCode: 7 });
    if (invocationDirectory === undefined) throw new Error("missing captured directory");
    await expect(access(invocationDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("closes a writable stage and removes its directory after CHECKPOINT failure", async () => {
    let invocationDirectory: string | undefined;
    let closed = 0;
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/hanging-query-worker.mjs", import.meta.url),
      makeTemporaryDirectory: async () => {
        invocationDirectory = await mkdtemp(join(tmpdir(), "opsi-query-checkpoint-"));
        return invocationDirectory;
      },
      stage: async () =>
        ({
          connection: { run: async () => Promise.reject(new Error("checkpoint failed")) },
          close: async () => {
            closed += 1;
          },
          columns: [],
          sourceFormat: "csv",
          inputPath: input,
          warnings: [],
        }) as never,
    });
    await expect(runner.execute({ input, sql: "SELECT 1" })).rejects.toThrow("checkpoint failed");
    expect(closed).toBe(1);
    if (invocationDirectory === undefined) throw new Error("missing captured directory");
    await expect(access(invocationDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("surfaces typed cleanup failures instead of swallowing them", async () => {
    let retainedDirectory: string | undefined;
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
      makeTemporaryDirectory: async () => {
        retainedDirectory = await mkdtemp(join(tmpdir(), "opsi-query-cleanup-failure-"));
        return retainedDirectory;
      },
      removeTemporaryDirectory: async () => Promise.reject(new Error("sharing violation")),
    });
    await expect(runner.execute({ input, sql: "SELECT 1" })).rejects.toMatchObject({
      code: "QUERY_CLEANUP_FAILED",
      exitCode: 7,
      context: expect.objectContaining({ message: "sharing violation" }),
    });
    if (retainedDirectory !== undefined)
      await rm(retainedDirectory, { recursive: true, force: true });
  });
  it("enforces a hard child-process deadline", async () => {
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    const started = Date.now();
    await expect(
      runner.execute({
        input,
        sql: "SELECT sum(a.i * b.i) FROM range(1000000000) a(i), range(1000000000) b(i)",
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "QUERY_TIMEOUT", exitCode: 7 });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("enforces the same deadline for prepared databases", async () => {
    const databasePath = join(directory, "prepared-timeout.duckdb");
    const stage = await stageTabularInput({
      input,
      databasePath,
      xlsxRowsPath: join(directory, "prepared-timeout.ndjson"),
      xlsxSharedStringsByteLimit: 1024 * 1024,
      preserveDatabaseOnClose: true,
    });
    await stage.connection.run("CHECKPOINT");
    await stage.close();
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    await expect(
      runner.executePrepared({
        databasePath,
        invocationDirectory: directory,
        sql: "SELECT sum(a.i * b.i) FROM range(1000000000) a(i), range(1000000000) b(i)",
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "QUERY_TIMEOUT", exitCode: 7 });
  });

  it("force-kills a worker that ignores the interrupt grace period", async () => {
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/hanging-query-worker.mjs", import.meta.url),
      graceMs: 50,
    });
    const started = Date.now();
    await expect(
      runner.execute({ input, sql: "SELECT * FROM data", timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "QUERY_TIMEOUT", exitCode: 7 });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("interrupts and cleans up when the caller aborts", async () => {
    let directoriesCreated = 0;
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
      makeTemporaryDirectory: async () => {
        directoriesCreated += 1;
        return await mkdtemp(join(tmpdir(), "opsi-query-preabort-"));
      },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runner.execute({ input, sql: "SELECT * FROM data", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "QUERY_CANCELLED", exitCode: 7 });
    expect(directoriesCreated).toBe(0);
  });

  it("lets a successful worker close its IPC and process handles promptly", async () => {
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    const started = Date.now();
    await runner.execute({ input, sql: "SELECT * FROM data" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
