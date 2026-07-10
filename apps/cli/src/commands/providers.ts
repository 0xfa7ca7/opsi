import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerProvidersCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  manifestCommand(program, "providers list").action(() => {
    context.renderer?.write(client.providers.list());
  });
}
