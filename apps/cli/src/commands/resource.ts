import type { OpsiClient } from "@opsi/core";
import { resourceId } from "@opsi/domain";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { registerResourcePreviewCommand } from "./preview.js";

export function registerResourceCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  const resource = program.command("resource").description("Inspect resources");
  registerResourcePreviewCommand(resource, context, client);
  resource
    .command("show")
    .description("Show resource details")
    .argument("<id>", "resource identifier")
    .action(async (id: string) => {
      context.renderer?.write(await client.resources.get(resourceId(id)));
    });
  resource
    .command("headers")
    .description("Probe resource headers securely")
    .argument("<id>", "resource identifier")
    .option("--allow-insecure-http", "allow HTTP for this invocation")
    .option("--allow-private-network", "allow private network addresses for this invocation")
    .action(
      async (
        id: string,
        options: { allowInsecureHttp?: boolean; allowPrivateNetwork?: boolean },
      ) => {
        if (client.downloads === undefined) throw new Error("Download service unavailable");
        context.renderer?.write(
          await client.downloads.headers(resourceId(id), {
            allowInsecureHttp: options.allowInsecureHttp ?? false,
            allowPrivateNetwork: options.allowPrivateNetwork ?? false,
          }),
        );
      },
    );
}
