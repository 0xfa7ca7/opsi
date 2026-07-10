import { duckDbMemoryLimitBytes, EXIT_CODES, OpsiError } from "@opsi/domain";
import { z } from "zod";

export const outputFormatSchema = z.enum(["human", "json", "ndjson", "csv", "tsv"]);

const pathsSchema = z.strictObject({
  cacheDir: z.string().min(1),
  downloadDir: z.string().min(1),
});

const httpSchema = z.strictObject({
  timeoutMs: z.number().int().positive(),
  maxDownloadBytes: z.number().int().positive(),
});

const previewSchema = z.strictObject({
  rowLimit: z.number().int().positive(),
});

const querySchema = z.strictObject({
  rowLimit: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
});

const duckdbSchema = z.strictObject({
  memoryLimit: z.string().refine((value) => duckDbMemoryLimitBytes(value) !== undefined, {
    message: "must be a supported positive byte size no larger than 1GiB",
  }),
  threads: z.number().int().positive().max(4),
});

const terminalSchema = z.strictObject({
  color: z.boolean(),
});

export const configurationSchema = z.strictObject({
  provider: z.string().trim().min(1),
  output: outputFormatSchema,
  locale: z.string().trim().min(1),
  offline: z.boolean(),
  paths: pathsSchema,
  http: httpSchema,
  preview: previewSchema,
  query: querySchema,
  duckdb: duckdbSchema,
  terminal: terminalSchema,
  apiKey: z.string().min(1).optional(),
});

export const configurationSourceSchema = z.strictObject({
  provider: z.string().trim().min(1).optional(),
  output: outputFormatSchema.optional(),
  locale: z.string().trim().min(1).optional(),
  offline: z.boolean().optional(),
  paths: pathsSchema.partial().optional(),
  http: httpSchema.partial().optional(),
  preview: previewSchema.partial().optional(),
  query: querySchema.partial().optional(),
  duckdb: duckdbSchema.partial().optional(),
  terminal: terminalSchema.partial().optional(),
});

export type OutputFormat = z.infer<typeof outputFormatSchema>;
export type OpsiConfiguration = z.infer<typeof configurationSchema>;
export type ConfigurationSource = z.infer<typeof configurationSourceSchema>;

export function invalidConfiguration(cause: unknown): OpsiError {
  const detail =
    cause instanceof z.ZodError
      ? cause.issues
          .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
          .join("; ")
      : cause instanceof Error
        ? cause.message
        : "The configuration could not be read.";

  return new OpsiError({
    code: "INVALID_CONFIGURATION",
    message: `Invalid configuration: ${detail}`,
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Correct the configuration value or remove the invalid setting.",
    cause,
  });
}

export function parseConfigurationSource(value: unknown): ConfigurationSource {
  const parsed = configurationSourceSchema.safeParse(value);
  if (!parsed.success) throw invalidConfiguration(parsed.error);
  return parsed.data;
}

export function parseConfiguration(value: unknown): OpsiConfiguration {
  const parsed = configurationSchema.safeParse(value);
  if (!parsed.success) throw invalidConfiguration(parsed.error);
  return parsed.data;
}
