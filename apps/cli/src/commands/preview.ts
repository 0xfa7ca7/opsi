import type { OpsiClient } from "@opsi/core";
import { InvalidArgumentError, type Command } from "commander";
import type { CliContext } from "../context.js";

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new InvalidArgumentError("must be a positive integer");
  return parsed;
}

export function registerResourcePreviewCommand(
  resource: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  resource
    .command("preview")
    .description("Preview bounded rows from a local or provider resource")
    .argument("<input>", "local path, local:file reference, resource ID, or canonical resource")
    .option("--limit <rows>", "maximum preview rows", positiveInteger)
    .option("--sheet <name>", "XLSX sheet name")
    .option("--allow-insecure-http", "allow HTTP for this invocation")
    .option("--allow-private-network", "allow private network addresses for this invocation")
    .action(
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
