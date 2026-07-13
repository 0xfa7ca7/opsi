import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_MAX_AGE_MS,
  CATALOGUE_MAX_SNAPSHOT_BYTES,
  assertSnapshotFresh,
  parseCatalogueIndex,
  parseCatalogueManifest,
  parseCatalogueSnapshot,
  serializeSnapshot,
  type CatalogueManifest,
  type CatalogueSnapshot,
} from "@opsi/catalogue-snapshot";

const generatedAt = "2026-07-13T12:00:00.000Z";
const now = new Date(generatedAt);

const validSnapshot: CatalogueSnapshot = {
  schemaVersion: "1",
  generatedAt,
  count: 2,
  datasets: [
    { id: "a", title: "Dataset A", name: "alpha" },
    { id: "b", title: "Dataset B", name: "beta" },
  ],
};

const validBytes = new TextEncoder().encode(`${JSON.stringify(validSnapshot)}\n`);
const validManifest: CatalogueManifest = {
  schemaVersion: "1",
  generatedAt,
  snapshotPath: "v1/snapshots/2026-07-13T12-00-00.000Z.json",
  count: 2,
  bytes: validBytes.byteLength,
  sha256: createHash("sha256").update(validBytes).digest("hex"),
};

function expectInvalid(call: () => unknown, field: string): void {
  expect(call).toThrowError(
    expect.objectContaining({
      code: "CATALOGUE_SNAPSHOT_INVALID",
      exitCode: 4,
      suggestion: expect.stringMatching(/Retry.*service status.*--live/u),
      context: { field },
    }),
  );
}

