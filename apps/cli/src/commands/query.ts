import type { Command } from "commander";
import type { OpsiClient } from "@opsi/core";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerQueryCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  manifestCommand(program, "query").action(
    async (
      input: string,
      options: {
        readonly sql: string;
        readonly limit?: number;
        readonly timeoutMs?: number;
        readonly sheet?: string;
        readonly entry?: string;
        readonly recordPath?: string;
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
        quiet?: boolean;
      };
      const limit = options.limit ?? context.configuration?.query.rowLimit ?? global.queryRowLimit;
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
          ...(options.entry === undefined ? {} : { entry: options.entry }),
          ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
          ...(options.output === undefined ? {} : { output: options.output }),
          force: options.force ?? false,
          allowInsecureHttp: options.allowInsecureHttp ?? false,
          allowPrivateNetwork: options.allowPrivateNetwork ?? false,
          signal: controller.signal,
        });
        if (global.quiet !== true)
          for (const warning of result.warnings)
            context.io.stderr.write(`warning [${warning.code}]: ${warning.message}\n`);
        context.renderer?.write(result.rows, {
          sql: result.sql,
          columns: result.columns,
          returnedCount: result.returnedCount,
          truncated: result.truncated,
          source: result.source,
          durationMs: result.durationMs,
          cache: result.cache,
          ...(result.warnings.length === 0 ? {} : { warnings: result.warnings }),
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
