import { readFile } from "node:fs/promises";
import { datasetId, resourceId } from "@opsi/domain";
import { describe, expect, it, vi } from "vitest";
import { OpsiProvider, OpsiTransport, RequestScheduler } from "../src/index.js";

type FixtureName =
  | "package-search"
  | "package-show"
  | "resource-show"
  | "organization-list"
  | "tag-list"
  | "license-list"
  | "error";

interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

async function fixture(name: FixtureName): Promise<unknown> {
  const url = new URL(`../../../testing/fixtures/opsi/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

function fixtureTransport(responses: Readonly<Record<string, unknown>>): {
  readonly transport: OpsiTransport;
  readonly requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const request: CapturedRequest = {
      method: init?.method ?? "GET",
      path: url.pathname.replace("/fixture", ""),
      ...(url.searchParams.size === 0
        ? {}
        : { query: Object.fromEntries(url.searchParams.entries()) }),
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) as unknown }),
    };
    requests.push(request);
    const response = responses[request.path];
    if (response === undefined) throw new Error(`Missing fixture for ${request.path}`);
    const status =
      typeof response === "object" &&
      response !== null &&
      "success" in response &&
      response.success === false
        ? 404
        : 200;
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return {
    requests,
    transport: new OpsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    }),
  };
}

describe("OPSI provider contract", () => {
  it("sends package_search as the required JSON POST", async () => {
    const { transport, requests } = fixtureTransport({
      "/package_search": await fixture("package-search"),
    });
    const provider = new OpsiProvider(transport);

    await provider.search({ text: "promet", limit: 2, offset: 0, filters: { formats: [] } });

    expect(requests).toEqual([
      {
        method: "POST",
        path: "/package_search",
        body: {
          q: "promet",
          fq: "",
          rows: 2,
          start: 0,
          facet: "true",
          "facet.field": [],
          "facet.mincount": 0,
          "facet.limit": 50,
          sort: "relevance asc, metadata_modified desc",
        },
      },
    ]);
  });

  it("sends package_show as GET with the legacy required flag", async () => {
    const { transport, requests } = fixtureTransport({
      "/package_show": await fixture("package-show"),
    });
    const provider = new OpsiProvider(transport);

    await provider.getDataset(datasetId("dataset-abc"));

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/package_show",
        query: { id: "dataset-abc", use_default_schema: "false" },
      },
    ]);
  });

  it("routes list and search operations with their published parameter locations", async () => {
    const { transport, requests } = fixtureTransport({
      "/organization_list": await fixture("organization-list"),
      "/tag_search": {
        help: "sanitized",
        success: true,
        result: [{ id: "tag-1", name: "promet", display_name: "Promet" }],
      },
      "/tag_autocomplete": { help: "sanitized", success: true, result: ["promet"] },
      "/tag_list": await fixture("tag-list"),
      "/license_list": await fixture("license-list"),
      "/resource_search": { help: "sanitized", success: true, result: { count: 0, results: [] } },
      "/status_show": { help: "sanitized", success: true, result: { ckan_version: "2.2b" } },
    });

    await transport.call("organization_list", { all_fields: true });
    await transport.call("tag_search", { query: "promet", limit: 5 });
    await transport.call("tag_autocomplete", { query: "prom" });
    await transport.call("tag_list", { all_fields: false });
    await transport.call("license_list", {});
    await transport.call("resource_search", {
      query: "name:promet",
      order_by: "name",
      limit: 5,
    });
    await transport.call("status_show", {});

    expect(requests).toEqual([
      { method: "POST", path: "/organization_list", body: { all_fields: true } },
      { method: "POST", path: "/tag_search", body: { query: "promet", limit: 5 } },
      { method: "POST", path: "/tag_autocomplete", body: { query: "prom" } },
      { method: "GET", path: "/tag_list", query: { all_fields: "false" } },
      { method: "GET", path: "/license_list" },
      {
        method: "GET",
        path: "/resource_search",
        query: { query: "name:promet", order_by: "name", limit: "5" },
      },
      { method: "GET", path: "/status_show" },
    ]);
  });

  it("escapes Solr filter values and maps supported filters to legacy fields", async () => {
    const { transport, requests } = fixtureTransport({
      "/package_search": await fixture("package-search"),
    });
    const provider = new OpsiProvider(transport);

    await provider.search({
      filters: {
        organization: "org + one",
        tags: ['tag"one'],
        formats: ["CSV"],
        license: "cc-by",
        modifiedAfter: "2026-01-01",
        modifiedBefore: "2026-12-31",
      },
    });

    expect(requests[0]?.body).toMatchObject({
      fq: 'organization:"org \\+ one" AND tags:"tag\\"one" AND res_format:"CSV" AND license_id:"cc-by" AND metadata_modified:["2026-01-01" TO "2026-12-31"]',
    });
  });

  it("rejects unsupported search sort fields with a capability error", async () => {
    const { transport } = fixtureTransport({
      "/package_search": await fixture("package-search"),
    });
    const provider = new OpsiProvider(transport);

    await expect(
      provider.search({ sort: [{ field: "download_count", direction: "desc" }] }),
    ).rejects.toMatchObject({ code: "PROVIDER_CAPABILITY_UNSUPPORTED", exitCode: 5 });
  });

  it("maps stable fields while retaining the complete raw dataset and resource", async () => {
    const { transport } = fixtureTransport({
      "/package_show": await fixture("package-show"),
      "/resource_show": await fixture("resource-show"),
    });
    const provider = new OpsiProvider(transport);

    const dataset = await provider.getDataset(datasetId("dataset-abc"));
    const resource = await provider.getResource(resourceId("resource-1"));

    expect(dataset).toMatchObject({
      id: "dataset-abc",
      providerId: "opsi",
      title: "Prometni podatki",
      reference: "opsi:dataset:dataset-abc",
      resourceCount: 1,
      providerMetadata: {
        raw: { bulk_download: "true", unknown_dataset_field: { nested: true } },
      },
    });
    expect(dataset.resources[0]).not.toHaveProperty("sizeBytes");
    expect(dataset.resources[0]?.providerMetadata?.raw).toMatchObject({
      size: "not-a-number",
      unknown_resource_field: ["preserved"],
    });
    expect(resource).toMatchObject({
      id: "resource-1",
      datasetId: "dataset-abc",
      providerId: "opsi",
      reference: "opsi:resource:resource-1",
      providerMetadata: { raw: { unknown_resource_field: { keep: true } } },
    });
  });

  it("returns package_show resources without issuing a second request", async () => {
    const { transport, requests } = fixtureTransport({
      "/package_show": await fixture("package-show"),
    });
    const provider = new OpsiProvider(transport);

    const resources = await provider.listDatasetResources(datasetId("dataset-abc"));

    expect(resources).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/package_show");
  });

  it("maps a failed CKAN envelope to a stable provider error", async () => {
    const { transport } = fixtureTransport({ "/resource_show": await fixture("error") });
    const provider = new OpsiProvider(transport);

    await expect(provider.getResource(resourceId("missing"))).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      exitCode: 3,
    });
  });

  it("maps exhausted retryable HTTP failures to a stable provider failure", async () => {
    const transport = new OpsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch: vi.fn(async () => new Response("temporarily unavailable", { status: 503 })),
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    });

    await expect(transport.call("status_show", {})).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_FAILED",
      exitCode: 4,
    });
  });

  it("does not mislabel an invalid resource envelope as not found", async () => {
    const transport = new OpsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true, result: { id: "broken" } }), {
            status: 200,
          }),
      ),
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    });

    await expect(transport.call("resource_show", { id: "broken" })).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      exitCode: 4,
    });
  });

  it("coalesces the same canonical operation and input while it is in flight", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await blocked;
      return new Response(JSON.stringify(await fixture("package-show")), { status: 200 });
    });
    const transport = new OpsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    });

    const first = transport.call("package_show", { id: "dataset-abc", use_default_schema: false });
    const second = transport.call("package_show", {
      use_default_schema: false,
      id: "dataset-abc",
    });
    release?.();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
