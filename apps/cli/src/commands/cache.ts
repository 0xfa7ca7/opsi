import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";

export function registerCacheCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  const service = () => {
    if (client.cache === undefined)
      throw new OpsiError({
        code: "CACHE_UNAVAILABLE",
        message: "Cache services are unavailable.",
        exitCode: EXIT_CODES.INTERNAL,
      });
    return client.cache;
  };
  const cache = program.command("cache").description("Inspect and maintain the local cache");
  cache.command("info").action(async () => context.renderer?.write(await service().info()));
  cache.command("list").action(async () => context.renderer?.write(await service().list()));
  cache.command("clear").action(async () => {
    await service().clear();
    context.renderer?.write({ cleared: true });
  });
  cache.command("prune").action(async () => context.renderer?.write(await service().prune()));
  cache.command("verify").action(async () => {
    const result = await service().verify();
    if (result.errors.length > 0)
      throw new OpsiError({
        code: "CACHE_CORRUPT",
        message: "Cache verification found corrupt objects.",
        exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        context: { errors: result.errors },
      });
    context.renderer?.write(result);
  });
}
