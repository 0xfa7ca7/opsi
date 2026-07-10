import type { CliConfigurationOptions, OutputFormat } from "@opsi/config";
import { InvalidArgumentError, Option, type Command } from "commander";

const OUTPUT_FORMATS = ["table", "json", "ndjson", "csv", "tsv"] as const;
const STRUCTURED_FORMATS = ["json", "ndjson", "csv", "tsv"] as const;

export interface GlobalOptions {
  readonly provider?: string;
  readonly outputFormat?: (typeof OUTPUT_FORMATS)[number];
  readonly offline?: boolean;
  readonly cacheDir?: string;
  readonly downloadDir?: string;
  readonly httpTimeoutMs?: number;
  readonly maxDownloadBytes?: number;
  readonly previewRowLimit?: number;
  readonly queryRowLimit?: number;
  readonly queryTimeoutMs?: number;
  readonly duckdbMemoryLimit?: string;
  readonly duckdbThreads?: number;
  readonly color?: boolean;
  readonly quiet?: boolean;
  readonly debug?: boolean;
  readonly json?: boolean;
  readonly ndjson?: boolean;
  readonly csv?: boolean;
  readonly tsv?: boolean;
}

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

export function addGlobalOptions(program: Command): Command {
  program
    .addOption(
      new Option("--json", "render JSON").conflicts(["ndjson", "csv", "tsv", "outputFormat"]),
    )
    .addOption(
      new Option("--ndjson", "render newline-delimited JSON").conflicts([
        "json",
        "csv",
        "tsv",
        "outputFormat",
      ]),
    )
    .addOption(
      new Option("--csv", "render CSV").conflicts(["json", "ndjson", "tsv", "outputFormat"]),
    )
    .addOption(
      new Option("--tsv", "render TSV").conflicts(["json", "ndjson", "csv", "outputFormat"]),
    )
    .addOption(
      new Option("--output-format <format>", "select output format").choices([...OUTPUT_FORMATS]),
    )
    .option("--provider <id>", "select provider")
    .option("--offline", "disable network access")
    .option("--cache-dir <path>", "override cache directory")
    .option("--download-dir <path>", "override download directory")
    .option("--http-timeout-ms <number>", "HTTP timeout in milliseconds", integer)
    .option("--max-download-bytes <number>", "maximum download size", integer)
    .option("--preview-row-limit <number>", "preview row limit", integer)
    .option("--query-row-limit <number>", "query row limit", integer)
    .option("--query-timeout-ms <number>", "query timeout in milliseconds", integer)
    .option("--duckdb-memory-limit <limit>", "DuckDB memory limit")
    .option("--duckdb-threads <number>", "DuckDB worker threads", integer)
    .option("--quiet", "suppress non-result output")
    .option("--debug", "include diagnostic stack traces")
    .option("--no-color", "disable color output");
  return program;
}

function optionValue(argv: readonly string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  for (const [index, token] of argv.entries()) {
    if (token.startsWith(equalsPrefix)) return token.slice(equalsPrefix.length);
    if (token === name) {
      const next = argv[index + 1];
      return next !== undefined && !next.startsWith("-") ? next : undefined;
    }
  }
  return undefined;
}

function positiveInteger(argv: readonly string[], name: string): number | undefined {
  const value = optionValue(argv, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function requestedOutputFormat(argv: readonly string[]): OutputFormat | undefined {
  for (const format of STRUCTURED_FORMATS) {
    if (argv.includes(`--${format}`)) return format;
  }
  const output = optionValue(argv, "--output-format");
  if (output === "table") return "human";
  return STRUCTURED_FORMATS.includes(output as (typeof STRUCTURED_FORMATS)[number])
    ? (output as OutputFormat)
    : undefined;
}

export function cliConfigurationFromArgv(argv: readonly string[]): CliConfigurationOptions {
  const provider = optionValue(argv, "--provider");
  const output = requestedOutputFormat(argv);
  const cacheDir = optionValue(argv, "--cache-dir");
  const downloadDir = optionValue(argv, "--download-dir");
  const httpTimeoutMs = positiveInteger(argv, "--http-timeout-ms");
  const maxDownloadBytes = positiveInteger(argv, "--max-download-bytes");
  const previewRowLimit = positiveInteger(argv, "--preview-row-limit");
  const queryRowLimit = positiveInteger(argv, "--query-row-limit");
  const queryTimeoutMs = positiveInteger(argv, "--query-timeout-ms");
  const duckdbMemoryLimit = optionValue(argv, "--duckdb-memory-limit");
  const duckdbThreads = positiveInteger(argv, "--duckdb-threads");
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(output === undefined ? {} : { output }),
    ...(argv.includes("--offline") ? { offline: true } : {}),
    ...(cacheDir === undefined ? {} : { cacheDir }),
    ...(downloadDir === undefined ? {} : { downloadDir }),
    ...(httpTimeoutMs === undefined ? {} : { httpTimeoutMs }),
    ...(maxDownloadBytes === undefined ? {} : { maxDownloadBytes }),
    ...(previewRowLimit === undefined ? {} : { previewRowLimit }),
    ...(queryRowLimit === undefined ? {} : { queryRowLimit }),
    ...(queryTimeoutMs === undefined ? {} : { queryTimeoutMs }),
    ...(duckdbMemoryLimit === undefined ? {} : { duckdbMemoryLimit }),
    ...(duckdbThreads === undefined ? {} : { duckdbThreads }),
    ...(argv.includes("--no-color") ? { color: false } : {}),
  };
}
