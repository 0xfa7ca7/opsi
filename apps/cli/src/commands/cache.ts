import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import type { KlopsiClient } from "@klopsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerCacheCommand(
  program: Command,
  context: CliContext,
  client: KlopsiClient,
): void {
  const confirmed = async (yes: boolean | undefined): Promise<void> => {
    if (yes === true) return;
    const interactiveHuman =
      context.io.stdin?.isTTY === true &&
      context.io.stdout.isTTY === true &&
      context.configuration?.output === "human";
    if (interactiveHuman && context.io.confirm !== undefined) {
      if (await context.io.confirm("Delete the selected cache data?")) return;
      throw new KlopsiError({
        code: "CONFIRMATION_DECLINED",
        message: "Cache operation cancelled.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    }
    throw new KlopsiError({
      code: "CONFIRMATION_REQUIRED",
      message: "This destructive cache operation requires explicit confirmation.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      suggestion: "Run the command again with --yes.",
    });
  };
  const service = () => {
    if (client.cache === undefined)
      throw new KlopsiError({
        code: "CACHE_UNAVAILABLE",
        message: "Cache services are unavailable.",
        exitCode: EXIT_CODES.INTERNAL,
      });
    return client.cache;
  };
  manifestCommand(program, "cache info").action(async () =>
    context.renderer?.write(await service().info()),
  );
  manifestCommand(program, "cache list").action(async () =>
    context.renderer?.write(await service().list()),
  );
  manifestCommand(program, "cache clear").action(async (options: { yes?: boolean }) => {
    await confirmed(options.yes);
    await service().clear();
    context.renderer?.write({ cleared: true });
  });
  manifestCommand(program, "cache prune").action(async (options: { yes?: boolean }) => {
    await confirmed(options.yes);
    context.renderer?.write(await service().prune());
  });
  manifestCommand(program, "cache verify").action(async () => {
    const result = await service().verify();
    if (result.errors.length > 0)
      throw new KlopsiError({
        code: "CACHE_CORRUPT",
        message: "Cache verification found corrupt objects.",
        exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        context: { errors: result.errors },
      });
    context.renderer?.write(result);
  });
}
