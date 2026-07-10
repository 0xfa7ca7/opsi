import { Command } from "commander";
import type { CliContext } from "./context.js";
import { addGlobalOptions } from "./options.js";

export function createProgram(context: CliContext): Command {
  const program = new Command();
  program
    .name("opsi")
    .description("Discover and work with Slovenian public data")
    .version(context.version)
    .exitOverride()
    .showHelpAfterError()
    .configureOutput({
      writeOut: (chunk) => context.io.stdout.write(chunk),
      writeErr: (chunk) => context.io.stderr.write(chunk),
    });
  return addGlobalOptions(program);
}
