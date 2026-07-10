import type { Command } from "commander";
import {
  COMMAND_MANIFEST,
  GLOBAL_OPTION_MANIFEST,
  manifestCommand,
  type CommandManifestEntry,
} from "../command-manifest.js";
import type { CliContext } from "../context.js";

type Shell = "bash" | "zsh" | "fish";

function topLevelCommands(): readonly string[] {
  return [...new Set(COMMAND_MANIFEST.map((entry) => entry.path.split(" ")[0] as string))];
}

function children(parent: string): readonly CommandManifestEntry[] {
  return COMMAND_MANIFEST.filter((entry) => entry.path.startsWith(`${parent} `));
}

function flags(entry: CommandManifestEntry): string {
  return entry.options
    .map((item) => item.flags.split(/[ ,|]/u).find((part) => part.startsWith("--")) ?? item.flags)
    .join(" ");
}

function globalFlags(): string {
  return GLOBAL_OPTION_MANIFEST.map((item) => item.flags.split(" ")[0]).join(" ");
}

function bashCompletion(): string {
  const choiceCases = [
    ...GLOBAL_OPTION_MANIFEST,
    ...COMMAND_MANIFEST.flatMap((entry) => entry.options),
  ]
    .filter((item) => item.choices !== undefined)
    .map(
      (item) =>
        `    *${item.flags.split(" ")[0]}\\ *) candidates="${item.choices?.join(" ") ?? ""}" ;;`,
    )
    .join("\n");
  const cases = topLevelCommands()
    .map((parent) => {
      const nested = children(parent);
      const direct = COMMAND_MANIFEST.find((entry) => entry.path === parent);
      const words =
        nested.length === 0
          ? flags(direct as CommandManifestEntry)
          : `${nested.map((entry) => entry.path.split(" ")[1]).join(" ")} ${nested
              .flatMap((entry) => flags(entry).split(" "))
              .join(" ")}`;
      return `    opsi\\ ${parent}\\ *) candidates="${words} ${globalFlags()}" ;;`;
    })
    .join("\n");
  return `_opsi_complete() {
  local candidates="${topLevelCommands().join(" ")} ${globalFlags()}"
  case "$COMP_LINE" in
${choiceCases}
${cases}
  esac
  COMPREPLY=( $(compgen -W "$candidates" -- "\${COMP_WORDS[COMP_CWORD]}") )
}
complete -o default -o bashdefault -F _opsi_complete opsi
`;
}

function zshCompletion(): string {
  const cases = topLevelCommands()
    .filter((parent) => children(parent).length > 0)
    .map((parent) => {
      const values = children(parent)
        .map((entry) => `${entry.path.split(" ")[1]}:${entry.description.replaceAll("'", "")}`)
        .join(" ");
      return `    ${parent}) _values '${parent} command' ${values} ;;`;
    })
    .join("\n");
  return `#compdef opsi
_arguments ${GLOBAL_OPTION_MANIFEST.map((item) => `'${item.flags}[${item.description.replaceAll("'", "")}]'`).join(" ")} '1:command:(${topLevelCommands().join(" ")})' '*:path:_files'
# enum choices: ${[...GLOBAL_OPTION_MANIFEST, ...COMMAND_MANIFEST.flatMap((entry) => entry.options)].flatMap((item) => item.choices ?? []).join(" ")}
case $words[2] in
${cases}
esac
`;
}

function fishCompletion(): string {
  const top = topLevelCommands();
  const lines = [
    ...GLOBAL_OPTION_MANIFEST.map((item) => {
      const long = item.flags.match(/--([\w-]+)/u)?.[1] ?? item.flags;
      const choices = item.choices === undefined ? "" : ` -a '${item.choices.join(" ")}'`;
      return `complete -c opsi -l '${long}'${choices} -d '${item.description.replaceAll("'", "")}'`;
    }),
    ...top.map(
      (parent) =>
        `complete -c opsi -n 'not __fish_seen_subcommand_from ${top.join(" ")}' -a '${parent}'`,
    ),
    ...top.flatMap((parent) =>
      children(parent).map(
        (entry) =>
          `complete -c opsi -n '__fish_seen_subcommand_from ${parent}' -a '${entry.path.split(" ")[1]}'`,
      ),
    ),
    ...COMMAND_MANIFEST.flatMap((entry) =>
      entry.options.map((item) => {
        const parent = entry.path.split(" ")[0];
        const long = item.flags.match(/--([\w-]+)/u)?.[1] ?? item.flags;
        const choices = item.choices === undefined ? "" : ` -a '${item.choices.join(" ")}'`;
        return `complete -c opsi -n '__fish_seen_subcommand_from ${parent}' -l '${long}'${choices}`;
      }),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function completionScript(shell: Shell): string {
  if (shell === "bash") return bashCompletion();
  if (shell === "zsh") return zshCompletion();
  return fishCompletion();
}

export function registerCompletionCommand(program: Command, context: CliContext): void {
  manifestCommand(program, "completion").action((shell: Shell) => {
    context.io.stdout.write(completionScript(shell));
  });
}
