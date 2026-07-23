import type { KlopsiClient } from "@klopsi/core";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import type { Command } from "commander";
import { manifestCommand } from "../command-manifest.js";
import type { CliContext } from "../context.js";
import {
  duckDbCliUnavailable,
  type DuckDbCliInfo,
  type DuckDbUiRunner,
} from "../duckdb-ui-runner.js";

interface DuckDbOpenOptions {
  readonly sheet?: string;
  readonly entry?: string;
  readonly recordPath?: string;
  readonly install?: boolean;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
}

interface DuckDbInstallOptions {
  readonly yes?: boolean;
}

function confirmationRequired(): KlopsiError {
  return new KlopsiError({
    code: "CONFIRMATION_REQUIRED",
    message: "DuckDB CLI installation requires explicit confirmation.",
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Run `klopsi duckdb install --yes` to authorize the official installer.",
  });
}

async function resolveDuckDb(
  runner: DuckDbUiRunner,
  allowInstall: boolean,
): Promise<{ readonly info: DuckDbCliInfo; readonly installed: boolean }> {
  const existing = await runner.inspect();
  if (existing !== undefined) return { info: existing, installed: false };
  if (!allowInstall) throw duckDbCliUnavailable();
  return { info: await runner.install(), installed: true };
}

export function registerDuckDbCommand(
  program: Command,
  context: CliContext,
  client: KlopsiClient,
  runner: DuckDbUiRunner,
): void {
  manifestCommand(program, "duckdb open").action(
    async (input: string, options: DuckDbOpenOptions) => {
      const selected = await resolveDuckDb(runner, options.install === true);
      const leased = await client.query.withDatabase(
        input,
        {
          ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
          ...(options.entry === undefined ? {} : { entry: options.entry }),
          ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
          allowInsecureHttp: options.allowInsecureHttp ?? false,
          allowPrivateNetwork: options.allowPrivateNetwork ?? false,
        },
        (databasePath) => runner.open(selected.info, databasePath),
      );
      const global = program.opts() as { readonly quiet?: boolean };
      if (global.quiet !== true) {
        for (const warning of leased.warnings) {
          context.io.stderr.write(`warning [${warning.code}]: ${warning.message}\n`);
        }
      }
      context.renderer?.write({
        opened: true,
        source: leased.source,
        table: "data",
        installed: selected.installed,
        duckdb: { version: selected.info.version },
        cache: leased.cache,
      });
    },
  );

  manifestCommand(program, "duckdb install").action(async (options: DuckDbInstallOptions) => {
    const existing = await runner.inspect();
    if (existing !== undefined) {
      context.renderer?.write({
        installed: false,
        duckdb: { version: existing.version },
      });
      return;
    }
    if (options.yes !== true) throw confirmationRequired();
    const installed = await runner.install();
    context.renderer?.write({
      installed: true,
      duckdb: { version: installed.version },
    });
  });
}
