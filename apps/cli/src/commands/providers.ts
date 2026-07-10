import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";

export function registerProvidersCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  const providers = program.command("providers").description("Inspect data providers");
  providers
    .command("list")
    .description("List registered providers")
    .action(() => {
      context.renderer?.write(client.providers.list());
    });
}
