import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertSafeCount,
  buildPublication,
  retainedManifests,
  type CatalogueIndex,
  type CatalogueManifest,
  type CatalogueSnapshot,
} from "@klopsi/catalogue-snapshot";

const generatedAt = "2026-07-13T12:00:00.000Z";
const snapshot: CatalogueSnapshot = {
  schemaVersion: "1",
  generatedAt,
  count: 2,
  datasets: [
    { id: "a", title: "Dataset A", name: "alpha" },
    { id: "b", title: "Dataset B", name: "beta" },
  ],
};

describe("buildPublication", () => {
  it("builds deterministic snapshot bytes and a matching manifest", () => {
    const publication = buildPublication(snapshot);

    expect(new TextDecoder().decode(publication.snapshotBytes)).toBe(
      `${JSON.stringify(snapshot)}\n`,
    );
    expect(publication.manifest.bytes).toBe(publication.snapshotBytes.byteLength);
    expect(publication.manifest.sha256).toBe(
      createHash("sha256").update(publication.snapshotBytes).digest("hex"),
    );
    expect(publication.manifest.snapshotPath).toBe("v1/snapshots/2026-07-13T12-00-00.000Z.json");
  });
});

describe("assertSafeCount", () => {
  it("allows a reduction of exactly ten percent", () => {
    expect(() => assertSafeCount(100, 90, false)).not.toThrow();
  });

  it("rejects a reduction greater than ten percent", () => {
    expect(() => assertSafeCount(100, 89, false)).toThrowError(
      expect.objectContaining({
        code: "CATALOGUE_COUNT_REDUCTION",
        exitCode: 4,
        context: { previous: 100, next: 89 },
      }),
    );
  });

  it("allows an explicit manual reduction override", () => {
    expect(() => assertSafeCount(100, 1, true)).not.toThrow();
  });

  it("allows a first publication with no previous count", () => {
    expect(() => assertSafeCount(undefined, 1, false)).not.toThrow();
  });
});

describe("retainedManifests", () => {
  const now = new Date(generatedAt);

  it("retains snapshots at the exact 48-hour cutoff and sorts newest first", () => {
    const newer = manifest("2026-07-13T06:00:00.000Z", "newer");
    const cutoff = manifest("2026-07-11T12:00:00.000Z", "cutoff");
    const expired = manifest("2026-07-11T11:59:59.999Z", "expired");
    const index: CatalogueIndex = {
      schemaVersion: "1",
      snapshots: [cutoff, expired, newer],
    };

    expect(retainedManifests(index, now)).toEqual([newer, cutoff]);
  });

  it("rejects an invalid prior index instead of treating it as empty", () => {
    const invalid = {
      schemaVersion: "1",
      snapshots: [{ ...manifest(generatedAt, "invalid"), sha256: "not-a-digest" }],
    } as unknown as CatalogueIndex;

    expect(() => retainedManifests(invalid, now)).toThrowError(
      expect.objectContaining({
        code: "CATALOGUE_SNAPSHOT_INVALID",
        context: { field: "snapshots.0.sha256" },
      }),
    );
  });

  it("rejects duplicate retained snapshot paths", () => {
    const first = manifest("2026-07-13T06:00:00.000Z", "same");
    const duplicate = { ...first, generatedAt: "2026-07-13T05:00:00.000Z" };

    expect(() =>
      retainedManifests({ schemaVersion: "1", snapshots: [first, duplicate] }, now),
    ).toThrowError(
      expect.objectContaining({
        code: "CATALOGUE_SNAPSHOT_INVALID",
        context: { field: "snapshots.1.snapshotPath" },
      }),
    );
  });

  it("uses the snapshot path as a deterministic tie breaker", () => {
    const right = manifest(generatedAt, "zulu");
    const left = manifest(generatedAt, "alpha");

    expect(retainedManifests({ schemaVersion: "1", snapshots: [right, left] }, now)).toEqual([
      left,
      right,
    ]);
  });
});

function manifest(timestamp: string, name: string): CatalogueManifest {
  return {
    schemaVersion: "1",
    generatedAt: timestamp,
    snapshotPath: `v1/snapshots/${name}.json`,
    count: 2,
    bytes: 1,
    sha256: "a".repeat(64),
  };
}
