import { Argument, type Command } from "commander";
import { COMMAND_MANIFEST, GLOBAL_OPTION_MANIFEST, commandWords } from "../command-manifest.js";
import type { CliContext } from "../context.js";

const SHELLS = ["bash", "zsh", "fish"] as const;

function tokens(): string {
  const options = [
    ...GLOBAL_OPTION_MANIFEST,
    ...COMMAND_MANIFEST.flatMap((entry) => entry.options ?? []),
    ...COMMAND_MANIFEST.flatMap(
      (entry) => entry.commands?.flatMap((child) => child.options ?? []) ?? [],
    ),
  ].flatMap((option) => [option.flags.split(" ")[0] ?? option.flags, ...(option.choices ?? [])]);
  return [...new Set([...commandWords(), ...options])].join(" ");
}

export function completionScript(shell: (typeof SHELLS)[number]): string {
  const values = tokens();
  if (shell === "bash") return `complete -o default -o bashdefault -W '${values}' opsi\n`;
  if (shell === "zsh") return `#compdef opsi\n_arguments '1:command:(${values})' '*:path:_files'\n`;
  return `complete -c opsi -a '${values}'\n`;
}

export function registerCompletionCommand(program: Command, context: CliContext): void {
  program
    .command("completion")
    .description("Generate static shell completion")
    .addArgument(new Argument("<shell>").choices([...SHELLS]))
    .action((shell: (typeof SHELLS)[number]) => {
      context.io.stdout.write(completionScript(shell));
    });
}
