import { describe, expect, it } from "vitest";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { formatPublisherError } from "../src/publish-entry.js";

describe("catalogue publisher diagnostics", () => {
  it("emits structured OpsiError details without serializing nested causes", () => {
    const error = new OpsiError({
      code: "CATALOGUE_COUNT_REDUCTION",
      message: "Catalogue count reduction exceeds the safety threshold.",
      exitCode: EXIT_CODES.PROVIDER_FAILURE,
      suggestion: "Retry with the manual override after validating the source catalogue.",
      context: { previousCount: 100, currentCount: 42 },
      cause: new Error("secret upstream response body"),
    });

    const output = formatPublisherError(error);

    expect(JSON.parse(output) as unknown).toEqual({
      code: "CATALOGUE_COUNT_REDUCTION",
      message: "Catalogue count reduction exceeds the safety threshold.",
      exitCode: EXIT_CODES.PROVIDER_FAILURE,
      suggestion: "Retry with the manual override after validating the source catalogue.",
      context: { previousCount: 100, currentCount: 42 },
    });
    expect(output).not.toContain("secret upstream response body");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("keeps unexpected failures human-readable", () => {
    expect(formatPublisherError(new Error("unexpected failure"))).toBe("unexpected failure\n");
    expect(formatPublisherError(undefined)).toBe("Catalogue publication failed.\n");
  });
});
