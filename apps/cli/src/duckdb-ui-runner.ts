import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";

export const DUCKDB_CLI_VERSION = "1.5.4";

const MAX_VERSION_BYTES = 4 * 1024;
const MAX_INSTALLER_BYTES = 1024 * 1024;
const INSTALLER_TIMEOUT_MS = 30_000;

export interface DuckDbCliInfo {
  readonly executable: string;
  readonly version: string;
}

export interface DuckDbUiRunner {
  inspect(): Promise<DuckDbCliInfo | undefined>;
  install(): Promise<DuckDbCliInfo>;
  open(info: DuckDbCliInfo, databasePath: string): Promise<DuckDbCliInfo>;
}

export type SpawnDuckDbProcess = (
  command: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

type FetchInstaller = (
  url: string,
  options: { readonly redirect: "error"; readonly signal: AbortSignal },
) => Promise<Response>;

export interface ProcessDuckDbUiRunnerOptions {
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly spawnProcess?: SpawnDuckDbProcess;
  readonly fetchInstaller?: FetchInstaller;
  readonly installerTimeoutMs?: number;
  readonly makeTemporaryDirectory?: () => Promise<string>;
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
}

interface InstallerTarget {
  readonly url: string;
  readonly filename: string;
  readonly command: (path: string) => {
    readonly executable: string;
    readonly arguments: readonly string[];
  };
  readonly installedExecutable: (home: string) => string;
}

export function duckDbCliUnavailable(cause?: unknown): KlopsiError {
  return new KlopsiError({
    code: "DUCKDB_CLI_UNAVAILABLE",
    message: "The optional DuckDB CLI is unavailable.",
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion: "Run `klopsi duckdb install --yes`, or add `--install` to `klopsi duckdb open`.",
    ...(cause === undefined ? {} : { cause }),
  });
}

function installUnsupported(platform: NodeJS.Platform, arch: string): KlopsiError {
  return new KlopsiError({
    code: "DUCKDB_CLI_INSTALL_UNSUPPORTED",
    message: `Automatic DuckDB CLI installation is unsupported for ${platform}/${arch}.`,
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion: "Install the DuckDB CLI manually from https://duckdb.org/docs/installation/.",
    context: { platform, arch },
  });
}

function installFailed(cause?: unknown): KlopsiError {
  return new KlopsiError({
    code: "DUCKDB_CLI_INSTALL_FAILED",
    message: "The optional DuckDB CLI could not be installed.",
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion:
      "Check network access and installer prerequisites, then retry or install DuckDB manually.",
    ...(cause === undefined ? {} : { cause }),
  });
}

function uiFailed(cause?: unknown, childExitCode?: number): KlopsiError {
  return new KlopsiError({
    code: "DUCKDB_UI_FAILED",
    message: "DuckDB UI did not complete successfully.",
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    suggestion: "Check the DuckDB CLI diagnostics above, then retry with a supported input.",
    ...(childExitCode === undefined ? {} : { context: { childExitCode } }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function installerTarget(platform: NodeJS.Platform, arch: string): InstallerTarget {
  if ((platform === "linux" && arch === "x64") || (platform === "darwin" && arch === "arm64")) {
    return {
      url: "https://install.duckdb.org",
      filename: "install.sh",
      command: (path) => ({ executable: "sh", arguments: [path] }),
      installedExecutable: (home) => join(home, ".duckdb", "cli", DUCKDB_CLI_VERSION, "duckdb"),
    };
  }
  if (platform === "win32" && arch === "x64") {
    return {
      url: "https://install.duckdb.org/install.ps1",
      filename: "install.ps1",
      command: (path) => ({
        executable: "powershell.exe",
        arguments: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path],
      }),
      installedExecutable: (home) => join(home, ".duckdb", "cli", DUCKDB_CLI_VERSION, "duckdb.exe"),
    };
  }
  throw installUnsupported(platform, arch);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function workbenchInvocation(databasePath: string): readonly string[] {
  const workbenchPath = join(dirname(databasePath), "workbench.duckdb");
  const prepare =
    `ATTACH ${sqlString(databasePath)} AS dataset (READ_ONLY); ` +
    "CREATE VIEW main.data AS SELECT * FROM dataset.main.data;";
  return [workbenchPath, "-cmd", prepare, "-ui"];
}

type BodyChunkResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

async function readBodyChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<BodyChunkResult> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<BodyChunkResult>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      operation();
    };
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      finish(() => reject(signal.reason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function boundedBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.ok || response.body === null) throw installFailed();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  while (true) {
    const next = await readBodyChunk(reader, signal);
    if (next.done) break;
    const chunk = Buffer.from(next.value);
    bytes += chunk.length;
    if (bytes > MAX_INSTALLER_BYTES) {
      await reader.cancel();
      throw installFailed();
    }
    chunks.push(chunk);
  }
  if (bytes === 0) throw installFailed();
  return Buffer.concat(chunks);
}

export class ProcessDuckDbUiRunner implements DuckDbUiRunner {
  readonly #home: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #platform: NodeJS.Platform;
  readonly #arch: string;
  readonly #spawnProcess: SpawnDuckDbProcess;
  readonly #fetchInstaller: FetchInstaller;
  readonly #installerTimeoutMs: number;
  readonly #makeTemporaryDirectory: () => Promise<string>;
  readonly #removeTemporaryDirectory: (path: string) => Promise<void>;

  constructor(options: ProcessDuckDbUiRunnerOptions) {
    this.#home = options.home;
    this.#env = options.env;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, arguments_, spawnOptions) => spawn(command, [...arguments_], spawnOptions));
    this.#fetchInstaller =
      options.fetchInstaller ?? ((url, fetchOptions) => fetch(url, fetchOptions));
    this.#installerTimeoutMs = options.installerTimeoutMs ?? INSTALLER_TIMEOUT_MS;
    this.#makeTemporaryDirectory =
      options.makeTemporaryDirectory ?? (() => mkdtemp(join(tmpdir(), "klopsi-duckdb-install-")));
    this.#removeTemporaryDirectory =
      options.removeTemporaryDirectory ?? ((path) => rm(path, { recursive: true, force: true }));
  }

  async #run(
    command: string,
    arguments_: readonly string[],
    options: { readonly capture: boolean; readonly env?: NodeJS.ProcessEnv },
  ): Promise<ProcessResult> {
    const child = this.#spawnProcess(command, arguments_, {
      env: options.env ?? this.#env,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    return await new Promise<ProcessResult>((resolve, reject) => {
      let settled = false;
      let stdout = Buffer.alloc(0);
      child.stdout?.on("data", (raw: Buffer | string) => {
        if (stdout.length >= MAX_VERSION_BYTES) return;
        const chunk = Buffer.from(raw);
        stdout = Buffer.concat([stdout, chunk.subarray(0, MAX_VERSION_BYTES - stdout.length)]);
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        resolve({
          exitCode: code ?? EXIT_CODES.INTERNAL,
          stdout: stdout.toString("utf8"),
        });
      });
    });
  }

  async #inspectExecutable(executable: string): Promise<DuckDbCliInfo | undefined> {
    let result: ProcessResult;
    try {
      result = await this.#run(executable, ["-version"], { capture: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw duckDbCliUnavailable(error);
    }
    const version = result.stdout.trim();
    if (result.exitCode !== 0 || version.length === 0) throw duckDbCliUnavailable();
    return { executable, version };
  }

  inspect(): Promise<DuckDbCliInfo | undefined> {
    return this.#inspectExecutable("duckdb");
  }

  async install(): Promise<DuckDbCliInfo> {
    const target = installerTarget(this.#platform, this.#arch);
    let directory: string | undefined;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#installerTimeoutMs);
      timeout.unref();
      let installer: Buffer;
      try {
        const response = await this.#fetchInstaller(target.url, {
          redirect: "error",
          signal: controller.signal,
        });
        installer = await boundedBody(response, controller.signal);
      } finally {
        clearTimeout(timeout);
      }
      directory = await this.#makeTemporaryDirectory();
      const path = join(directory, target.filename);
      await writeFile(path, installer, { flag: "wx", mode: 0o700 });
      const invocation = target.command(path);
      const result = await this.#run(invocation.executable, invocation.arguments, {
        capture: false,
        env: { ...this.#env, DUCKDB_VERSION: DUCKDB_CLI_VERSION },
      });
      if (result.exitCode !== 0) throw installFailed();
      const discovered = await this.inspect();
      if (discovered !== undefined) return discovered;
      const installed = await this.#inspectExecutable(target.installedExecutable(this.#home));
      if (installed === undefined) throw installFailed();
      return installed;
    } catch (error) {
      if (
        error instanceof KlopsiError &&
        (error.code === "DUCKDB_CLI_INSTALL_FAILED" ||
          error.code === "DUCKDB_CLI_INSTALL_UNSUPPORTED")
      )
        throw error;
      throw installFailed(error);
    } finally {
      if (directory !== undefined) await this.#removeTemporaryDirectory(directory);
    }
  }

  async open(info: DuckDbCliInfo, databasePath: string): Promise<DuckDbCliInfo> {
    let result: ProcessResult;
    try {
      result = await this.#run(info.executable, workbenchInvocation(databasePath), {
        capture: false,
      });
    } catch (error) {
      throw uiFailed(error);
    }
    if (result.exitCode !== 0) throw uiFailed(undefined, result.exitCode);
    return info;
  }
}
