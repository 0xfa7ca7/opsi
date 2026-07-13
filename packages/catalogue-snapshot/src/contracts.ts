import { createHash } from "node:crypto";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { z } from "zod";

export const CATALOGUE_SCHEMA_VERSION = "1" as const;
export const CATALOGUE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const CATALOGUE_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
export const CATALOGUE_MAX_MANIFEST_BYTES = 64 * 1_024;
export const CATALOGUE_MAX_SNAPSHOT_BYTES = 10 * 1_024 * 1_024;

export interface CatalogueDataset {
  readonly id: string;
  readonly title: string;
  readonly name: string;
}

export interface CatalogueManifest {
  readonly schemaVersion: "1";
  readonly generatedAt: string;
  readonly snapshotPath: string;
  readonly count: number;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CatalogueSnapshot {
  readonly schemaVersion: "1";
  readonly generatedAt: string;
  readonly count: number;
  readonly datasets: readonly CatalogueDataset[];
}

export interface CatalogueIndex {
  readonly schemaVersion: "1";
  readonly snapshots: readonly CatalogueManifest[];
}

const nonEmptyStringSchema = z.string().min(1);
const utcTimestampSchema = z.iso.datetime({ offset: false });
const snapshotPathSchema = z
  .string()
  .regex(/^v1\/snapshots\/[A-Za-z0-9._-]+\.json$/u)
  .refine((path) => !path.endsWith("/.json") && !path.endsWith("/..json"));

const datasetSchema = z.strictObject({
  id: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
});

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(CATALOGUE_SCHEMA_VERSION),
  generatedAt: utcTimestampSchema,
  snapshotPath: snapshotPathSchema,
  count: z.number().int().nonnegative(),
  bytes: z.number().int().positive().max(CATALOGUE_MAX_SNAPSHOT_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

const snapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(CATALOGUE_SCHEMA_VERSION),
    generatedAt: utcTimestampSchema,
    count: z.number().int().nonnegative(),
    datasets: z.array(datasetSchema),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.count !== snapshot.datasets.length) {
      context.addIssue({ code: "custom", path: ["count"], message: "Count mismatch" });
    }

    const seenIds = new Set<string>();
    for (const [index, dataset] of snapshot.datasets.entries()) {
      if (seenIds.has(dataset.id)) {
        context.addIssue({
          code: "custom",
          path: ["datasets", index, "id"],
          message: "Duplicate dataset ID",
        });
      }
      seenIds.add(dataset.id);

      const previous = snapshot.datasets[index - 1];
      if (
        previous !== undefined &&
        (previous.name.localeCompare(dataset.name) > 0 ||
          (previous.name.localeCompare(dataset.name) === 0 &&
            previous.id.localeCompare(dataset.id) > 0))
      ) {
        context.addIssue({
          code: "custom",
          path: ["datasets", index],
          message: "Dataset ordering mismatch",
        });
      }
    }
  });

const indexSchema = z.strictObject({
  schemaVersion: z.literal(CATALOGUE_SCHEMA_VERSION),
  snapshots: z.array(manifestSchema),
});

export function parseCatalogueManifest(value: unknown): CatalogueManifest {
  return parseSchema(manifestSchema, value, "manifest") as CatalogueManifest;
}

export function parseCatalogueSnapshot(
  bytes: Uint8Array,
  manifest?: CatalogueManifest,
): CatalogueSnapshot {
  if (bytes.byteLength > CATALOGUE_MAX_SNAPSHOT_BYTES) {
    throw invalid("bytes");
  }

  const parsedManifest = manifest === undefined ? undefined : parseCatalogueManifest(manifest);
  if (parsedManifest !== undefined) {
    if (bytes.byteLength !== parsedManifest.bytes) {
      throw integrity("bytes");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== parsedManifest.sha256) {
      throw integrity("sha256");
    }
  }

  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    throw invalid("snapshot");
  }

  const snapshot = parseSchema(snapshotSchema, value, "snapshot") as CatalogueSnapshot;
  if (parsedManifest !== undefined) {
    if (snapshot.count !== parsedManifest.count) {
      throw invalid("count");
    }
    if (snapshot.generatedAt !== parsedManifest.generatedAt) {
      throw invalid("generatedAt");
    }
  }
  return snapshot;
}

export function parseCatalogueIndex(value: unknown): CatalogueIndex {
  return parseSchema(indexSchema, value, "index") as CatalogueIndex;
}

export function assertSnapshotFresh(generatedAt: string, now: Date = new Date()): void {
  const parsedTimestamp = utcTimestampSchema.safeParse(generatedAt);
  if (!parsedTimestamp.success || Number.isNaN(now.getTime())) {
    throw invalid("generatedAt");
  }

  const generatedTime = Date.parse(parsedTimestamp.data);
  const age = now.getTime() - generatedTime;
  if (age < -CATALOGUE_FUTURE_TOLERANCE_MS) {
    throw invalid("generatedAt");
  }
  if (age > CATALOGUE_MAX_AGE_MS) {
    throw new OpsiError({
      code: "CATALOGUE_SNAPSHOT_STALE",
      message: "The catalogue snapshot is older than 24 hours.",
      exitCode: EXIT_CODES.PROVIDER_FAILURE,
      context: { field: "generatedAt" },
    });
  }
}

export function serializeSnapshot(snapshot: CatalogueSnapshot): Uint8Array {
  const bytes = new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`);
  parseCatalogueSnapshot(bytes);
  return bytes;
}

function parseSchema(schema: z.ZodType, value: unknown, fallbackField: string): unknown {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalid(issueField(parsed.error, fallbackField));
  }
  return parsed.data;
}

function issueField(error: z.ZodError, fallbackField: string): string {
  const issue = error.issues[0];
  if (issue === undefined) return fallbackField;

  const path = issue.path.map(String);
  if (issue.code === "unrecognized_keys" && issue.keys[0] !== undefined) {
    path.push(issue.keys[0]);
  }
  return path.length === 0 ? fallbackField : path.join(".");
}

function invalid(field: string): OpsiError {
  return new OpsiError({
    code: "CATALOGUE_SNAPSHOT_INVALID",
    message: "Catalogue snapshot validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    context: { field },
  });
}

function integrity(field: string): OpsiError {
  return new OpsiError({
    code: "CATALOGUE_SNAPSHOT_INTEGRITY",
    message: "Catalogue snapshot integrity validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    context: { field },
  });
}
