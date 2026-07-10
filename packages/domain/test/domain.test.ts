import { describe, expect, it } from "vitest";
import * as domain from "../src/index.js";
import {
  EXIT_CODES,
  OpsiError,
  datasetId,
  datasetReference,
  localFileReference,
  parseCanonicalReference,
  providerId,
  resourceId,
  resourceReference,
} from "../src/index.js";

describe("branded identifiers", () => {
  it.each([
    ["provider", providerId],
    ["dataset", datasetId],
    ["resource", resourceId],
  ])("rejects an empty or whitespace-only %s ID", (_label, constructor) => {
    expect(() => constructor("   ")).toThrowError(
      expect.objectContaining({ code: "INVALID_ID", exitCode: 2 }),
    );
  });

  it("rejects provider IDs containing the canonical separator", () => {
    expect(() => providerId("op:si")).toThrowError(
      expect.objectContaining({ code: "INVALID_ID", exitCode: 2 }),
    );
  });
});

describe("canonical references", () => {
  it("keeps provider formatters closed over parser-accepted references", () => {
    expect(providerId("local")).toBe("local");
    expect(() => datasetReference(providerId("local"), datasetId("d"))).toThrowError(
      expect.objectContaining({ code: "INVALID_REFERENCE", exitCode: 2 }),
    );

    const provider = providerId("ckan");
    const dataset = datasetReference(provider, datasetId("dataset-1"));
    const resource = resourceReference(provider, resourceId("resource-1"));

    expect(parseCanonicalReference(dataset)).toEqual({
      providerId: "ckan",
      kind: "dataset",
      id: "dataset-1",
    });
    expect(parseCanonicalReference(resource)).toEqual({
      providerId: "ckan",
      kind: "resource",
      id: "resource-1",
    });
  });

  it("round-trips a provider dataset reference", () => {
    const reference = datasetReference(providerId("opsi"), datasetId("abc"));
    expect(reference).toBe("opsi:dataset:abc");
    expect(parseCanonicalReference(reference)).toEqual({
      providerId: "opsi",
      kind: "dataset",
      id: "abc",
    });
  });

  it("round-trips a provider resource reference", () => {
    const reference = resourceReference(providerId("opsi"), resourceId("resource-1"));
    expect(reference).toBe("opsi:resource:resource-1");
    expect(parseCanonicalReference(reference)).toEqual({
      providerId: "opsi",
      kind: "resource",
      id: "resource-1",
    });
  });

  it("round-trips a local file reference", () => {
    const reference = localFileReference("/tmp/data.csv");
    expect(reference).toBe("local:file:/tmp/data.csv");
    expect(parseCanonicalReference(reference)).toEqual({
      providerId: "local",
      kind: "file",
      id: "/tmp/data.csv",
    });
  });

  it.each(["", "opsi:dataset:", "opsi:unknown:abc", "local:dataset:abc"])(
    "rejects malformed canonical reference %j",
    (reference) => {
      expect(() => parseCanonicalReference(reference)).toThrowError(
        expect.objectContaining({ code: "INVALID_REFERENCE", exitCode: 2 }),
      );
    },
  );
});

it("exposes every stable process exit category including success", () => {
  expect(EXIT_CODES).toEqual({
    SUCCESS: 0,
    INTERNAL: 1,
    INVALID_INPUT: 2,
    NOT_FOUND: 3,
    PROVIDER_FAILURE: 4,
    UNSUPPORTED: 5,
    INTEGRITY_FAILURE: 6,
    QUERY_FAILURE: 7,
    PARTIAL_SUCCESS: 8,
  });
});

it("exposes the stable provenance schema version", () => {
  expect(domain).toHaveProperty("PROVENANCE_SCHEMA_VERSION", "1");
});

it("serializes a stable typed error without its cause", () => {
  const error = new OpsiError({
    code: "RESOURCE_NOT_FOUND",
    message: "Resource missing",
    exitCode: 3,
    cause: new Error("internal"),
  });
  expect(error.toJSON()).toEqual({
    code: "RESOURCE_NOT_FOUND",
    message: "Resource missing",
    exitCode: 3,
  });
});
