import { once } from "node:events";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Downloader,
  SafeDispatcherFactory,
  assertPublicAddressSet,
  safeFilename,
} from "@opsi/storage";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);
describe("network policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("rejects special address %s", (address) => {
    expect(() =>
      assertPublicAddressSet([{ address, family: address.includes(":") ? 6 : 4 }]),
    ).toThrow();
  });
  it("fails closed on mixed DNS and passes the validated address to socket lookup", async () => {
    expect(() =>
      assertPublicAddressSet([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).toThrow();
    const factory = new SafeDispatcherFactory({
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const lookup = factory.lookupFor(new URL("https://example.com"));
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) =>
      lookup("example.com", {}, (error, address, family) =>
        error ? reject(error) : resolve({ address: address as string, family: family as number }),
      ),
    );
    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });
});

describe("Downloader", () => {
  it("bounds chunked responses and removes partial files", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200);
      response.write("12345");
      response.end("67890");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("listen failed");
    const directory = await mkdtemp(join(tmpdir(), "opsi-download-"));
    roots.push(directory);
    const destination = join(directory, "file.txt");
    await expect(
      new Downloader().download({
        url: `http://127.0.0.1:${address.port}/x`,
        destination,
        allowInsecureHttp: true,
        allowPrivateNetwork: true,
        limits: { maxBytes: 5, timeoutMs: 1_000 },
      }),
    ).rejects.toMatchObject({ code: "DOWNLOAD_TOO_LARGE" });
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(directory)).toEqual([]);
    server.close();
    await once(server, "close");
  });

  it("follows relative redirects manually and hashes durable bytes", async () => {
    const server = createServer((request, response) =>
      request.url === "/start"
        ? (response.writeHead(302, { location: "/final" }), response.end())
        : (response.writeHead(200, { "content-type": "text/plain" }), response.end("hello")),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("listen failed");
    const directory = await mkdtemp(join(tmpdir(), "opsi-download-"));
    roots.push(directory);
    const result = await new Downloader().download({
      url: `http://127.0.0.1:${address.port}/start`,
      destination: join(directory, "file.txt"),
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      limits: { maxBytes: 100, timeoutMs: 1_000 },
    });
    expect(result).toMatchObject({
      bytes: 5,
      redirectChain: [expect.stringContaining("/start"), expect.stringContaining("/final")],
    });
    expect(await readFile(result.path, "utf8")).toBe("hello");
    server.close();
    await once(server, "close");
  });

  it.each(["../secret", "..\\secret", "CON", "nul.txt", "hello:ads", "trail. ", "\u0000bad"])(
    "sanitizes remote filename %j",
    (name) => {
      const safe = safeFilename(name, "download");
      expect(safe).not.toMatch(/[\\/:]|\p{Cc}/u);
      expect(safe).not.toMatch(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu);
      expect(safe).not.toBe(".");
      expect(safe).not.toBe("..");
    },
  );
});
