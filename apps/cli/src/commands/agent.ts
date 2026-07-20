import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type { Command } from "commander";
import { setupAgents, type AgentInstallerRunner } from "../agent-setup.js";
import { manifestCommand } from "../command-manifest.js";
import type { CliContext } from "../context.js";

interface AgentSetupCommandOptions {
  readonly agent?: readonly string[];
  readonly all?: boolean;
  readonly copy?: boolean;
  readonly yes?: boolean;
  readonly dryRun?: boolean;
}

function noninteractiveSelectionRequired(): OpsiError {
  return new OpsiError({
    code: "AGENT_SETUP_NONINTERACTIVE_REQUIRED",
    message: "Non-interactive agent setup requires --yes, --agent, or --all.",
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Select explicit agents, accept all detected agents with --yes, or use --dry-run.",
  });
}

export function registerAgentCommand(
  program: Command,
  context: CliContext,
  runner: AgentInstallerRunner,
): void {
  manifestCommand(program, "agent setup").action(async (options: AgentSetupCommandOptions) => {
    const interactive =
      context.configuration?.output === "human" && context.io.stdin?.isTTY === true;
    const hasNoninteractiveSelection =
      options.yes === true || options.all === true || options.agent !== undefined;
    if (options.dryRun !== true && !interactive && !hasNoninteractiveSelection) {
      throw noninteractiveSelectionRequired();
    }
    const result = await setupAgents({
      cwd: context.io.cwd ?? process.cwd(),
      env: context.io.env ?? process.env,
      version: context.version,
      request: {
        ...(options.agent === undefined ? {} : { agents: options.agent }),
        ...(options.all === undefined ? {} : { all: options.all }),
        ...(options.copy === undefined ? {} : { copy: options.copy }),
        ...(options.yes === undefined ? {} : { yes: options.yes }),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      },
      runner,
      interactive,
    });
    context.renderer?.write(result);
  });
}
