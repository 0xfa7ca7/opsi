import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let home: string;
let baseUrl: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "opsi-service-e2e-"));
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/resource_show") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          result: {
            id: "wfs",
            package_id: "dataset",
            name: "WFS",
            url: `${baseUrl}/wfs`,
            format: "WFS",
          },
        }),
      );
      return;
    }
    if (url.pathname === "/package_show") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          result: { id: "dataset", name: "dataset", title: "Dataset", notes: "", resources: [] },
        }),
      );
      return;
    }
    if (url.pathname === "/wfs") {
      const operation = url.searchParams.get("request");
      response.writeHead(200, {
        "content-type":
          operation === "GetFeature" && url.searchParams.get("resultType") !== "hits"
            ? "text/csv"
            : "application/xml",
      });
      if (operation === "GetCapabilities")
        response.end(
          `<wfs:WFS_Capabilities xmlns:wfs="x" version="2.0.0"><wfs:FeatureTypeList><wfs:FeatureType><wfs:Name>si:roads</wfs:Name><wfs:Title>Roads</wfs:Title><wfs:DefaultCRS>EPSG:3794</wfs:DefaultCRS></wfs:FeatureType></wfs:FeatureTypeList></wfs:WFS_Capabilities>`,
        );
      else if (operation === "DescribeFeatureType")
        response.end(
          `<xsd:schema xmlns:xsd="x"><xsd:complexType><xsd:sequence><xsd:element name="id" type="xsd:long"/><xsd:element name="name" type="xsd:string"/></xsd:sequence></xsd:complexType></xsd:schema>`,
        );
      else if (url.searchParams.get("resultType") === "hits")
        response.end(`<wfs:FeatureCollection xmlns:wfs="x" numberMatched="2"/>`);
      else response.end("id,name\n1,Ljubljana\n2,Maribor\n");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server failed");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
  await rm(home, { recursive: true, force: true });
});

async function cli(args: readonly string[]) {
  const child = spawn(process.execPath, [resolve("apps/cli/dist/main.js"), ...args], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      OPSI_BASE_URL: baseUrl,
      OPSI_CACHE_DIR: join(home, "cache"),
      OPSI_OFFLINE: "0",
      OPSI_REQUEST_INTERVAL_MS: "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value: string) => (stdout += value));
  child.stderr.on("data", (value: string) => (stderr += value));
  const [exitCode] = (await once(child, "exit")) as [number];
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  return { exitCode, stdout, stderr, json };
}

const network = ["--allow-insecure-http", "--allow-private-network", "--json"] as const;

describe("service CLI", () => {
  it("lists layers, validates schema, previews, and counts through OPSI", async () => {
    await expect(
      cli(["service", "layers", "opsi:resource:wfs", ...network]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: [{ name: "si:roads" }] } });
    await expect(
      cli(["service", "schema", "opsi:resource:wfs", "--layer", "si:roads", ...network]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: [{ name: "id" }, { name: "name" }] } });
    await expect(
      cli([
        "service",
        "preview",
        "opsi:resource:wfs",
        "--layer",
        "si:roads",
        "--property",
        "name",
        "--limit",
        "1",
        ...network,
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: { data: [{ id: "1", name: "Ljubljana" }], meta: { truncated: true } },
    });
    await expect(
      cli(["service", "count", "opsi:resource:wfs", "--layer", "si:roads", ...network]),
    ).resolves.toMatchObject({ exitCode: 0, json: { data: { count: 2 } } });
    const output = join(home, "roads.csv");
    await expect(
      cli([
        "service",
        "export",
        "opsi:resource:wfs",
        "--layer",
        "si:roads",
        "--output",
        output,
        "--limit",
        "2",
        ...network,
      ]),
    ).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { output, provenancePath: `${output}.provenance.json`, rows: 2 } },
    });
    await expect(cli(["provenance", "verify", output, "--json"])).resolves.toMatchObject({
      exitCode: 0,
      json: { data: { valid: true } },
    });
  });
});
