import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogueSnapshotClient } from "@opsi/catalogue-snapshot";
import type { OutputFormat } from "@opsi/output";
import { Renderer } from "@opsi/output";
import type { CliContext } from "../src/context.js";
import { createProgram } from "../src/program.js";

const result = {
  datasets: [
    { id: "d0", title: "First", name: "alpha" },
    { id: "d1", title: "Second", name: "beta" },
  ],
  generatedAt: "2026-07-13T08:00:00.000Z",
  source: "snapshot-remote" as const,
};

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.close();
      await once(server, "close");
    }),
  );
});

function fixture(
  format: OutputFormat,
  options: {
    readonly baseUrl?: string;
    readonly fields?: readonly string[];
    readonly offline?: boolean;
  } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const catalogue = { list: vi.fn(async () => result) };
  const renderer = new Renderer({
    format,
    stdout: { write: (chunk) => void stdout.push(chunk) },
    ...(options.fields === undefined ? {} : { fields: options.fields }),
  });
  const context = {
    version: "1.0.0",
    io: {
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      env: {
        OPSI_REQUEST_INTERVAL_MS: "0",
        ...(options.baseUrl === undefined ? {} : { OPSI_BASE_URL: options.baseUrl }),
      },
    },
    renderer,
    ...(options.offline === true
      ? {
          configuration: {
            provider: "opsi",
            output: format,
            locale: "sl-SI",
            offline: true,
            paths: { cacheDir: ".opsi-cache", downloadDir: ".opsi-downloads" },
            http: { timeoutMs: 30_000, maxDownloadBytes: 2 * 1024 * 1024 * 1024 },
            preview: { rowLimit: 20 },
            query: { rowLimit: 1_000, timeoutMs: 30_000 },
            duckdb: { memoryLimit: "1GB", threads: 4 },
            terminal: { color: false },
          },
        }
      : {}),
  } as unknown as CliContext;
  const program = createProgram(context, {
    catalogue: catalogue as Pick<CatalogueSnapshotClient, "list">,
  });
  return { catalogue, program, stderr, stdout };
}

describe("snapshot-backed dataset list", () => {
  it.each([
    ["human" as const, "id  title   name \nd0  First   alpha\nd1  Second  beta \n"],
    [
      "ndjson" as const,
      '{"id":"d0","title":"First","name":"alpha"}\n{"id":"d1","title":"Second","name":"beta"}\n',
    ],
    ["csv" as const, "id,title,name\nd0,First,alpha\nd1,Second,beta\n"],
    ["tsv" as const, "id\ttitle\tname\nd0\tFirst\talpha\nd1\tSecond\tbeta\n"],
  ])("renders the complete snapshot as %s", async (format, expected) => {
    const value = fixture(format);

    await value.program.parseAsync(["dataset", "list"], { from: "user" });

    expect(value.stdout.join("")).toBe(expected);
    expect(value.stderr).toEqual([]);
    expect(value.catalogue.list).toHaveBeenCalledWith({ refresh: false });
  });

  it("renders JSON with snapshot source and freshness metadata", async () => {
    const value = fixture("json");

    await value.program.parseAsync(["dataset", "list"], { from: "user" });

    expect(JSON.parse(value.stdout.join(""))).toEqual({
      schemaVersion: "1",
      data: result.datasets,
      meta: {
        total: 2,
        count: 2,
        source: "snapshot-remote",
        generatedAt: "2026-07-13T08:00:00.000Z",
        stale: false,
      },
    });
  });

  it("preserves supported field order", async () => {
    const value = fixture("csv", { fields: ["name", "id"] });

    await value.program.parseAsync(["dataset", "list"], { from: "user" });

    expect(value.stdout.join("")).toBe("name,id\nalpha,d0\nbeta,d1\n");
  });

  it("passes explicit refresh to the snapshot client", async () => {
    const value = fixture("json");

    await value.program.parseAsync(["dataset", "list", "--refresh"], { from: "user" });

    expect(value.catalogue.list).toHaveBeenCalledWith({ refresh: true });
  });

  it("rejects conflicting live and refresh modes", async () => {
    const value = fixture("json");

    await expect(
      value.program.parseAsync(["dataset", "list", "--live", "--refresh"], { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.conflictingOption" });
    expect(value.catalogue.list).not.toHaveBeenCalled();
  });

  it("rejects explicit live mode while offline", async () => {
    const value = fixture("json", { offline: true });

    await expect(
      value.program.parseAsync(["dataset", "list", "--live", "--offline"], { from: "user" }),
    ).rejects.toMatchObject({ code: "CATALOGUE_LIVE_OFFLINE", exitCode: 2 });
    expect(value.catalogue.list).not.toHaveBeenCalled();
  });

  it("does not search the provider in normal snapshot mode", async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(500).end();
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("fixture failed");

    const value = fixture("json", { baseUrl: `http://127.0.0.1:${address.port}` });
    await value.program.parseAsync(["dataset", "list"], { from: "user" });

    expect(requests).toEqual([]);
    expect(value.catalogue.list).toHaveBeenCalledOnce();
  });
});
