import { InvalidArgumentError, type Command } from "commander";
import type { OpsiClient } from "@opsi/core";
import type { CliContext } from "../context.js";

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}

export function registerQueryCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  program
    .command("query")
    .description("Run one sandboxed read-only query over tabular data")
    .argument("<input>", "local path or canonical resource reference")
    .requiredOption("--sql <query>", "one SELECT, WITH ... SELECT, or VALUES statement")
    .option("--limit <rows>", "maximum returned rows", positiveInteger)
    .option("--timeout-ms <milliseconds>", "hard query deadline", positiveInteger)
    .option("--sheet <name>", "XLSX sheet name")
    .option("--output <path>", "export bounded results (.csv, .tsv, .json, .ndjson)")
    .option("--force", "replace an existing output")
    .option("--allow-insecure-http", "allow HTTP for this invocation")
    .option("--allow-private-network", "allow private network addresses for this invocation")
    .action(
      async (
        input: string,
        options: {
          readonly sql: string;
          readonly limit?: number;
          readonly timeoutMs?: number;
          readonly sheet?: string;
          readonly output?: string;
          readonly force?: boolean;
          readonly allowInsecureHttp?: boolean;
          readonly allowPrivateNetwork?: boolean;
        },
      ) => {
        const global = program.opts() as {
          queryRowLimit?: number;
          queryTimeoutMs?: number;
          duckdbMemoryLimit?: string;
          duckdbThreads?: number;
        };
        const limit =
          options.limit ?? context.configuration?.query.rowLimit ?? global.queryRowLimit;
        const timeoutMs =
          options.timeoutMs ?? context.configuration?.query.timeoutMs ?? global.queryTimeoutMs;
        const memoryLimit = context.configuration?.duckdb.memoryLimit ?? global.duckdbMemoryLimit;
        const threads = context.configuration?.duckdb.threads ?? global.duckdbThreads;
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.once("SIGINT", cancel);
        process.once("SIGTERM", cancel);
        try {
          const result = await client.query.execute(input, {
            sql: options.sql,
            ...(limit === undefined ? {} : { limit }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(memoryLimit === undefined ? {} : { memoryLimit }),
            ...(threads === undefined ? {} : { threads }),
            ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
            ...(options.output === undefined ? {} : { output: options.output }),
            force: options.force ?? false,
            allowInsecureHttp: options.allowInsecureHttp ?? false,
            allowPrivateNetwork: options.allowPrivateNetwork ?? false,
            signal: controller.signal,
          });
          context.renderer?.write(result.rows, {
            sql: result.sql,
            columns: result.columns,
            returnedCount: result.returnedCount,
            truncated: result.truncated,
            source: result.source,
            durationMs: result.durationMs,
            ...(result.output === undefined
              ? {}
              : { output: result.output, provenancePath: result.provenancePath }),
          });
        } finally {
          process.removeListener("SIGINT", cancel);
          process.removeListener("SIGTERM", cancel);
        }
      },
    );
}
