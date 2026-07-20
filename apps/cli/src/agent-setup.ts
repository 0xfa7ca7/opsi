import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { AGENT_SKILLS, generateAgentSkills } from "./agent-skills.js";
import type { AgentHostRegistry } from "./agent-hosts.js";

export const AGENT_INSTALLER_VERSION = "skills@1.5.19" as const;

export interface AgentSetupRequest {
  readonly agents?: readonly string[];
  readonly all?: boolean;
  readonly copy?: boolean;
  readonly yes?: boolean;
  readonly dryRun?: boolean;
}

export interface AgentInstallerRunRequest {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly interactive: boolean;
}

export interface AgentInstallerRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface AgentInstallerRunner {
  run(request: AgentInstallerRunRequest): Promise<AgentInstallerRunResult>;
}

export interface AgentSetupResult {
  readonly installer: typeof AGENT_INSTALLER_VERSION;
  readonly scope: "global";
  readonly selection: "detected" | "all" | readonly string[];
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly dryRun: boolean;
}

export interface SetupAgentsOptions {
  readonly cwd: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
  readonly request: AgentSetupRequest;
  readonly runner: AgentInstallerRunner;
  readonly registry: AgentHostRegistry;
  readonly interactive: boolean;
  readonly confirmDetectedAgents?: (agents: readonly string[]) => Promise<boolean>;
  readonly createTemporaryDirectory?: () => Promise<string>;
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
}

function invalidSetupOptions(
  message: string,
  context?: Readonly<Record<string, unknown>>,
): OpsiError {
  return new OpsiError({
    code: "AGENT_SETUP_OPTIONS_INVALID",
    message,
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Choose either --agent or --all and provide every agent ID once.",
    ...(context === undefined ? {} : { context }),
  });
}

function validateAgentSelection(request: AgentSetupRequest, registry: AgentHostRegistry): void {
  if (request.agents !== undefined) {
    if (request.agents.length === 0 || request.agents.some((agent) => agent.trim().length === 0)) {
      throw invalidSetupOptions("At least one non-empty agent ID is required with --agent.");
    }
    if (new Set(request.agents).size !== request.agents.length) {
      throw invalidSetupOptions("Agent IDs must not be repeated.");
    }
  }
  if (request.all === true && request.agents !== undefined) {
    throw invalidSetupOptions("--all cannot be combined with --agent.");
  }
  if (request.agents !== undefined) {
    const supported = new Set(registry.supportedAgentIds);
    const invalidAgents = request.agents.filter((agent) => !supported.has(agent));
    if (invalidAgents.length > 0) {
      throw invalidSetupOptions(`Unsupported agent IDs: ${invalidAgents.join(", ")}.`, {
        invalidAgents,
      });
    }
  }
}

export function buildAgentInstallerArguments(
  sourceDirectory: string,
  agents: readonly string[],
): readonly string[] {
  if (agents.length === 0) throw invalidSetupOptions("At least one resolved agent ID is required.");
  const arguments_: string[] = [
    "add",
    sourceDirectory,
    "--global",
    "--skill",
    "*",
    "--agent",
    ...agents,
  ];
  arguments_.push("--copy");
  // OPSI owns selection and confirmation. The pinned installer must never open its own prompts,
  // because those include a follow-up offer to fetch an unrelated remote skill.
  arguments_.push("--yes");
  return arguments_;
}

function selection(request: AgentSetupRequest): AgentSetupResult["selection"] {
  if (request.all === true) return "all";
  return request.agents === undefined ? "detected" : [...request.agents];
}

