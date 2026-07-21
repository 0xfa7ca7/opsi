import { describe, expect, it } from "vitest";
import { validateDatasetMetadata, validateResourceMetadata } from "../src/metadata-validation.js";
import { DataService } from "../src/data.js";
import type { KlopsiClient } from "../src/client.js";
import { resolve } from "node:path";
import { datasetId, providerId, resourceId, type Dataset, type Resource } from "@klopsi/domain";

const provider = providerId("fixture");

describe("metadata validation", () => {
  it("reports missing dataset metadata without mutating preserved raw metadata", () => {
    const raw = { id: "dataset-1", unknown: { preserved: true } };
    const dataset: Dataset = {
      id: datasetId("dataset-1"),
      providerId: provider,
      title: "",
      resources: [],
      providerMetadata: { raw },
    };
    const before = structuredClone(raw);

    const result = validateDatasetMetadata(dataset);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MISSING_TITLE",
        "MISSING_DESCRIPTION",
        "MISSING_LICENSE",
        "MISSING_ORGANIZATION",
        "MISSING_MODIFICATION_TIMESTAMP",
      ]),
    );
    expect(raw).toEqual(before);
  });

  it("reports invalid resource URLs and inconsistent declared/detected formats", () => {
    const resource: Resource = {
      id: resourceId("resource-1"),
      datasetId: datasetId("dataset-1"),
      providerId: provider,
      title: "Rows",
      url: "javascript:alert(1)",
      format: "CSV",
      providerMetadata: { raw: { untouched: true } },
    };

    const result = validateResourceMetadata(resource, { detectedFormat: "parquet" });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_RESOURCE_URL", severity: "error" }),
        expect.objectContaining({ code: "DECLARED_FORMAT_MISMATCH", severity: "warning" }),
      ]),
    );
  });

  it("performs no hidden async or network work", () => {
    const resource: Resource = {
      id: resourceId("resource-1"),
      datasetId: datasetId("dataset-1"),
      providerId: provider,
      title: "Rows",
      url: "https://example.invalid/data.csv",
    };

    expect(validateResourceMetadata(resource)).not.toBeInstanceOf(Promise);
  });

  it("parses canonical resource references before applying local path heuristics", async () => {
    const calls: string[] = [];
    const downloadProviders: Array<string | undefined> = [];
    const fixture = resolve("packages/testing/fixtures/data/valid.csv");
    const client = {
      resources: {
        get: async (id: string, selectedProvider?: string) => {
          calls.push(`${selectedProvider}:${id}`);
          return {
            id: resourceId(id),
            datasetId: datasetId("dataset-1"),
            providerId: providerId("opsi"),
            title: "Rows",
            url: "https://example.invalid/data.csv",
            format: "CSV",
          };
        },
      },
      downloads: {
        resource: async (_id: string, options?: { readonly providerId?: string }) => {
          downloadProviders.push(options?.providerId);
          return {
            path: fixture,
            sha256: "0".repeat(64),
            bytes: 1,
            finalUrl: "https://example.invalid/data.csv",
            redirectChain: [],
            mediaType: "text/csv",
            provenancePath: `${fixture}.provenance.json`,
          };
        },
      },
    } as unknown as KlopsiClient;

    const preview = await new DataService(client).preview("opsi:resource:folder/data.csv");

    expect(calls).toEqual(["opsi:folder/data.csv"]);
    expect(downloadProviders).toEqual(["opsi"]);
    expect(preview.rows).toHaveLength(3);
  });

  it("preserves canonical provider identity and rejects unregistered providers", async () => {
    const calls: string[] = [];
    const client = {
      resources: {
        get: async (id: string, selectedProvider?: string) => {
          calls.push(`${selectedProvider}:${id}`);
          throw Object.assign(new Error("missing"), {
            code: "PROVIDER_NOT_FOUND",
            exitCode: 2,
          });
        },
      },
    } as unknown as KlopsiClient;

    await expect(
      new DataService(client).preview("other:resource:resource.csv"),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_FOUND" });
    expect(calls).toEqual(["other:resource.csv"]);
  });
});
