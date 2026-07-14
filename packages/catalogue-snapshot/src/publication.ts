import { createHash } from "node:crypto";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import {
  CATALOGUE_SCHEMA_VERSION,
  parseCatalogueIndex,
  parseCatalogueManifest,
  serializeSnapshot,
  type CatalogueIndex,
  type CatalogueManifest,
  type CatalogueSnapshot,
} from "./contracts.js";
import { snapshotInvalid } from "./errors.js";

const RETENTION_MS = 48 * 60 * 60 * 1_000;

export interface CataloguePublication {
  readonly manifest: CatalogueManifest;
  readonly snapshotBytes: Uint8Array;
}

export function buildPublication(snapshot: CatalogueSnapshot): CataloguePublication {
  const snapshotBytes = serializeSnapshot(snapshot);
  const manifest = parseCatalogueManifest({
    schemaVersion: CATALOGUE_SCHEMA_VERSION,
    generatedAt: snapshot.generatedAt,
    snapshotPath: `v1/snapshots/${snapshot.generatedAt.replaceAll(":", "-")}.json`,
    count: snapshot.count,
    bytes: snapshotBytes.byteLength,
    sha256: createHash("sha256").update(snapshotBytes).digest("hex"),
  });
  return { manifest, snapshotBytes };
}

export function assertSafeCount(
  previous: number | undefined,
  next: number,
  allowReduction: boolean,
): void {
  if (previous === undefined || allowReduction || next >= previous * 0.9) return;
  throw new OpsiError({
    code: "CATALOGUE_COUNT_REDUCTION",
    message: "The candidate catalogue count is more than ten percent below the prior count.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    context: { previous, next },
  });
}

export function retainedManifests(
  index: CatalogueIndex | undefined,
  now: Date,
): readonly CatalogueManifest[] {
  if (index === undefined) return [];
  const parsed = parseCatalogueIndex(index);
  const cutoff = now.getTime() - RETENTION_MS;
  if (Number.isNaN(cutoff)) throw snapshotInvalid("now");

  const retained = parsed.snapshots.filter(
    (manifest) => Date.parse(manifest.generatedAt) >= cutoff,
  );
  const paths = new Set<string>();
  for (const [position, manifest] of retained.entries()) {
    if (paths.has(manifest.snapshotPath))
      throw snapshotInvalid(`snapshots.${position}.snapshotPath`);
    paths.add(manifest.snapshotPath);
  }
  return retained.toSorted(
    (left, right) =>
      Date.parse(right.generatedAt) - Date.parse(left.generatedAt) ||
      compareText(left.snapshotPath, right.snapshotPath),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