async function defaultTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opsi-agent-setup-"));
  try {
    await chmod(directory, 0o700);
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function defaultRemoveTemporaryDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function setupAgents(options: SetupAgentsOptions): Promise<AgentSetupResult> {
  validateAgentSelection(options.request, options.registry);
  const plannedAgents =
    options.request.agents === undefined
      ? options.request.all === true
        ? [...options.registry.supportedAgentIds]
        : []
      : [...options.request.agents];
  const baseResult = {
    installer: AGENT_INSTALLER_VERSION,
    scope: "global",
    selection: selection(options.request),
    skills: AGENT_SKILLS.map((skill) => skill.name),
    agents: plannedAgents,
    dryRun: options.request.dryRun === true,
  } as const satisfies AgentSetupResult;
  if (options.request.dryRun === true) return baseResult;

  const resolvedAgents =
    options.request.agents !== undefined
      ? [...options.request.agents]
      : options.request.all === true
        ? [...options.registry.supportedAgentIds]
        : [
            ...(await options.registry.detect({
              cwd: options.cwd,
              home: options.home,
              env: options.env,
            })),
          ];
  if (resolvedAgents.length === 0) {
    throw new OpsiError({
      code: "AGENT_HOSTS_NOT_DETECTED",
      message: "No supported globally installable agent host was detected.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      suggestion: "Install a supported agent, choose one with --agent, or target all with --all.",
    });
  }
  if (
    options.request.agents === undefined &&
    options.request.all !== true &&
    options.request.yes !== true &&
    options.interactive &&
    resolvedAgents.length > 1
  ) {
    const confirmed = await options.confirmDetectedAgents?.(resolvedAgents);
    if (confirmed !== true) {
      throw new OpsiError({
        code: "AGENT_SETUP_CANCELLED",
        message: "Agent setup was cancelled before installation.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        suggestion: "Run again with --yes, --agent, or --all when ready.",
      });
    }
  }
  const result = { ...baseResult, agents: resolvedAgents } satisfies AgentSetupResult;

  const createTemporaryDirectory = options.createTemporaryDirectory ?? defaultTemporaryDirectory;
  const removeTemporaryDirectory =
    options.removeTemporaryDirectory ?? defaultRemoveTemporaryDirectory;
  const sourceDirectory = await createTemporaryDirectory();
  try {
    await generateAgentSkills({
      cwd: options.cwd,
      outputDirectory: sourceDirectory,
      version: options.version,
    });
    const installerResult = await options.runner.run({
      arguments: buildAgentInstallerArguments(sourceDirectory, resolvedAgents),
      cwd: options.cwd,
      env: options.env.HOME === undefined ? { ...options.env, HOME: options.home } : options.env,
      interactive: false,
    });
    const diagnostic = installerResult.stderr.trim() || installerResult.stdout.trim();
    if (/Failed to install\s+\d+/u.test(`${installerResult.stdout}\n${installerResult.stderr}`)) {
      throw new OpsiError({
        code: "AGENT_SETUP_PARTIAL",
        message: "The Agent Skills installer could not install every selected target.",
        exitCode: EXIT_CODES.PARTIAL_SUCCESS,
        suggestion: "Review the installer diagnostic, correct target permissions, and try again.",
        ...(diagnostic.length === 0 ? {} : { context: { diagnostic } }),
      });
    }
    if (installerResult.exitCode !== 0) {
      throw new OpsiError({
        code: "AGENT_SETUP_FAILED",
        message: "The Agent Skills installer could not complete OPSI setup.",
        exitCode: EXIT_CODES.INTERNAL,
        suggestion: "Review the installer diagnostic, correct the agent selection, and try again.",
        context: {
          installerExitCode: installerResult.exitCode,
          ...(diagnostic.length === 0 ? {} : { diagnostic }),
        },
      });
    }
  } catch (error) {
    await removeTemporaryDirectory(sourceDirectory).catch(() => undefined);
    throw error;
  }
  try {
    await removeTemporaryDirectory(sourceDirectory);
  } catch (cleanupError) {
    throw new OpsiError({
      code: "AGENT_SETUP_CLEANUP_FAILED",
      message: "OPSI installed the skills but could not remove its temporary source.",
      exitCode: EXIT_CODES.INTERNAL,
      suggestion: `Remove the temporary directory manually: ${sourceDirectory}`,
      context: { sourceDirectory },
      cause: cleanupError,
    });
  }
  return result;
}
