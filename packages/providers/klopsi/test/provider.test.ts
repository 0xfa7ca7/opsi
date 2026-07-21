import { readFile } from "node:fs/promises";
import { datasetId, KlopsiError, providerId, resourceId } from "@klopsi/domain";
import { describe, expect, it, vi } from "vitest";
import {
  KlopsiProvider,
  KlopsiTransport,
  RequestScheduler,
  type KlopsiOperationInputs,
} from "../src/index.js";

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
  readonly headers?: Readonly<Record<string, string>>;
  readonly redirect?: RequestRedirect;
}

it("preserves the API key on a same-origin HTTPS redirect and cancels the redirect body", async () => {
  const calls: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
  let cancelled = false;
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    calls.push({
      url,
      headers: new Headers(init?.headers),
      ...(init?.redirect === undefined ? {} : { redirect: init.redirect }),
    });
    if (calls.length === 1)
      return new Response(new ReadableStream({ cancel: () => void (cancelled = true) }), {
        status: 302,
        headers: { location: "/redirected" },
      });
    return new Response(JSON.stringify(await fixture("package-search")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const transport = new KlopsiTransport({
    baseUrl: "https://example.invalid/fixture",
    apiKey: "environment-secret",
    fetch,
    scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
  });

  await transport.call("package_search", {
    q: "*:*",
    fq: "",
    rows: 1,
    start: 0,
    facet: "true",
    "facet.field": [],
    "facet.mincount": 0,
    "facet.limit": 50,
    sort: "relevance asc",
  });

  expect(calls).toHaveLength(2);
  expect(calls[0]?.headers.get("x-ckan-api-key")).toBe("environment-secret");
  expect(calls[0]?.redirect).toBe("manual");
  expect(calls[1]?.headers.get("x-ckan-api-key")).toBe("environment-secret");
  expect(cancelled).toBe(true);
});

it.each([
  ["cross-origin", "https://other.invalid/package_search"],
  ["loopback", "http://127.0.0.1/package_search"],
  ["link-local", "http://169.254.169.254/package_search"],
  ["downgrade", "http://example.invalid/package_search"],
])("rejects %s catalogue redirects and cancels their bodies", async (_name, location) => {
  let cancelled = false;
  const fetch = vi.fn(
    async () =>
      new Response(new ReadableStream({ cancel: () => void (cancelled = true) }), {
        status: 302,
        headers: { location },
      }),
  );
  const transport = new KlopsiTransport({
    baseUrl: "https://example.invalid/fixture",
    apiKey: "environment-secret",
    fetch,
    scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
  });
  await expect(
    transport.call("package_show", { id: "dataset", use_default_schema: false }),
  ).rejects.toMatchObject({ code: "UNSAFE_PROVIDER_REDIRECT", exitCode: 4 });
  expect(cancelled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  [{ format: "HTML", mediaType: "text/html" }, "page"],
  [{ format: "JSON", mediaType: "application/json", url: "https://example.test/api" }, "api"],
  [{ format: "ZIP", mediaType: "application/zip" }, "archive"],
  [{ format: "WMS", mediaType: "application/xml" }, "service"],
])("classifies resolved resource evidence %j as %s", async (overrides, kind) => {
  const { transport } = fixtureTransport({});
  const provider = new KlopsiProvider(transport);
  const resource = {
    id: resourceId("r"),
    datasetId: datasetId("d"),
    providerId: providerId("klopsi"),
    title: "resource",
    url: "https://example.test/file",
    ...overrides,
  };
  await expect(provider.resolveResource(resource)).resolves.toMatchObject({ kind });
});

async function fixture(name: FixtureName): Promise<unknown> {
  const url = new URL(`../../../testing/fixtures/klopsi/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

function fixtureTransport(responses: Readonly<Record<string, unknown>>): {
  readonly transport: KlopsiTransport;
  readonly requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const responseIndexes = new Map<string, number>();
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
    const configured = responses[request.path];
    if (configured === undefined) throw new Error(`Missing fixture for ${request.path}`);
    const response = Array.isArray(configured)
      ? configured[Math.min(responseIndexes.get(request.path) ?? 0, configured.length - 1)]
      : configured;
    responseIndexes.set(request.path, (responseIndexes.get(request.path) ?? 0) + 1);
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
    transport: new KlopsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    }),
  };
}

describe("KLOPSI provider contract", () => {
  it("rejects an API key with a non-HTTPS base before fetch without exposing the secret", () => {
    const fetch = vi.fn();
    let received: unknown;
    try {
      new KlopsiTransport({
        baseUrl: "http://127.0.0.1/fixture",
        apiKey: "must-never-leak",
        fetch,
      });
    } catch (error) {
      received = error;
    }
    expect(received).toMatchObject({ code: "INSECURE_API_KEY_ORIGIN", exitCode: 2 });
    expect(JSON.stringify(received)).not.toContain("must-never-leak");
    expect(received instanceof Error ? received.message : String(received)).not.toContain(
      "must-never-leak",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends package_search as the required JSON POST", async () => {
    const { transport, requests } = fixtureTransport({
      "/package_search": await fixture("package-search"),
    });
    const provider = new KlopsiProvider(transport);

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
    const provider = new KlopsiProvider(transport);

    await provider.getDataset(datasetId("dataset-abc"));

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/package_show",
        query: { id: "dataset-abc", use_default_schema: "false" },
      },
    ]);
  });

  it.each([
    [
      "missing q",
      {
        fq: "",
        rows: 2,
        start: 0,
        facet: "true",
        "facet.field": [],
        "facet.mincount": 0,
        "facet.limit": 50,
        sort: "relevance asc",
      },
    ],
    [
      "missing sort",
      {
        q: "promet",
        fq: "",
        rows: 2,
        start: 0,
        facet: "true",
        "facet.field": [],
        "facet.mincount": 0,
        "facet.limit": 50,
      },
    ],
  ])("rejects package_search with %s before fetch", async (_case, input) => {
    const { transport, requests } = fixtureTransport({
      "/package_search": await fixture("package-search"),
    });

    await expect(
      Promise.resolve().then(() =>
        transport.call("package_search", input as KlopsiOperationInputs["package_search"]),
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_REQUEST", exitCode: 2 });
    expect(requests).toEqual([]);
  });

  it("rejects package_show use_default_schema=true before fetch", async () => {
    const { transport, requests } = fixtureTransport({
      "/package_show": await fixture("package-show"),
    });

    await expect(
      Promise.resolve().then(() =>
        transport.call("package_show", {
          id: "dataset-abc",
          use_default_schema: true,
        } as unknown as KlopsiOperationInputs["package_show"]),
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_REQUEST", exitCode: 2 });
    expect(requests).toEqual([]);
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
    const provider = new KlopsiProvider(transport);

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
    const provider = new KlopsiProvider(transport);

    await expect(
      provider.search({ sort: [{ field: "download_count", direction: "desc" }] }),
    ).rejects.toMatchObject({ code: "PROVIDER_CAPABILITY_UNSUPPORTED", exitCode: 5 });
  });

  it("maps stable fields while retaining the complete raw dataset and resource", async () => {
    const { transport } = fixtureTransport({
      "/package_show": await fixture("package-show"),
      "/resource_show": await fixture("resource-show"),
    });
    const provider = new KlopsiProvider(transport);

    const dataset = await provider.getDataset(datasetId("dataset-abc"));
    const resource = await provider.getResource(resourceId("resource-1"));

    expect(dataset).toMatchObject({
      id: "dataset-abc",
      providerId: "klopsi",
      title: "Prometni podatki",
      reference: "klopsi:dataset:dataset-abc",
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
      providerId: "klopsi",
      reference: "klopsi:resource:resource-1",
      providerMetadata: { raw: { unknown_resource_field: { keep: true } } },
    });
  });

  it("returns package_show resources without issuing a second request", async () => {
    const { transport, requests } = fixtureTransport({
      "/package_show": await fixture("package-show"),
    });
    const provider = new KlopsiProvider(transport);

    const resources = await provider.listDatasetResources(datasetId("dataset-abc"));

    expect(resources).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/package_show");
  });

  it("resolves the parent dataset when live resource_show omits package_id", async () => {
    const resource = {
      help: "resource_show",
      success: true,
      result: {
        id: "resource-live",
        url: "https://podatki.gov.si/dataset/dataset-live/resource/resource-live/download/data.csv",
        format: "CSV",
      },
    };
    const search = {
      help: "package_search",
      success: true,
      result: {
        count: 1,
        results: [
          {
            id: "dataset-live",
            title: "Live dataset",
            resources: [resource.result],
          },
        ],
      },
    };
    const { transport, requests } = fixtureTransport({
      "/resource_show": resource,
      "/package_search": search,
    });

    await expect(
      new KlopsiProvider(transport).getResource(resourceId("resource-live")),
    ).resolves.toMatchObject({
      id: "resource-live",
      datasetId: "dataset-live",
      format: "CSV",
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).toMatchObject({
      q: "*:*",
      rows: 10,
    });
    expect((requests[1]?.body as { fq: string }).fq).toMatch(
      /^res_url:".*resource-live.*data\.csv"$/u,
    );
  });

  it("advances parent lookup past ten shared-URL decoys", async () => {
    const liveResource = {
      id: "resource-live",
      url: "https://example.invalid/shared.csv",
      format: "CSV",
    };
    const envelope = (start: number, resources: readonly Readonly<Record<string, unknown>>[]) => ({
      help: "package_search",
      success: true,
      result: {
        count: 11,
        results: resources.map((resource, index) => ({
          id: `dataset-${start + index}`,
          title: `Dataset ${start + index}`,
          resources: [resource],
        })),
      },
    });
    const decoys = Array.from({ length: 10 }, (_, index) => ({
      ...liveResource,
      id: `decoy-${index}`,
    }));
    const { transport, requests } = fixtureTransport({
      "/resource_show": { help: "resource_show", success: true, result: liveResource },
      "/package_search": [envelope(0, decoys), envelope(10, [liveResource])],
    });

    await expect(
      new KlopsiProvider(transport).getResource(resourceId("resource-live")),
    ).resolves.toMatchObject({
      datasetId: "dataset-10",
    });
    expect(requests.filter((request) => request.path === "/package_search")).toHaveLength(2);
    expect(requests[2]?.body).toMatchObject({ start: 10, rows: 10 });
  });

  it("maps a failed CKAN envelope to a stable provider error", async () => {
    const { transport } = fixtureTransport({ "/resource_show": await fixture("error") });
    const provider = new KlopsiProvider(transport);

    await expect(provider.getResource(resourceId("missing"))).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      exitCode: 3,
    });
  });

  it("maps exhausted retryable HTTP failures to a stable provider failure", async () => {
    const transport = new KlopsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch: vi.fn(async () => new Response("temporarily unavailable", { status: 503 })),
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    });

    await expect(transport.call("status_show", {})).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_FAILED",
      exitCode: 4,
    });
  });

  it("retries a transient non-JSON response for a retryable operation", async () => {
    const validResponse = await fixture("package-search");
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response("temporary gateway page", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const transport = new KlopsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      scheduler: new RequestScheduler({
        intervalMs: 0,
        maxRetries: 1,
        retryBaseMs: 0,
        jitterRatio: 0,
      }),
    });

    await expect(
      transport.call("package_search", {
        q: "*:*",
        fq: "",
        rows: 1,
        start: 0,
        facet: "true",
        "facet.field": [],
        "facet.mincount": 0,
        "facet.limit": 50,
        sort: "relevance asc",
      }),
    ).resolves.toMatchObject({ count: expect.any(Number) });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports safe final response metadata when non-JSON retries are exhausted", async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      return new Response(
        attempt === 1 ? "first secret upstream response" : "final secret upstream response",
        {
          status: attempt === 1 ? 200 : 501,
          headers: {
            "content-type": attempt === 1 ? "text/html" : "text/plain; charset=utf-8",
          },
        },
      );
    });
    const transport = new KlopsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      scheduler: new RequestScheduler({
        intervalMs: 0,
        maxRetries: 1,
        retryBaseMs: 0,
        jitterRatio: 0,
      }),
    });

    let received: unknown;
    try {
      await transport.call("status_show", {});
    } catch (error) {
      received = error;
    }

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(received).toBeInstanceOf(KlopsiError);
    if (!(received instanceof KlopsiError)) throw new Error("expected KlopsiError");
    expect(received.toJSON()).toEqual({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "KLOPSI returned a non-JSON response.",
      exitCode: 4,
      context: {
        provider: "klopsi",
        operation: "status_show",
        status: 501,
        contentType: "text/plain; charset=utf-8",
      },
    });
    const serialized = JSON.stringify(received);
    expect(serialized).not.toContain("first secret upstream response");
    expect(serialized).not.toContain("final secret upstream response");
    expect(serialized).not.toContain("cause");
  });

  it("reports a response-body timeout separately from malformed JSON", async () => {
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"success":true,"result":'));
            signal?.addEventListener("abort", () => controller.error(signal.reason), {
              once: true,
            });
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json;charset=utf-8" },
        },
      );
    });
    const transport = new KlopsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      timeoutMs: 10,
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    });

    await expect(
      transport.call("package_search", {
        q: "*:*",
        fq: "",
        rows: 1,
        start: 0,
        facet: "true",
        "facet.field": [],
        "facet.mincount": 0,
        "facet.limit": 50,
        sort: "relevance asc",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_FAILED",
      message: "KLOPSI response body timed out.",
      exitCode: 4,
      context: {
        provider: "klopsi",
        operation: "package_search",
        status: 200,
        contentType: "application/json;charset=utf-8",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a terminated response body separately from malformed JSON", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("terminated secret upstream response"));
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json;charset=utf-8" },
          },
        ),
    );
    const transport = new KlopsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      scheduler: new RequestScheduler({ intervalMs: 0, maxRetries: 0 }),
    });

    let received: unknown;
    try {
      await transport.call("package_search", {
        q: "*:*",
        fq: "",
        rows: 1,
        start: 0,
        facet: "true",
        "facet.field": [],
        "facet.mincount": 0,
        "facet.limit": 50,
        sort: "relevance asc",
      });
    } catch (error) {
      received = error;
    }

    expect(received).toBeInstanceOf(KlopsiError);
    if (!(received instanceof KlopsiError)) throw new Error("expected KlopsiError");
    expect(received.toJSON()).toEqual({
      code: "PROVIDER_REQUEST_FAILED",
      message: "KLOPSI response body could not be read.",
      exitCode: 4,
      context: {
        provider: "klopsi",
        operation: "package_search",
        status: 200,
        contentType: "application/json;charset=utf-8",
      },
    });
    expect(JSON.stringify(received)).not.toContain("terminated secret upstream response");
  });

  it("does not mislabel an invalid resource envelope as not found", async () => {
    const transport = new KlopsiTransport({
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
    const transport = new KlopsiTransport({
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