describe("catalogue snapshot version 1 contracts", () => {
  it("accepts the approved manifest and snapshot examples", () => {
    const value = { ...validManifest };
    const bytes = validBytes;

    const manifest = parseCatalogueManifest(value);
    const snapshot = parseCatalogueSnapshot(bytes, manifest);
    expect(() => assertSnapshotFresh(snapshot.generatedAt, now)).not.toThrow();
    expect(snapshot.datasets.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("accepts the approved retention index example", () => {
    expect(parseCatalogueIndex({ schemaVersion: "1", snapshots: [validManifest] })).toEqual({
      schemaVersion: "1",
      snapshots: [validManifest],
    });
  });

  it.each([
    ["manifest", () => parseCatalogueManifest({ ...validManifest, extra: true }), "extra"],
    [
      "snapshot",
      () =>
        parseCatalogueSnapshot(
          new TextEncoder().encode(`${JSON.stringify({ ...validSnapshot, extra: true })}\n`),
        ),
      "extra",
    ],
    [
      "dataset",
      () =>
        parseCatalogueSnapshot(
          new TextEncoder().encode(
            `${JSON.stringify({
              ...validSnapshot,
              datasets: [{ ...validSnapshot.datasets[0], extra: true }, validSnapshot.datasets[1]],
            })}\n`,
          ),
        ),
      "datasets.0.extra",
    ],
    [
      "index",
      () => parseCatalogueIndex({ schemaVersion: "1", snapshots: [validManifest], extra: true }),
      "extra",
    ],
  ])("rejects unknown keys in the %s schema", (_name, call, field) => {
    expectInvalid(call, field);
  });

  it.each([
    [
      "manifest timestamp",
      () => parseCatalogueManifest({ ...validManifest, generatedAt: "" }),
      "generatedAt",
    ],
    [
      "manifest path",
      () => parseCatalogueManifest({ ...validManifest, snapshotPath: "" }),
      "snapshotPath",
    ],
    [
      "dataset id",
      () => snapshotWithDatasets([{ id: "", title: "Dataset A", name: "alpha" }]),
      "datasets.0.id",
    ],
    [
      "dataset title",
      () => snapshotWithDatasets([{ id: "a", title: "", name: "alpha" }]),
      "datasets.0.title",
    ],
    [
      "dataset name",
      () => snapshotWithDatasets([{ id: "a", title: "Dataset A", name: "" }]),
      "datasets.0.name",
    ],
  ])("rejects an empty %s", (_name, call, field) => {
    expectInvalid(call, field);
  });

  it("rejects duplicate dataset IDs", () => {
    expectInvalid(
      () =>
        snapshotWithDatasets([
          { id: "a", title: "Dataset A", name: "alpha" },
          { id: "a", title: "Dataset A again", name: "beta" },
        ]),
      "datasets.1.id",
    );
  });

  it("rejects a snapshot count that differs from its datasets", () => {
    expectInvalid(
      () => parseCatalogueSnapshot(snapshotBytes({ ...validSnapshot, count: 1 })),
      "count",
    );
  });

  it.each([
    "/v1/snapshots/file.json",
    "https://example.test/v1/snapshots/file.json",
    "v1/snapshots/../file.json",
    "v1/snapshots/file.json?download=1",
    "v1/snapshots/file.json#fragment",
    "v1\\snapshots\\file.json",
    "v2/snapshots/file.json",
    "v1/snapshots/nested/file.json",
  ])("rejects unsafe snapshot path %s", (snapshotPath) => {
    expectInvalid(() => parseCatalogueManifest({ ...validManifest, snapshotPath }), "snapshotPath");
  });

  it.each(["g".repeat(64), "A".repeat(64), "0".repeat(63), "0".repeat(65)])(
    "rejects bad SHA-256 digest %s",
    (sha256) => {
      expectInvalid(() => parseCatalogueManifest({ ...validManifest, sha256 }), "sha256");
    },
  );

  it("rejects datasets not ordered by name then ID", () => {
    expectInvalid(
      () =>
        snapshotWithDatasets([
          { id: "b", title: "Dataset B", name: "same" },
          { id: "a", title: "Dataset A", name: "same" },
        ]),
      "datasets.1",
    );
  });

  it("validates Unicode code-unit ordering instead of locale-sensitive collation", () => {
    expect(() =>
      snapshotWithDatasets([
        { id: "a", title: "Dataset C cedilla", name: "Ç" },
        { id: "b", title: "Dataset C acute", name: "Ć" },
      ]),
    ).not.toThrow();
    expectInvalid(
      () =>
        snapshotWithDatasets([
          { id: "b", title: "Dataset C acute", name: "Ć" },
          { id: "a", title: "Dataset C cedilla", name: "Ç" },
        ]),
      "datasets.1",
    );
  });

  it.each([
    ["byte length", { ...validManifest, bytes: validManifest.bytes + 1 }],
    ["digest", { ...validManifest, sha256: "0".repeat(64) }],
  ])("rejects a manifest %s integrity mismatch", (_name, manifest) => {
    expect(() => parseCatalogueSnapshot(validBytes, manifest)).toThrowError(
      expect.objectContaining({
        code: "CATALOGUE_SNAPSHOT_INTEGRITY",
        exitCode: 4,
        suggestion: expect.stringMatching(/Retry.*service status.*--live/u),
        context: { field: _name === "digest" ? "sha256" : "bytes" },
      }),
    );
  });

  it.each([
    ["count", { ...validManifest, count: validManifest.count + 1 }],
    ["generatedAt", { ...validManifest, generatedAt: "2026-07-13T11:00:00.000Z" }],
  ])("rejects a manifest-to-snapshot %s mismatch", (field, manifest) => {
    expectInvalid(() => parseCatalogueSnapshot(validBytes, manifest), field);
  });

  it("rejects invalid JSON without exposing remote contents", () => {
    const secret = "must-never-leak";
    let received: unknown;
    try {
      parseCatalogueSnapshot(new TextEncoder().encode(`{"${secret}":`));
    } catch (error) {
      received = error;
    }

    expect(received).toMatchObject({
      code: "CATALOGUE_SNAPSHOT_INVALID",
      exitCode: 4,
      context: { field: "snapshot" },
    });
    expect(JSON.stringify(received)).not.toContain(secret);
    expect(received instanceof Error ? received.message : String(received)).not.toContain(secret);
  });

  it("rejects snapshots over the configured byte limit before parsing", () => {
    const oversized = new Uint8Array(CATALOGUE_MAX_SNAPSHOT_BYTES + 1);
    expectInvalid(() => parseCatalogueSnapshot(oversized), "bytes");
  });

  it("serializes a snapshot as one deterministic UTF-8 JSON line", () => {
    const serialized = serializeSnapshot(validSnapshot);

    expect(new TextDecoder().decode(serialized)).toBe(`${JSON.stringify(validSnapshot)}\n`);
    expect(serialized.byteLength).toBe(validManifest.bytes);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(validManifest.sha256);
  });
});

describe("catalogue snapshot freshness", () => {
  it("accepts a snapshot exactly 24 hours old", () => {
    expect(() =>
      assertSnapshotFresh(new Date(now.getTime() - CATALOGUE_MAX_AGE_MS).toISOString(), now),
    ).not.toThrow();
  });

  it("rejects a snapshot older than 24 hours", () => {
    expect(() =>
      assertSnapshotFresh(new Date(now.getTime() - CATALOGUE_MAX_AGE_MS - 1).toISOString(), now),
    ).toThrowError(
      expect.objectContaining({
        code: "CATALOGUE_SNAPSHOT_STALE",
        exitCode: 4,
        suggestion: expect.stringMatching(/Retry.*service status.*--live/u),
      }),
    );
  });

  it("accepts a timestamp exactly five minutes in the future", () => {
    expect(() =>
      assertSnapshotFresh(new Date(now.getTime() + 5 * 60 * 1_000).toISOString(), now),
    ).not.toThrow();
  });

  it("rejects a timestamp more than five minutes in the future", () => {
    expectInvalid(
      () => assertSnapshotFresh(new Date(now.getTime() + 5 * 60 * 1_000 + 1).toISOString(), now),
      "generatedAt",
    );
  });
});

function snapshotBytes(snapshot: CatalogueSnapshot): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`);
}

function snapshotWithDatasets(datasets: CatalogueSnapshot["datasets"]): CatalogueSnapshot {
  return parseCatalogueSnapshot(
    snapshotBytes({ ...validSnapshot, count: datasets.length, datasets }),
  );
}
