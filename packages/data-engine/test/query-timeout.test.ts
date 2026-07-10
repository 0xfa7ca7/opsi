import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuckDbQueryRunner } from "../src/query.js";

let directory: string;
let input: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "opsi-query-timeout-"));
  input = join(directory, "data.csv");
  await writeFile(input, "value\n1\n");
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe("DuckDbQueryRunner deadlines", () => {
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
    const runner = new DuckDbQueryRunner({
      workerPath: new URL("./fixtures/query-worker-source-entry.ts", import.meta.url),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runner.execute({ input, sql: "SELECT * FROM data", signal: controller.signal }),
    ).rejects.toMatchObject({ code: "QUERY_CANCELLED", exitCode: 7 });
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
