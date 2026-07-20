#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfiguration, resolveConfigPaths } from "@opsi/config";
import { EXIT_CODES, type ExitCode } from "@opsi/domain";
import { Renderer } from "@opsi/output";
import { CommanderError } from "commander";
import { processIo, type CliIo } from "./context.js";
import { handleRuntimeError } from "./errors.js";
import { cliConfigurationFromArgv, requestedOutputFormat, selectedFields } from "./options.js";
import { createProgram, type ProgramDependencies } from "./program.js";

export type { CliContext, CliIo } from "./context.js";
export { createProgram } from "./program.js";

interface PackageMetadata {
  readonly version?: unknown;
}

export function readPackageVersion(
  packageUrl: URL = new URL("../package.json", import.meta.url),
): string {
  const metadata = JSON.parse(readFileSync(packageUrl, "utf8")) as PackageMetadata;
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Invalid package version metadata at ${packageUrl.href}`);
  }
  return metadata.version;
}

export const VERSION = readPackageVersion();

export async function runCli(
  argv: readonly string[],
  io: CliIo,
  dependencies: ProgramDependencies = {},
): Promise<ExitCode> {
  const requestedFormat = requestedOutputFormat(argv);
  const debug = argv.includes("--debug");

  try {
    const location = {
      ...(io.cwd === undefined ? {} : { cwd: io.cwd }),
      ...(io.home === undefined ? {} : { home: io.home }),
    };
    const paths = resolveConfigPaths(location);
    const configuration = await loadConfiguration({
      ...location,
      paths,
      ...(io.env === undefined ? {} : { env: io.env }),
      cli: cliConfigurationFromArgv(argv),
    });
    const fields = selectedFields(argv);
    const renderer = new Renderer({
      format: configuration.output,
      stdout: io.stdout,
      ...(fields === undefined ? {} : { fields }),
    });
    const program = createProgram({ io, version: VERSION, configuration, renderer }, dependencies);
    await program.parseAsync([...argv], { from: "user" });
    return EXIT_CODES.SUCCESS;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? EXIT_CODES.SUCCESS : EXIT_CODES.INVALID_INPUT;
    }
    return handleRuntimeError(error, io, {
      ...(requestedFormat === undefined ? {} : { format: requestedFormat }),
      debug,
    });
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && realpathSync(entrypoint) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), processIo());
}
