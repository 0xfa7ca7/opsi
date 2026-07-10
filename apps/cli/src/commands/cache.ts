import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerCacheCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  const confirmed = (yes: boolean | undefined): void => {
    if (yes === true) return;
    throw new OpsiError({
      code: "CONFIRMATION_REQUIRED",
      message: "This destructive cache operation requires explicit confirmation.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      suggestion: "Run the command again with --yes.",
    });
  };
  const service = () => {
    if (client.cache === undefined)
      throw new OpsiError({
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
    confirmed(options.yes);
    await service().clear();
    context.renderer?.write({ cleared: true });
  });
  manifestCommand(program, "cache prune").action(async (options: { yes?: boolean }) => {
    confirmed(options.yes);
    context.renderer?.write(await service().prune());
  });
  manifestCommand(program, "cache verify").action(async () => {
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
