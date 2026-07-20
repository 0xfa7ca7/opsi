import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type {
  AgentInstallerRunner,
  AgentInstallerRunRequest,
  AgentInstallerRunResult,
} from "./agent-setup.js";

const MAX_CAPTURE_BYTES = 1024 * 1024;
const TRUNCATION_MARKER = Buffer.from("\n[installer output truncated]\n", "utf8");

export type SpawnAgentInstallerProcess = (
  command: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface SkillsAgentInstallerRunnerOptions {
  readonly resolveInstaller?: () => string;
  readonly spawnProcess?: SpawnAgentInstallerProcess;
}

function unavailable(cause: unknown): OpsiError {
  return new OpsiError({
    code: "AGENT_INSTALLER_UNAVAILABLE",
    message: "The pinned Agent Skills installer is unavailable.",
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion: "Reinstall opsi so its skills runtime dependency is present, then try again.",
    cause,
  });
}

function defaultResolveInstaller(): string {
  return createRequire(import.meta.url).resolve("skills/bin/cli.mjs");
}

interface CapturedOutput {
  readonly content: Buffer;
  readonly truncated: boolean;
}

function appendBounded(current: CapturedOutput, chunk: Buffer | string): CapturedOutput {
  const value = Buffer.from(chunk);
  const available = MAX_CAPTURE_BYTES - current.content.length;
  if (available <= 0) return { content: current.content, truncated: true };
  return {
    content: Buffer.concat([current.content, value.subarray(0, available)]),
    truncated: current.truncated || value.length > available,
  };
}

function capturedText(value: CapturedOutput): string {
  if (!value.truncated) return value.content.toString("utf8");
  const contentBytes = MAX_CAPTURE_BYTES - TRUNCATION_MARKER.length;
  return Buffer.concat([value.content.subarray(0, contentBytes), TRUNCATION_MARKER]).toString(
    "utf8",
  );
}

export class SkillsAgentInstallerRunner implements AgentInstallerRunner {
  readonly #resolveInstaller: () => string;
  readonly #spawnProcess: SpawnAgentInstallerProcess;

  constructor(options: SkillsAgentInstallerRunnerOptions = {}) {
    this.#resolveInstaller = options.resolveInstaller ?? defaultResolveInstaller;
    this.#spawnProcess = options.spawnProcess ?? spawn;
  }

  async run(request: AgentInstallerRunRequest): Promise<AgentInstallerRunResult> {
    let installer: string;
    let child: ChildProcess;
    try {
      installer = this.#resolveInstaller();
      child = this.#spawnProcess(process.execPath, [installer, ...request.arguments], {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: request.interactive ? "inherit" : ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw unavailable(error);
    }

    return await new Promise<AgentInstallerRunResult>((resolve, reject) => {
      let stdout: CapturedOutput = { content: Buffer.alloc(0), truncated: false };
      let stderr: CapturedOutput = { content: Buffer.alloc(0), truncated: false };
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr = appendBounded(stderr, chunk);
      });
      child.once("error", (error) => reject(unavailable(error)));
      child.once("close", (code) =>
        resolve({
          exitCode: code ?? EXIT_CODES.INTERNAL,
          stdout: capturedText(stdout),
          stderr: capturedText(stderr),
        }),
      );
    });
  }
}
