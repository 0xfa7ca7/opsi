import { EXIT_CODES, KlopsiError, type ExitCode } from "@klopsi/domain";
import { renderDelimited, renderJson, renderNdjson, sanitizeTerminalText } from "@klopsi/output";
import type { OutputFormat } from "@klopsi/config";
import type { CliIo } from "./context.js";
import { createPresentation } from "./presentation.js";

const SECRET_VALUE = /((?:api[_-]?key|token|secret|authorization|cookie)\s*[=:]\s*)\S+/giu;

function redact(text: string): string {
  return text.replace(SECRET_VALUE, "$1[REDACTED]");
}

export function normalizeError(error: unknown): KlopsiError {
  if (error instanceof KlopsiError) return error;
  const raw = error as NodeJS.ErrnoException;
  if (
    (raw.code === "ERR_MODULE_NOT_FOUND" || raw.code === "MODULE_NOT_FOUND") &&
    /duckdb/iu.test(raw.message ?? "")
  )
    return new KlopsiError({
      code: "DUCKDB_UNAVAILABLE",
      message: `DuckDB native bindings are unavailable for ${process.platform}/${process.arch}.`,
      exitCode: EXIT_CODES.UNSUPPORTED,
      suggestion:
        "Install optional dependencies on a supported Node 24 platform (Linux x64 glibc, macOS arm64, or Windows x64), then reinstall klopsi.",
      cause: error,
    });
  return new KlopsiError({
    code: "INTERNAL_ERROR",
    message: "An unexpected internal error occurred.",
    exitCode: EXIT_CODES.INTERNAL,
    suggestion: "Run again with --debug for diagnostic details.",
    cause: error,
  });
}

export function writeReadableError(
  error: KlopsiError,
  io: CliIo,
  debug = false,
  color = false,
): void {
  const presentation = createPresentation({ color: color && io.stderr.isTTY === true });
  const lines = [presentation.heading(`${error.code}: ${sanitizeTerminalText(error.message)}`)];
  if (error.suggestion !== undefined) {
    lines.push(`${presentation.command("Suggestion:")} ${sanitizeTerminalText(error.suggestion)}`);
  }
  if (debug && error.cause instanceof Error && error.cause.stack !== undefined) {
    lines.push(redact(sanitizeTerminalText(error.cause.stack)));
  }
  io.stderr.write(`${lines.join("\n")}\n`);
}

export function writeStructuredError(error: KlopsiError, io: CliIo, format: OutputFormat): void {
  const record = error.toJSON();
  const data = error.context?.data ?? null;
  switch (format) {
    case "json":
      io.stdout.write(
        renderJson({
          data: error.code === "PARTIAL_DOWNLOAD" ? (error.context?.data ?? []) : data,
          meta:
            error.code === "PARTIAL_DOWNLOAD" ? { failures: error.context?.failures ?? [] } : {},
          error: record,
        }),
      );
      break;
    case "ndjson":
      io.stdout.write(renderNdjson([{ schemaVersion: "1", data: null, error: record }]));
      break;
    case "csv":
      io.stdout.write(renderDelimited([record], ","));
      break;
    case "tsv":
      io.stdout.write(renderDelimited([record], "\t"));
      break;
    case "human":
      writeReadableError(error, io);
      break;
  }
}

export function handleRuntimeError(
  error: unknown,
  io: CliIo,
  options: {
    readonly format?: OutputFormat;
    readonly debug?: boolean;
    readonly color?: boolean;
  } = {},
): ExitCode {
  const klopsiError = normalizeError(error);
  if (options.format !== undefined && options.format !== "human") {
    writeStructuredError(klopsiError, io, options.format);
  } else {
    writeReadableError(klopsiError, io, options.debug, options.color);
  }
  return klopsiError.exitCode;
}
