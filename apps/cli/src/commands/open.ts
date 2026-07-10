import { EXIT_CODES, OpsiError, type Dataset } from "@opsi/domain";
import type { OpsiClient } from "@opsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";

function publicDatasetUrl(dataset: Dataset): URL {
  const rawName = dataset.providerMetadata?.raw.name;
  const slug = typeof rawName === "string" && rawName.length > 0 ? rawName : `${dataset.id}`;
  const url = new URL(`/dataset/${encodeURIComponent(slug)}`, "https://podatki.gov.si/");
  if (
    dataset.providerId !== "opsi" ||
    url.protocol !== "https:" ||
    url.hostname !== "podatki.gov.si"
  )
    throw new OpsiError({
      code: "DATASET_PAGE_FORBIDDEN",
      message: "The provider dataset page is not an approved public HTTPS URL.",
      exitCode: EXIT_CODES.INVALID_INPUT,
    });
  return url;
}

export function registerDatasetOpenCommand(
  dataset: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  dataset
    .command("open")
    .description("Open the provider's public dataset page")
    .argument("<id>")
    .action(async (id: string) => {
      const value = await client.datasets.get(id as never);
      const url = publicDatasetUrl(value);
      const openUrl =
        context.openUrl ??
        (async (target: string) => {
          const { default: open } = await import("open");
          await open(target);
        });
      await openUrl(url.href);
      context.renderer?.write({ opened: url.href });
    });
}
