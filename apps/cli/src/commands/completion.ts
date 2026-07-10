import type { Command } from "commander";
import {
  COMMAND_MANIFEST,
  GLOBAL_OPTION_MANIFEST,
  manifestCommand,
  type CommandManifestEntry,
  type CommandOptionManifest,
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

function longFlag(item: { readonly flags: string }): string {
  return item.flags.match(/--[\w-]+/u)?.[0] ?? item.flags.split(" ")[0] ?? item.flags;
}

function valueName(flags: string): string | undefined {
  return flags.match(/[<[]([^>\]]+)[>\]]/u)?.[1];
}

function zshValueAction(name: string, choices?: readonly string[]): string {
  if (choices !== undefined) return `:${name}:(${choices.join(" ")})`;
  if (/^(?:path|input|output|destination)$/u.test(name)) return `:${name}:_files`;
  return `:${name}:`;
}

function zshOption(item: CommandOptionManifest): string {
  const name = valueName(item.flags);
  const description = item.description.replaceAll("'", "");
  return `'${longFlag(item)}[${description}]${name === undefined ? "" : zshValueAction(name, item.choices)}'`;
}

function zshArgument(item: CommandManifestEntry["arguments"][number], position: number): string {
  const raw = item.name.replace(/[<>[\]]/gu, "").replace(/\.\.\.$/u, "");
  return `'${position}:${item.description.replaceAll("'", "")}${zshValueAction(raw, item.choices)}'`;
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
  const globalOptions = GLOBAL_OPTION_MANIFEST.map(zshOption).join(" ");
  const cases = topLevelCommands()
    .map((parent) => {
      const nested = children(parent);
      if (nested.length === 0) {
        const entry = COMMAND_MANIFEST.find((candidate) => candidate.path === parent);
        if (entry === undefined) return "";
        const specifications = [
          globalOptions,
          ...entry.options.map(zshOption),
          ...entry.arguments.map((item, index) => zshArgument(item, index + 2)),
        ].filter((value) => value.length > 0);
        return `    ${parent}) _arguments ${specifications.join(" ")} ;;`;
      }
      const subcommands = nested.map((entry) => entry.path.split(" ")[1]).join(" ");
      const leafCases = nested
        .map((entry) => {
          const child = entry.path.split(" ")[1];
          const specifications = [
            globalOptions,
            ...entry.options.map(zshOption),
            ...entry.arguments.map((item, index) => zshArgument(item, index + 3)),
          ].filter((value) => value.length > 0);
          return `        ${child}) _arguments ${specifications.join(" ")} ;;`;
        })
        .join("\n");
      return `    ${parent})
      _arguments ${globalOptions} '2:${parent} command:(${subcommands})' '*::argument:->${parent}_arguments'
      case $words[3] in
${leafCases}
      esac
      ;;`;
    })
    .join("\n");
  return `#compdef opsi
local context state state_descr line
typeset -A opt_args
_arguments -C ${globalOptions} '1:command:(${topLevelCommands().join(" ")})' '*::argument:->command_arguments'
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
