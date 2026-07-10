import type { Command } from "commander";
import { ProvenanceStore } from "@opsi/storage";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerProvenanceCommand(program: Command, context: CliContext): void {
  const store = new ProvenanceStore();
  manifestCommand(program, "provenance show").action(async (path: string) =>
    context.renderer?.write(await store.read(path)),
  );
  manifestCommand(program, "provenance verify").action(async (path: string) =>
    context.renderer?.write(await store.verify(path)),
  );
}
