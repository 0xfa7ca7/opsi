import type { Command } from "commander";
import type { OpsiClient } from "@opsi/core";
import type { SupportedDataFormat } from "@opsi/data-engine";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerConvertCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  manifestCommand(program, "convert").action(
    async (
      input: string,
      options: {
        readonly to: SupportedDataFormat;
        readonly output: string;
        readonly sheet?: string;
        readonly entry?: string;
        readonly recordPath?: string;
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
        ...(options.entry === undefined ? {} : { entry: options.entry }),
        ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
        force: options.force ?? false,
        spreadsheetSafe: options.spreadsheetSafe ?? false,
        allowInsecureHttp: options.allowInsecureHttp ?? false,
        allowPrivateNetwork: options.allowPrivateNetwork ?? false,
      });
      context.renderer?.write(result);
    },
  );
}
