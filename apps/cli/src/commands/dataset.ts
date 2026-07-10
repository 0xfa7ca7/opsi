import type { OpsiClient } from "@opsi/core";
import { datasetId, EXIT_CODES, OpsiError, parseCanonicalReference } from "@opsi/domain";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { registerDatasetOpenCommand } from "./open.js";
import { manifestCommand } from "../command-manifest.js";

export function registerDatasetCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  registerDatasetOpenCommand(program, context, client);
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
