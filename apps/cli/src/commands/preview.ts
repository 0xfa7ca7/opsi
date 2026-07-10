import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerResourcePreviewCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  manifestCommand(program, "resource preview").action(
    async (
      input: string,
      options: {
        readonly limit?: number;
        readonly sheet?: string;
        readonly allowInsecureHttp?: boolean;
        readonly allowPrivateNetwork?: boolean;
      },
    ) => {
      const preview = await client.data.preview(input, {
        limit: options.limit ?? context.configuration?.preview.rowLimit ?? 20,
        ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
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
