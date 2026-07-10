import type { OpsiClient } from "@opsi/core";
import { resourceId } from "@opsi/domain";
import type { Command } from "commander";
import type { CliContext } from "../context.js";

export function registerResourceCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  const resource = program.command("resource").description("Inspect resources");
  resource
    .command("show")
    .description("Show resource details")
    .argument("<id>", "resource identifier")
    .action(async (id: string) => {
      context.renderer?.write(await client.resources.get(resourceId(id)));
    });
}
