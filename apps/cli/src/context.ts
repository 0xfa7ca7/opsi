import type { OpsiConfiguration } from "@opsi/config";
import type { Renderer, WritableOutput } from "@opsi/output";

export interface CliIo {
  readonly cwd?: string;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdout: WritableOutput;
  readonly stderr: WritableOutput;
}

export interface CliContext {
  readonly io: CliIo;
  readonly version: string;
  readonly configuration?: OpsiConfiguration;
  readonly renderer?: Renderer;
}

export function processIo(): CliIo {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
