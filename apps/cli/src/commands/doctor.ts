import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";

const FORMATS = ["csv", "tsv", "json", "ndjson", "xlsx", "parquet"] as const;

function duckDbUnavailable(cause: unknown): OpsiError {
  return new OpsiError({
    code: "DUCKDB_UNAVAILABLE",
    message: `DuckDB native bindings are unavailable for ${process.platform}/${process.arch}.`,
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion:
      "Install optional dependencies on a supported Node 24 platform (Linux x64 glibc, macOS arm64, or Windows x64), then reinstall opsi.",
    cause,
  });
}

export async function checkDuckDb(): Promise<{ readonly ok: true; readonly answer: number }> {
  try {
    const { DuckDBInstance } = await import("@duckdb/node-api");
    const instance = await DuckDBInstance.create(":memory:", {
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
      allow_unsigned_extensions: "false",
    });
    const connection = await instance.connect();
    try {
      const reader = await connection.runAndReadAll("SELECT 42 AS answer");
      const row = reader.getRowObjects()[0] as { answer?: number | bigint } | undefined;
      return { ok: true, answer: Number(row?.answer) };
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  } catch (error) {
    throw duckDbUnavailable(error);
  }
}

async function writable(directory: string): Promise<void> {
  const probe = join(directory, `.doctor-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(probe, "ok", { flag: "wx" });
  await access(probe);
  await rm(probe, { force: true });
}

export function registerDoctorCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  program
    .command("doctor")
    .description("Run installation and environment diagnostics")
    .option("--offline", "skip connectivity checks")
    .action(async (options: { offline?: boolean }) => {
      const cacheDir = context.configuration?.paths.cacheDir ?? join(tmpdir(), "opsi-cache");
      await writable(cacheDir);
      await writable(tmpdir());
      const offline = options.offline === true || context.configuration?.offline === true;
      const connectivity = offline
        ? { skipped: true, reason: "offline" }
        : await client.search({ limit: 1 }).then(() => ({ ok: true }));
      context.renderer?.write({
        node: {
          ok: Number(process.versions.node.split(".")[0]) >= 24,
          version: process.versions.node,
        },
        configuration: { ok: context.configuration !== undefined },
        filesystem: { ok: true, cacheDir, tempDir: tmpdir() },
        connectivity,
        duckdb: await checkDuckDb(),
        formats: FORMATS.map((format) => ({ format, ok: true })),
      });
    });
}
