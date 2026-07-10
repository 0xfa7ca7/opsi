import { EXIT_CODES, OpsiError, parseCanonicalReference, resourceId } from "@opsi/domain";
import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";

interface Options {
  readonly destination?: string;
  readonly output?: string;
  readonly force?: boolean;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
}
export function registerDownloadCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  program
    .command("download")
    .description("Download one or more resources securely")
    .argument("<ids...>", "resource identifiers")
    .option("--destination <path>", "destination path (one resource only)")
    .option("--output <path>", "alias for --destination")
    .option("--force", "replace the requested regular file")
    .option("--allow-insecure-http", "allow HTTP for this invocation")
    .option("--allow-private-network", "allow private network addresses for this invocation")
    .action(async (ids: string[], options: Options) => {
      if (client.downloads === undefined)
        throw new OpsiError({
          code: "DOWNLOAD_UNAVAILABLE",
          message: "Downloads are unavailable.",
          exitCode: EXIT_CODES.INTERNAL,
        });
      if (options.destination !== undefined && options.output !== undefined)
        throw new OpsiError({
          code: "INVALID_DOWNLOAD_DESTINATION",
          message: "Use only one of --destination or --output.",
          exitCode: EXIT_CODES.INVALID_INPUT,
        });
      const destination = options.destination ?? options.output;
      if (ids.length > 1 && destination !== undefined)
        throw new OpsiError({
          code: "INVALID_DOWNLOAD_DESTINATION",
          message: "A destination may only be used with one resource.",
          exitCode: EXIT_CODES.INVALID_INPUT,
        });
      const results: unknown[] = [];
      const errors: unknown[] = [];
      for (const id of ids) {
        try {
          const reference = id.includes(":") ? parseCanonicalReference(id) : undefined;
          if (reference !== undefined && reference.kind !== "resource")
            throw new OpsiError({
              code: "RESOURCE_REFERENCE_REQUIRED",
              message: "Download requires a resource reference.",
              exitCode: EXIT_CODES.INVALID_INPUT,
            });
          results.push(
            await client.downloads.resource(
              reference?.kind === "resource" ? reference.id : resourceId(id),
              {
                ...(reference?.kind === "resource"
                  ? { providerId: `${reference.providerId}` }
                  : {}),
                ...(destination === undefined ? {} : { destination }),
                force: options.force ?? false,
                allowInsecureHttp: options.allowInsecureHttp ?? false,
                allowPrivateNetwork: options.allowPrivateNetwork ?? false,
              },
            ),
          );
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        if (results.length > 0)
          throw new OpsiError({
            code: "PARTIAL_DOWNLOAD",
            message: `${results.length} download(s) succeeded and ${errors.length} failed.`,
            exitCode: EXIT_CODES.PARTIAL_SUCCESS,
            context: {
              data: results,
              failures: errors.map((error) =>
                error instanceof Error ? error.message : String(error),
              ),
            },
          });
        throw errors[0];
      }
      if (results.length > 0) context.renderer?.write(ids.length === 1 ? results[0] : results);
    });
}
