import type { OpsiClient } from "@opsi/core";
import { datasetId, EXIT_CODES, OpsiError, parseCanonicalReference } from "@opsi/domain";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { registerDatasetOpenCommand } from "./open.js";
import { manifestCommand } from "../command-manifest.js";

const DATASET_LIST_FIELDS = ["id", "title", "name"] as const;

function datasetListPaginationError(): OpsiError {
  return new OpsiError({
    code: "DATASET_LIST_PAGINATION_INVALID",
    message: "The provider returned a non-advancing dataset list page.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    suggestion: "Retry later or report the provider's pagination response.",
  });
}

export function registerDatasetCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  registerDatasetOpenCommand(program, context, client);
  manifestCommand(program, "dataset list").action(async () => {
    const buffered = [];
    let offset = 0;
    let total = 0;
    let count = 0;
    let pages = 0;
    let emittedPage = false;
    while (true) {
      const page = await client.search({ limit: 10_000, offset });
      pages += 1;
      if (pages === 1) total = page.total;
      if (page.nextOffset !== undefined && page.nextOffset <= offset)
        throw datasetListPaginationError();
      const items = page.items.map((summary) => {
        const rawName = summary.providerMetadata?.raw["name"];
        return { ...summary, name: typeof rawName === "string" ? rawName : undefined };
      });
      count += items.length;
      if (context.renderer?.streamsPages === true) {
        if (items.length > 0) {
          context.renderer.writePage(items, {
            firstPage: !emittedPage,
            defaultFields: DATASET_LIST_FIELDS,
          });
          emittedPage = true;
        }
      } else {
        buffered.push(...items);
      }
      if (page.nextOffset === undefined) break;
      offset = page.nextOffset;
    }
    if (context.renderer?.streamsPages !== true) {
      context.renderer?.write(buffered, { total, count, pages }, DATASET_LIST_FIELDS);
    }
  });
  manifestCommand(program, "dataset show").action(async (id: string) => {
    context.renderer?.write(await client.datasets.get(datasetId(id)));
  });
  manifestCommand(program, "dataset resources").action(async (id: string) => {
    context.renderer?.write(await client.datasets.resources(datasetId(id)));
  });
  manifestCommand(program, "dataset schema").action(
    async (
      id: string,
      options: {
        readonly resource?: string;
        readonly sheet?: string;
        readonly allowInsecureHttp?: boolean;
        readonly allowPrivateNetwork?: boolean;
      },
    ) => {
      const value = await client.datasets.get(datasetId(id));
      const tabular = value.resources.filter(
        (resource) =>
          ["csv", "tsv", "json", "jsonl", "ndjson", "xlsx", "parquet"].includes(
            resource.format?.toLowerCase() ?? "",
          ) ||
          [
            "text/csv",
            "text/tab-separated-values",
            "application/json",
            "application/x-ndjson",
            "application/ndjson",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.apache.parquet",
            "application/parquet",
          ].includes(resource.mediaType?.split(";", 1)[0]?.trim().toLowerCase() ?? ""),
      );
      let selected = options.resource;
      if (selected === undefined) {
        if (tabular.length !== 1)
          throw new OpsiError({
            code: "AMBIGUOUS_RESOURCE",
            message: "Dataset schema requires an explicit resource selection.",
            exitCode: EXIT_CODES.INVALID_INPUT,
            suggestion: "Use --resource with one of the listed resource IDs.",
            context: { choices: tabular.map((resource) => `${resource.id}`) },
          });
        selected = `${tabular[0]?.id}`;
      }
      const selectedId = selected.includes(":") ? parseCanonicalReference(selected) : undefined;
      if (selectedId !== undefined && selectedId.kind !== "resource")
        throw new OpsiError({
          code: "RESOURCE_REFERENCE_REQUIRED",
          message: "--resource must identify a resource.",
          exitCode: EXIT_CODES.INVALID_INPUT,
        });
      if (selectedId?.kind === "resource" && selectedId.providerId !== value.providerId)
        throw new OpsiError({
          code: "RESOURCE_PROVIDER_MISMATCH",
          message: "Selected resource provider does not match the dataset provider.",
          exitCode: EXIT_CODES.INVALID_INPUT,
          context: { datasetProvider: value.providerId, resourceProvider: selectedId.providerId },
        });
      const matchId = selectedId?.kind === "resource" ? `${selectedId.id}` : selected;
      const resource = value.resources.find((candidate) => `${candidate.id}` === matchId);
      if (resource === undefined)
        throw new OpsiError({
          code: "RESOURCE_NOT_IN_DATASET",
          message: `Resource '${matchId}' is not part of dataset '${id}'.`,
          exitCode: EXIT_CODES.INVALID_INPUT,
          context: { choices: value.resources.map((candidate) => `${candidate.id}`) },
        });
      const reference = resource.reference ?? `${resource.providerId}:resource:${resource.id}`;
      context.renderer?.write(
        await client.data.inferSchema(reference, {
          ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
          allowInsecureHttp: options.allowInsecureHttp ?? false,
          allowPrivateNetwork: options.allowPrivateNetwork ?? false,
        }),
      );
    },
  );
}
