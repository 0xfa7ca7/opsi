import { Command } from "commander";
import { OpsiClient, ProviderRegistry } from "@opsi/core";
import { OpsiProvider, OpsiTransport, RequestScheduler } from "@opsi/provider-opsi";
import { ContentCache, ProvenanceStore } from "@opsi/storage";
import { registerDatasetCommand } from "./commands/dataset.js";
import { registerProvidersCommand } from "./commands/providers.js";
import { registerResourceCommand } from "./commands/resource.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerDownloadCommand } from "./commands/download.js";
import { registerCacheCommand } from "./commands/cache.js";
import { registerProvenanceCommand } from "./commands/provenance.js";
import type { CliContext } from "./context.js";
import { addGlobalOptions } from "./options.js";

function requestInterval(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function createClient(context: CliContext): OpsiClient {
  const intervalMs = requestInterval(context.io.env?.OPSI_REQUEST_INTERVAL_MS);
  const configuration = context.configuration;
  const cache = new ContentCache(configuration?.paths.cacheDir ?? ".opsi-cache");
  const provider = new OpsiProvider(
    new OpsiTransport({
      ...(context.io.env?.OPSI_BASE_URL === undefined
        ? {}
        : { baseUrl: context.io.env.OPSI_BASE_URL }),
      ...(context.configuration?.http.timeoutMs === undefined
        ? {}
        : { timeoutMs: context.configuration.http.timeoutMs }),
      scheduler: new RequestScheduler({ ...(intervalMs === undefined ? {} : { intervalMs }) }),
    }),
    { metadataCache: cache, offline: configuration?.offline ?? false },
  );
  const registry = new ProviderRegistry([provider]);
  return new OpsiClient({
    registry,
    providerId: context.configuration?.provider ?? provider.descriptor.id,
    cache,
    downloads: {
      downloadDir: configuration?.paths.downloadDir ?? context.io.cwd ?? process.cwd(),
      limits: {
        maxBytes: configuration?.http.maxDownloadBytes ?? 2 * 1024 * 1024 * 1024,
        timeoutMs: configuration?.http.timeoutMs ?? 30_000,
      },
      provenance: new ProvenanceStore(),
      cache,
      offline: configuration?.offline ?? false,
    },
  });
}

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
    })
    .action(() => program.help({ error: true }));
  addGlobalOptions(program);
  const client = createClient(context);
  registerSearchCommand(program, context, client);
  registerDatasetCommand(program, context, client);
  registerResourceCommand(program, context, client);
  registerProvidersCommand(program, context, client);
  registerDownloadCommand(program, context, client);
  registerCacheCommand(program, context, client);
  registerProvenanceCommand(program, context);
  return program;
}
