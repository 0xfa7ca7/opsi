import { once } from "node:events";
import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOGUE_BASE_URL,
  StrictHttpsReader,
  parseCatalogueSnapshot,
} from "@opsi/catalogue-snapshot";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeAllConnections();
        }),
    ),
  );
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("listen failed");
  return `http://127.0.0.1:${address.port}`;
}

function localReader(baseUrl: string, timeoutMs = 1_000): StrictHttpsReader {
  return new StrictHttpsReader({
    baseUrl,
    timeoutMs,
    testOnlyDownloaderOptions: {
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
    },
  });
}

describe("StrictHttpsReader", () => {
  it("uses the fixed production catalogue origin by default", () => {
    expect(DEFAULT_CATALOGUE_BASE_URL).toBe("https://0xfa7ca7.github.io/opsi/");
    expect(() => new StrictHttpsReader()).not.toThrow();
  });

  it("returns exact bytes from a safe path beneath the configured base pathname", async () => {
    const expected = Uint8Array.from([0, 1, 2, 127, 128, 255]);
    let requestedPath: string | undefined;
    const origin = await listen((request, response) => {
      requestedPath = request.url;
      response.end(expected);
    });

    const bytes = await localReader(`${origin}/catalogue/`).read(
      "v1/snapshots/example.json",
      expected.byteLength,
    );

    expect(bytes).toEqual(expected);
    expect(requestedPath).toBe("/catalogue/v1/snapshots/example.json");
  });

  it.each([
    ["manifest", "v1/latest.json"],
    ["snapshot", "v1/snapshots/example.json"],
  ])("maps %s byte-cap overflow to unavailable", async (_kind, relativePath) => {
    const origin = await listen((_request, response) => response.end("123456"));

    await expect(localReader(`${origin}/catalogue/`).read(relativePath, 5)).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_UNAVAILABLE",
      exitCode: 4,
    });
  });

  it("maps non-2xx responses to unavailable without retaining the response body", async () => {
    const secretBody = "body-must-not-escape";
    const origin = await listen((_request, response) => {
      response.writeHead(503).end(secretBody);
    });

    const error = await localReader(`${origin}/catalogue/`)
      .read("v1/latest.json", 100)
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: "CATALOGUE_SNAPSHOT_UNAVAILABLE", exitCode: 4 });
    expect(String(error)).not.toContain(secretBody);
    expect(JSON.stringify(error)).not.toContain(secretBody);
  });

  it("maps timeouts to unavailable", async () => {
    const origin = await listen(() => undefined);

    await expect(
      localReader(`${origin}/catalogue/`, 25).read("v1/latest.json", 100),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_UNAVAILABLE", exitCode: 4 });
  });

  it("rejects a cross-origin redirect before requesting the target", async () => {
    let targetRequests = 0;
    const target = await listen((_request, response) => {
      targetRequests += 1;
      response.end("forbidden");
    });
    const source = await listen((_request, response) => {
      response.writeHead(302, { location: `${target}/snapshot.json` }).end();
    });

    await expect(
      localReader(`${source}/catalogue/`).read("v1/latest.json", 100),
    ).rejects.toMatchObject({ code: "CATALOGUE_SNAPSHOT_UNAVAILABLE", exitCode: 4 });
    expect(targetRequests).toBe(0);
  });

  it("disallows redirects only for optional reads and preserves normal same-origin redirects", async () => {
    let targetRequests = 0;
    const origin = await listen((request, response) => {
      if (request.url === "/catalogue/v1/index.json") {
        response.writeHead(302, { location: "/catalogue/index-target.json" }).end();
      } else {
        targetRequests += 1;
        response.end("retained-reader-behavior");
      }
    });
    const reader = localReader(`${origin}/catalogue/`);

    await expect(reader.readOptional("v1/index.json", 100)).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_UNAVAILABLE",
    });
    expect(targetRequests).toBe(0);

    await expect(reader.read("v1/index.json", 100)).resolves.toEqual(
      new TextEncoder().encode("retained-reader-behavior"),
    );
    expect(targetRequests).toBe(1);
  });

  it("leaves malformed JSON for the existing caller-facing parser", async () => {
    const origin = await listen((_request, response) => response.end('{"schemaVersion":'));
    const bytes = await localReader(`${origin}/catalogue/`).read("v1/latest.json", 100);

    expect(() => parseCatalogueSnapshot(bytes)).toThrowError(
      expect.objectContaining({ code: "CATALOGUE_SNAPSHOT_INVALID", exitCode: 4 }),
    );
  });

  it("rejects a same-origin absolute URL before a request", async () => {
    let requests = 0;
    const origin = await listen((_request, response) => {
      requests += 1;
      response.end("unexpected");
    });

    await expect(
      localReader(`${origin}/catalogue/`).read(`${origin}/catalogue/v1/latest.json`, 100),
    ).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_INVALID",
      context: { field: "relativePath" },
    });
    expect(requests).toBe(0);
  });

  it.each([
    ["space-prefixed absolute URL", (origin: string) => ` ${origin}/catalogue/v1/latest.json`],
    [
      "space-prefixed network path",
      (origin: string) => ` //${new URL(origin).host}/catalogue/v1/latest.json`,
    ],
    ["space-prefixed root path", () => " /catalogue/v1/latest.json"],
    ["control-prefixed absolute URL", (origin: string) => `\t${origin}/catalogue/v1/latest.json`],
    ["space-suffixed relative path", () => "v1/latest.json "],
    ["control-suffixed relative path", () => "v1/latest.json\u001f"],
  ])("rejects a %s before URL parser trimming", async (_kind, candidate) => {
    let requests = 0;
    const origin = await listen((_request, response) => {
      requests += 1;
      response.end("unexpected");
    });

    await expect(
      localReader(`${origin}/catalogue/`).read(candidate(origin), 100),
    ).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_INVALID",
      context: { field: "relativePath" },
    });
    expect(requests).toBe(0);
  });

  it.each([
    [
      "tab-disguised scheme",
      (origin: string) => `${origin.replace("http://", "ht\ttp://")}/catalogue/v1/latest.json`,
    ],
    ["LF-disguised traversal segment", () => "v1/snapshots/\n../latest.json"],
    ["CR-disguised traversal separator", () => "v1/snapshots/..\r/latest.json"],
  ])("rejects a %s before URL parser control removal", async (_kind, candidate) => {
    let requests = 0;
    const origin = await listen((_request, response) => {
      requests += 1;
      response.end("unexpected");
    });

    await expect(
      localReader(`${origin}/catalogue/`).read(candidate(origin), 100),
    ).rejects.toMatchObject({
      code: "CATALOGUE_SNAPSHOT_INVALID",
      context: { field: "relativePath" },
    });
    expect(requests).toBe(0);
  });

  it.each([
    "https://example.com/snapshot.json",
    "https://user:secret@example.com/snapshot.json",
    "//example.com/snapshot.json",
    "/snapshot.json",
    "../snapshot.json",
    "v1/../snapshot.json",
    "v1/%2e%2e/snapshot.json",
    "v1/snapshot.json?cache=false",
    "v1/snapshot.json#fragment",
    "v1\\..\\snapshot.json",
  ])("rejects unsafe relative path %j before a request", async (relativePath) => {
    let requests = 0;
    const origin = await listen((_request, response) => {
      requests += 1;
      response.end("unexpected");
    });

    await expect(localReader(`${origin}/catalogue/`).read(relativePath, 100)).rejects.toThrow();
    expect(requests).toBe(0);
  });
});
