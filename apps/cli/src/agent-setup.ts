import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { AGENT_SKILLS, generateAgentSkills } from "./agent-skills.js";

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
  readonly dryRun: boolean;
}

export interface SetupAgentsOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly version: string;
  readonly request: AgentSetupRequest;
  readonly runner: AgentInstallerRunner;
  readonly interactive: boolean;
  readonly createTemporaryDirectory?: () => Promise<string>;
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
}

function invalidSetupOptions(message: string): OpsiError {
  return new OpsiError({
    code: "AGENT_SETUP_OPTIONS_INVALID",
    message,
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Choose either --agent or --all and provide every agent ID once.",
  });
}

function validateAgentSelection(request: AgentSetupRequest): void {
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
}

export function buildAgentInstallerArguments(
  sourceDirectory: string,
  request: AgentSetupRequest,
): readonly string[] {
  validateAgentSelection(request);
  const arguments_: string[] = ["add", sourceDirectory, "--global", "--skill", "*"];
  if (request.agents !== undefined) arguments_.push("--agent", ...request.agents);
  if (request.all === true) arguments_.push("--all");
  if (request.copy === true) arguments_.push("--copy");
  if (request.yes === true) arguments_.push("--yes");
  return arguments_;
}

function selection(request: AgentSetupRequest): AgentSetupResult["selection"] {
  if (request.all === true) return "all";
  return request.agents === undefined ? "detected" : [...request.agents];
}

async function defaultTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opsi-agent-setup-"));
  await chmod(directory, 0o700);
  return directory;
}

async function defaultRemoveTemporaryDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function setupAgents(options: SetupAgentsOptions): Promise<AgentSetupResult> {
  buildAgentInstallerArguments("embedded-opsi-skills", options.request);
  const result = {
    installer: AGENT_INSTALLER_VERSION,
    scope: "global",
    selection: selection(options.request),
    skills: AGENT_SKILLS.map((skill) => skill.name),
    dryRun: options.request.dryRun === true,
  } as const satisfies AgentSetupResult;
  if (options.request.dryRun === true) return result;

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
      arguments: buildAgentInstallerArguments(sourceDirectory, options.request),
      cwd: options.cwd,
      env: options.env,
      interactive: options.interactive,
    });
    if (installerResult.exitCode !== 0) {
      const diagnostic = installerResult.stderr.trim() || installerResult.stdout.trim();
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
    return result;
  } finally {
    await removeTemporaryDirectory(sourceDirectory);
  }
}
