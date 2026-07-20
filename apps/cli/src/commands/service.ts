import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type { OpsiClient, WfsNetworkOptions, WfsSelectionOptions } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

interface SelectionArguments {
  readonly layer: string;
  readonly limit?: number;
  readonly startIndex?: number;
  readonly property?: readonly string[];
  readonly filterEq?: readonly string[];
  readonly bbox?: string;
  readonly crs?: string;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
}

function network(options: SelectionArguments): WfsNetworkOptions {
  return {
    allowInsecureHttp: options.allowInsecureHttp ?? false,
    allowPrivateNetwork: options.allowPrivateNetwork ?? false,
  };
}

function selection(options: SelectionArguments): WfsSelectionOptions {
  const filters: Record<string, string | number | boolean> = {};
  for (const candidate of options.filterEq ?? []) {
    const index = candidate.indexOf("=");
    if (index <= 0)
      throw new OpsiError({
        code: "WFS_FILTER_INVALID",
        message: "Equality filters must use field=value.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    const raw = candidate.slice(index + 1);
    filters[candidate.slice(0, index)] = /^(?:true|false)$/iu.test(raw)
      ? raw.toLowerCase() === "true"
      : /^[+-]?(?:\d+|\d*\.\d+)$/u.test(raw) && Number.isFinite(Number(raw))
        ? Number(raw)
        : raw;
  }
  let bbox: [number, number, number, number] | undefined;
  if (options.bbox !== undefined) {
    const values = options.bbox.split(",").map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value)))
      throw new OpsiError({
        code: "WFS_BBOX_INVALID",
        message: "--bbox requires four finite comma-separated coordinates.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    bbox = values as [number, number, number, number];
  }
  const properties = (options.property ?? []).flatMap((value) => value.split(",")).filter(Boolean);
  return {
    layer: options.layer,
    ...network(options),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.startIndex === undefined ? {} : { startIndex: options.startIndex }),
    ...(properties.length === 0 ? {} : { properties }),
    ...(Object.keys(filters).length === 0 ? {} : { filters }),
    ...(bbox === undefined ? {} : { bbox }),
    ...(options.crs === undefined ? {} : { crs: options.crs }),
  };
}

export function registerServiceCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  manifestCommand(program, "service inspect").action(
    async (resource: string, options: SelectionArguments) =>
      context.renderer?.write(await client.services.wfs.inspect(resource, network(options))),
  );
  manifestCommand(program, "service layers").action(
    async (resource: string, options: SelectionArguments) =>
      context.renderer?.write(await client.services.wfs.layers(resource, network(options))),
  );
  manifestCommand(program, "service schema").action(
    async (resource: string, options: SelectionArguments) =>
      context.renderer?.write(
        await client.services.wfs.schema(resource, { layer: options.layer, ...network(options) }),
      ),
  );
  manifestCommand(program, "service preview").action(
    async (resource: string, options: SelectionArguments) => {
      const result = await client.services.wfs.preview(resource, selection(options));
      context.renderer?.write(result.rows, {
        version: result.version,
        layer: result.layer,
        columns: result.columns,
        returnedCount: result.returnedCount,
        truncated: result.truncated,
      });
    },
  );
  manifestCommand(program, "service count").action(
    async (resource: string, options: SelectionArguments) =>
      context.renderer?.write(await client.services.wfs.count(resource, selection(options))),
  );
  manifestCommand(program, "service export").action(
    async (
      resource: string,
      options: SelectionArguments & { readonly output: string; readonly force?: boolean },
    ) =>
      context.renderer?.write(
        await client.services.wfs.export(resource, {
          ...selection(options),
          output: options.output,
          force: options.force ?? false,
        }),
      ),
  );
}
