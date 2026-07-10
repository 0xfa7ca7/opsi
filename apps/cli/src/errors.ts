import { EXIT_CODES, OpsiError, type ExitCode } from "@opsi/domain";
import { renderDelimited, renderJson, renderNdjson, sanitizeTerminalText } from "@opsi/output";
import type { OutputFormat } from "@opsi/config";
import type { CliIo } from "./context.js";

const SECRET_VALUE = /((?:api[_-]?key|token|secret|authorization|cookie)\s*[=:]\s*)\S+/giu;

function redact(text: string): string {
  return text.replace(SECRET_VALUE, "$1[REDACTED]");
}

export function normalizeError(error: unknown): OpsiError {
  if (error instanceof OpsiError) return error;
  return new OpsiError({
    code: "INTERNAL_ERROR",
    message: "An unexpected internal error occurred.",
    exitCode: EXIT_CODES.INTERNAL,
    suggestion: "Run again with --debug for diagnostic details.",
    cause: error,
  });
}

export function writeReadableError(error: OpsiError, io: CliIo, debug = false): void {
  const lines = [`${error.code}: ${sanitizeTerminalText(error.message)}`];
  if (error.suggestion !== undefined) {
    lines.push(`Suggestion: ${sanitizeTerminalText(error.suggestion)}`);
  }
  if (debug && error.cause instanceof Error && error.cause.stack !== undefined) {
    lines.push(redact(sanitizeTerminalText(error.cause.stack)));
  }
  io.stderr.write(`${lines.join("\n")}\n`);
}

export function writeStructuredError(error: OpsiError, io: CliIo, format: OutputFormat): void {
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
  options: { readonly format?: OutputFormat; readonly debug?: boolean } = {},
): ExitCode {
  const opsiError = normalizeError(error);
  if (options.format !== undefined && options.format !== "human") {
    writeStructuredError(opsiError, io, options.format);
  } else {
    writeReadableError(opsiError, io, options.debug);
  }
  return opsiError.exitCode;
}
