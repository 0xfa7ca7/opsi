import type { OpsiClient } from "@opsi/core";
import { datasetId } from "@opsi/domain";
import type { Command } from "commander";
import type { CliContext } from "../context.js";

export function registerDatasetCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  const dataset = program.command("dataset").description("Inspect datasets");
  dataset
    .command("show")
    .description("Show dataset details")
    .argument("<id>", "dataset identifier")
    .action(async (id: string) => {
      context.renderer?.write(await client.datasets.get(datasetId(id)));
    });
  dataset
    .command("resources")
    .description("List resources embedded in a dataset")
    .argument("<id>", "dataset identifier")
    .action(async (id: string) => {
      context.renderer?.write(await client.datasets.resources(datasetId(id)));
    });
}
