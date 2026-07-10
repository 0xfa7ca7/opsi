import { describe, expect, it } from "vitest";
import {
  OpsiError,
  datasetId,
  datasetReference,
  parseCanonicalReference,
  providerId,
} from "../src/index.js";

describe("canonical references", () => {
  it("round-trips a provider dataset reference", () => {
    const reference = datasetReference(providerId("opsi"), datasetId("abc"));
    expect(reference).toBe("opsi:dataset:abc");
    expect(parseCanonicalReference(reference)).toEqual({
      providerId: "opsi",
      kind: "dataset",
      id: "abc",
    });
  });

  it("rejects a malformed canonical reference", () => {
    expect(() => parseCanonicalReference("opsi:dataset:")).toThrowError(
      expect.objectContaining({ code: "INVALID_REFERENCE", exitCode: 2 }),
    );
  });
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
