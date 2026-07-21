import { EXIT_CODES, KlopsiError, type Dataset } from "@klopsi/domain";
import type { KlopsiClient } from "@klopsi/core";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

function publicDatasetUrl(dataset: Dataset): URL {
  const rawName = dataset.providerMetadata?.raw.name;
  const slug = typeof rawName === "string" && rawName.length > 0 ? rawName : `${dataset.id}`;
  const url = new URL(`/dataset/${encodeURIComponent(slug)}`, "https://podatki.gov.si/");
  if (
    dataset.providerId !== "klopsi" ||
    url.protocol !== "https:" ||
    url.hostname !== "podatki.gov.si"
  )
    throw new KlopsiError({
      code: "DATASET_PAGE_FORBIDDEN",
      message: "The provider dataset page is not an approved public HTTPS URL.",
      exitCode: EXIT_CODES.INVALID_INPUT,
    });
  return url;
}

export function registerDatasetOpenCommand(
  program: Command,
  context: CliContext,
  client: KlopsiClient,
): void {
  manifestCommand(program, "dataset open").action(async (id: string) => {
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
