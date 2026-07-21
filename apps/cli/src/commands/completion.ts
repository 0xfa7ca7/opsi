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

function zshSpecificationText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function zshQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function zshValueAction(name: string, choices?: readonly string[]): string {
  const message = zshSpecificationText(name.replaceAll(":", " "));
  if (choices !== undefined) return `:${message}:(${choices.map(zshSpecificationText).join(" ")})`;
  if (/^(?:path|input|output|destination)$/u.test(name)) return `:${message}:_files`;
  return `:${message}:`;
}

function zshOption(item: CommandOptionManifest): string {
  const name = valueName(item.flags);
  const description = zshSpecificationText(item.description);
  return zshQuote(
    `${longFlag(item)}[${description}]${name === undefined ? "" : zshValueAction(name, item.choices)}`,
  );
}

function zshArgument(item: CommandManifestEntry["arguments"][number], position: number): string {
  const raw = item.name.replace(/[<>[\]]/gu, "").replace(/\.\.\.$/u, "");
  const action =
    item.choices !== undefined
      ? `:(${item.choices.map(zshSpecificationText).join(" ")})`
      : /^(?:path|input|output|destination)$/u.test(raw)
        ? ":_files"
        : ":";
  return zshQuote(`${position}:${zshSpecificationText(item.description)}${action}`);
}

function zshValue(name: string, description: string): string {
  return zshQuote(`${zshSpecificationText(name)}[${zshSpecificationText(description)}]`);
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
      return `    klopsi\\ ${parent}\\ *) candidates="${words} ${globalFlags()}" ;;`;
    })
    .join("\n");
  return `_klopsi_complete() {
  local candidates="${topLevelCommands().join(" ")} ${globalFlags()}"
  case "$COMP_LINE" in
${choiceCases}
${cases}
  esac
  COMPREPLY=( $(compgen -W "$candidates" -- "\${COMP_WORDS[COMP_CWORD]}") )
}
complete -o default -o bashdefault -F _klopsi_complete klopsi
`;
}

function zshCompletion(): string {
  const globalOptions = GLOBAL_OPTION_MANIFEST.map(zshOption).join(" ");
  const commandValues = topLevelCommands()
    .map((parent) => {
      const direct = COMMAND_MANIFEST.find((entry) => entry.path === parent);
      const description = direct?.description ?? `${parent} commands`;
      return zshValue(parent, description);
    })
    .join(" ");
  const commandCases = topLevelCommands()
    .map((parent) => {
      const nested = children(parent);
      if (nested.length === 0) {
        const entry = COMMAND_MANIFEST.find((candidate) => candidate.path === parent);
        if (entry === undefined) return "";
        const specifications = [
          globalOptions,
          ...entry.options.map(zshOption),
          ...entry.arguments.map((item, index) => zshArgument(item, index + 1)),
        ].filter((value) => value.length > 0);
        return `        ${parent}) _arguments ${specifications.join(" ")} ;;`;
      }
      const subcommands = nested
        .map((entry) => zshValue(entry.path.split(" ")[1] as string, entry.description))
        .join(" ");
      const leafCases = nested
        .map((entry) => {
          const child = entry.path.split(" ")[1];
          const specifications = [
            globalOptions,
            ...entry.options.map(zshOption),
            ...entry.arguments.map((item, index) => zshArgument(item, index + 1)),
          ].filter((value) => value.length > 0);
          return `                ${child}) _arguments ${specifications.join(" ")} ;;`;
        })
        .join("\n");
      return `        ${parent})
          local -a ${parent}_words=("\${words[@]}")
          local -i ${parent}_current=$CURRENT ${parent}_index
          _arguments -n -C -A '-*' ${globalOptions} ':${parent} command:->${parent}_command' '*::: := ->${parent}_arguments'
          case $state in
            ${parent}_command)
              _values '${parent} command' ${subcommands}
              ;;
            ${parent}_arguments)
              curcontext="\${curcontext%:*}-${parent}-$line[1]:"
              ${parent}_index=$NORMARG
              (( ${parent}_index <= $#${parent}_words )) || return 1
              words=("\${(@)${parent}_words[$${parent}_index,-1]}")
              CURRENT=$(( ${parent}_current - ${parent}_index + 1 ))
              case $line[1] in
${leafCases}
              esac
              ;;
          esac
          ;;`;
    })
    .join("\n");
  return `#compdef klopsi
local curcontext="$curcontext" context state state_descr line
local -a klopsi_words=("\${words[@]}")
local -i klopsi_current=$CURRENT klopsi_command_index NORMARG
typeset -A opt_args
_arguments -n -C -A '-*' ${globalOptions} ':command:->command' '*::: := ->command_arguments'
case $state in
  command)
    _values 'command' ${commandValues}
    ;;
  command_arguments)
    curcontext="\${curcontext%:*}-$line[1]:"
    klopsi_command_index=$NORMARG
    (( klopsi_command_index <= $#klopsi_words )) || return 1
    words=("\${(@)klopsi_words[$klopsi_command_index,-1]}")
    CURRENT=$(( klopsi_current - klopsi_command_index + 1 ))
    case $line[1] in
${commandCases}
    esac
    ;;
esac
`;
}

function fishCompletion(): string {
  const top = topLevelCommands();
  const lines = [
    ...GLOBAL_OPTION_MANIFEST.map((item) => {
      const long = item.flags.match(/--([\w-]+)/u)?.[1] ?? item.flags;
      const choices = item.choices === undefined ? "" : ` -a '${item.choices.join(" ")}'`;
      return `complete -c klopsi -l '${long}'${choices} -d '${item.description.replaceAll("'", "")}'`;
    }),
    ...top.map(
      (parent) =>
        `complete -c klopsi -n 'not __fish_seen_subcommand_from ${top.join(" ")}' -a '${parent}'`,
    ),
    ...top.flatMap((parent) =>
      children(parent).map(
        (entry) =>
          `complete -c klopsi -n '__fish_seen_subcommand_from ${parent}' -a '${entry.path.split(" ")[1]}'`,
      ),
    ),
    ...COMMAND_MANIFEST.flatMap((entry) =>
      entry.options.map((item) => {
        const parent = entry.path.split(" ")[0];
        const long = item.flags.match(/--([\w-]+)/u)?.[1] ?? item.flags;
        const choices = item.choices === undefined ? "" : ` -a '${item.choices.join(" ")}'`;
        return `complete -c klopsi -n '__fish_seen_subcommand_from ${parent}' -l '${long}'${choices}`;
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
