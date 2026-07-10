import { Option, type Command } from "commander";
import type { OpsiClient } from "@opsi/core";
import type { SupportedDataFormat } from "@opsi/data-engine";
import type { CliContext } from "../context.js";

const TARGET_FORMATS = ["csv", "tsv", "json", "ndjson", "xlsx", "parquet"] as const;

export function registerConvertCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  program
    .command("convert")
    .description("Convert tabular data between supported formats")
    .argument("<input>", "local path or canonical resource reference")
    .addOption(
      new Option("--to <format>", "destination data format")
        .choices([...TARGET_FORMATS])
        .makeOptionMandatory(),
    )
    .requiredOption("--output <path>", "destination file path")
    .option("--sheet <name>", "XLSX sheet name")
    .option("--force", "replace an existing regular destination")
    .option("--spreadsheet-safe", "prefix formula-like string values")
    .option("--allow-insecure-http", "allow HTTP for this invocation")
    .option("--allow-private-network", "allow private network addresses for this invocation")
    .action(
      async (
        input: string,
        options: {
          readonly to: SupportedDataFormat;
          readonly output: string;
          readonly sheet?: string;
          readonly force?: boolean;
          readonly spreadsheetSafe?: boolean;
          readonly allowInsecureHttp?: boolean;
          readonly allowPrivateNetwork?: boolean;
        },
      ) => {
        const result = await client.conversions.convert(input, {
          output: options.output,
          targetFormat: options.to,
          ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
          force: options.force ?? false,
          spreadsheetSafe: options.spreadsheetSafe ?? false,
          allowInsecureHttp: options.allowInsecureHttp ?? false,
          allowPrivateNetwork: options.allowPrivateNetwork ?? false,
        });
        context.renderer?.write(result);
      },
    );
}
