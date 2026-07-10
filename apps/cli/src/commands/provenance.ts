import type { Command } from "commander";
import { ProvenanceStore } from "@opsi/storage";
import type { CliContext } from "../context.js";

export function registerProvenanceCommand(program: Command, context: CliContext): void {
  const store = new ProvenanceStore();
  const provenance = program
    .command("provenance")
    .description("Inspect and verify artifact provenance");
  provenance
    .command("show")
    .argument("<path>")
    .action(async (path: string) => context.renderer?.write(await store.read(path)));
  provenance
    .command("verify")
    .argument("<path>")
    .action(async (path: string) => context.renderer?.write(await store.verify(path)));
}
