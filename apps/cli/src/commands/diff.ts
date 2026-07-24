import type { KlopsiClient } from "@klopsi/core";
import type { Command } from "commander";
import { manifestCommand } from "../command-manifest.js";
import type { CliContext } from "../context.js";
import { diffEvents, renderDiffHuman } from "../diff-presentation.js";

interface DiffCommandOptions {
  readonly key: readonly string[];
  readonly limit?: number;
  readonly beforeSheet?: string;
  readonly afterSheet?: string;
  readonly beforeEntry?: string;
  readonly afterEntry?: string;
  readonly beforeRecordPath?: string;
  readonly afterRecordPath?: string;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
}

export function registerDiffCommand(
  program: Command,
  context: CliContext,
  client: KlopsiClient,
): void {
  manifestCommand(program, "diff").action(
    async (before: string, after: string, options: DiffCommandOptions) => {
      const global = program.opts() as {
        readonly queryTimeoutMs?: number;
        readonly duckdbMemoryLimit?: string;
        readonly duckdbThreads?: number;
        readonly quiet?: boolean;
      };
      const timeoutMs = context.configuration?.query.timeoutMs ?? global.queryTimeoutMs;
      const memoryLimit = context.configuration?.duckdb.memoryLimit ?? global.duckdbMemoryLimit;
      const threads = context.configuration?.duckdb.threads ?? global.duckdbThreads;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        const result = await client.diff.compare(before, after, {
          key: options.key,
          ...(options.limit === undefined ? {} : { sampleLimit: options.limit }),
          ...(options.beforeSheet === undefined ? {} : { beforeSheet: options.beforeSheet }),
          ...(options.afterSheet === undefined ? {} : { afterSheet: options.afterSheet }),
          ...(options.beforeEntry === undefined ? {} : { beforeEntry: options.beforeEntry }),
          ...(options.afterEntry === undefined ? {} : { afterEntry: options.afterEntry }),
          ...(options.beforeRecordPath === undefined
            ? {}
            : { beforeRecordPath: options.beforeRecordPath }),
          ...(options.afterRecordPath === undefined
            ? {}
            : { afterRecordPath: options.afterRecordPath }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(memoryLimit === undefined ? {} : { memoryLimit }),
          ...(threads === undefined ? {} : { threads }),
          allowInsecureHttp: options.allowInsecureHttp ?? false,
          allowPrivateNetwork: options.allowPrivateNetwork ?? false,
          signal: controller.signal,
        });
        if (global.quiet !== true)
          for (const warning of result.warnings)
            context.io.stderr.write(`warning [${warning.code}]: ${warning.message}\n`);
        if (context.renderer?.format === "human") context.io.stdout.write(renderDiffHuman(result));
        else if (context.renderer?.format === "json") context.renderer.write(result);
        else context.renderer?.write(diffEvents(result));
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    },
  );
}
