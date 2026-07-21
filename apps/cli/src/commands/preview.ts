import type { KlopsiClient } from "@klopsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerResourcePreviewCommand(
  program: Command,
  context: CliContext,
  client: KlopsiClient,
): void {
  manifestCommand(program, "resource preview").action(
    async (
      input: string,
      options: {
        readonly limit?: number;
        readonly sheet?: string;
        readonly entry?: string;
        readonly recordPath?: string;
        readonly allowInsecureHttp?: boolean;
        readonly allowPrivateNetwork?: boolean;
      },
    ) => {
      const preview = await client.data.preview(input, {
        limit: options.limit ?? context.configuration?.preview.rowLimit ?? 20,
        ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
        ...(options.entry === undefined ? {} : { entry: options.entry }),
        ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
        allowInsecureHttp: options.allowInsecureHttp ?? false,
        allowPrivateNetwork: options.allowPrivateNetwork ?? false,
      });
      context.renderer?.write(preview.rows, {
        format: preview.format,
        columns: preview.columns,
        returnedCount: preview.returnedCount,
        truncated: preview.truncated,
        ...(preview.sheet === undefined ? {} : { sheet: preview.sheet }),
        ...(preview.warnings.length === 0 ? {} : { warnings: preview.warnings }),
      });
    },
  );
}
