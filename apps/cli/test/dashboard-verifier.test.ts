import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASHBOARD_VERIFIER_SOURCE } from "../src/agent-skill-resources.js";

const fixtures = resolve(process.cwd(), "apps/cli/test/fixtures/dashboards");
const MAX_HTML_BYTES = 15 * 1024 * 1024;
const MAX_DATA_BYTES = 5 * 1024 * 1024;

interface VerificationResult {
  readonly exitCode: number;
  readonly valid?: boolean;
  readonly mode?: "static" | "interactive";
  readonly findings?: readonly { readonly code: string; readonly message: string }[];
  readonly stderr: string;
}

let temporaryDirectory: string;
let verifierPath: string;
let staticFixture: string;
let interactiveFixture: string;

function runVerifier(arguments_: readonly string[]): Promise<VerificationResult> {
  return new Promise((resolveResult, reject) => {
    execFile(
      process.execPath,
      [verifierPath, ...arguments_],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode =
          error === null ? 0 : typeof error.code === "number" ? error.code : undefined;
        if (exitCode === undefined) {
          reject(error);
          return;
        }
        const parsed = stdout.trim() === "" ? {} : (JSON.parse(stdout) as object);
        resolveResult({ exitCode, ...parsed, stderr });
      },
    );
  });
}

async function verify(path: string, mode: "static" | "interactive"): Promise<VerificationResult> {
  const input = path.startsWith("valid-") ? join(fixtures, path) : path;
  return runVerifier([input, "--mode", mode, "--json"]);
}

async function verifyContent(
  name: string,
  content: string,
  mode: "static" | "interactive",
): Promise<VerificationResult> {
  const path = join(temporaryDirectory, `${name}.html`);
  await writeFile(path, content, "utf8");
  return verify(path, mode);
}

function replaceManifest(
  html: string,
  update: (manifest: Record<string, unknown>) => void,
): string {
  return html.replace(
    /(<script id="klopsi-presentation-manifest" type="application\/json">)([\s\S]*?)(<\/script>)/u,
    (_match, opening: string, body: string, closing: string) => {
      const manifest = JSON.parse(body) as Record<string, unknown>;
      update(manifest);
      return `${opening}${JSON.stringify(manifest)}${closing}`;
    },
  );
}

function replaceInteractiveData(html: string, rows: readonly unknown[]): string {
  const body = JSON.stringify(rows);
  const withData = html.replace(
    /(<script id="klopsi-presentation-data" type="application\/json">)[\s\S]*?(<\/script>)/u,
    `$1${body}$2`,
  );
  return replaceManifest(withData, (manifest) => {
    const data = manifest.data as Record<string, unknown>;
    data.originalRows = rows.length;
    data.presentedRows = rows.length;
    data.embeddedBytes = Buffer.byteLength(body);
  });
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "klopsi-dashboard-verifier-"));
  verifierPath = join(temporaryDirectory, "verify-dashboard.mjs");
  await writeFile(verifierPath, DASHBOARD_VERIFIER_SOURCE, "utf8");
  [staticFixture, interactiveFixture] = await Promise.all([
    readFile(join(fixtures, "valid-static.html"), "utf8"),
    readFile(join(fixtures, "valid-interactive.html"), "utf8"),
  ]);
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("dashboard presentation verifier", () => {
  it("accepts complete static and interactive fixtures", async () => {
    expect(await verify("valid-static.html", "static")).toMatchObject({
      exitCode: 0,
      valid: true,
    });
    expect(await verify("valid-interactive.html", "interactive")).toMatchObject({
      exitCode: 0,
      valid: true,
    });
  });

  it("keeps the static fixture suitable for responsive, print, and non-script review", () => {
    expect(staticFixture).toContain("@media (max-width:");
    expect(staticFixture).toContain("@media print");
    expect(staticFixture).toMatch(/<svg[^>]+role="img"[^>]+aria-labelledby=/u);
    expect(staticFixture).toMatch(/<svg[\s\S]*?<title id=/u);
    expect(staticFixture).toMatch(/<svg[\s\S]*?<desc id=/u);
    expect(staticFixture).toContain("<table");
  });

  it("keeps the interactive fixture suitable for keyboard and state review", () => {
    expect(interactiveFixture).toContain('aria-live="polite"');
    expect(interactiveFixture).toContain("data-filter-field");
    expect(interactiveFixture).toContain("data-sort-field");
    expect(interactiveFixture).toContain("aria-sort");
    expect(interactiveFixture).toContain("renderSortState");
    expect(interactiveFixture).toContain("renderEmptyState");
    expect(interactiveFixture).toContain("form.reset()");
    expect(interactiveFixture).toMatch(/form\.querySelector\([^)]+\)\?\.focus\(\)/u);
  });

  const expectedCodes = [
    "HTML_TOO_LARGE",
    "MANIFEST_MISSING",
    "MANIFEST_INVALID",
    "MODE_MISMATCH",
    "DATA_TOO_LARGE",
    "ROW_LIMIT_EXCEEDED",
    "REDUCTION_UNDISCLOSED",
    "REMOTE_RESOURCE",
    "NETWORK_API",
    "UNSAFE_CODE",
    "CSP_INVALID",
    "JSON_EMBEDDING_UNSAFE",
    "SUMMARY_MISSING",
    "DISCLOSURES_MISSING",
    "LINEAGE_MISSING",
    "VIEW_METADATA_INVALID",
    "STATIC_SCRIPT_FORBIDDEN",
    "FILTER_REGION_MISSING",
    "RECORD_COUNT_MISSING",
    "DETAIL_TABLE_MISSING",
    "RESET_MISSING",
    "EMPTY_STATE_MISSING",
    "NOSCRIPT_MISSING",
    "TEMPLATE_MARKER_UNRESOLVED",
  ] as const;

  it("reports every stable finding code for an isolated invalid variant", async () => {
    const oversizedData = replaceInteractiveData(interactiveFixture, ["x".repeat(MAX_DATA_BYTES)]);
    const tooManyRows = replaceInteractiveData(
      interactiveFixture,
      Array.from({ length: 10_001 }, (_value, index) => index),
    );
    const variants: Record<
      (typeof expectedCodes)[number],
      { readonly html: string; readonly mode: "static" | "interactive" }
    > = {
      HTML_TOO_LARGE: { html: " ".repeat(MAX_HTML_BYTES + 1), mode: "static" },
      MANIFEST_MISSING: {
        html: staticFixture.replace(
          /<script id="klopsi-presentation-manifest"[\s\S]*?<\/script>/u,
          "",
        ),
        mode: "static",
      },
      MANIFEST_INVALID: {
        html: staticFixture.replace(
          /(<script id="klopsi-presentation-manifest" type="application\/json">)[\s\S]*?(<\/script>)/u,
          "$1{invalid json$2",
        ),
        mode: "static",
      },
      MODE_MISMATCH: { html: staticFixture, mode: "interactive" },
      DATA_TOO_LARGE: { html: oversizedData, mode: "interactive" },
      ROW_LIMIT_EXCEEDED: { html: tooManyRows, mode: "interactive" },
      REDUCTION_UNDISCLOSED: {
        html: replaceManifest(staticFixture, (manifest) => {
          const data = manifest.data as Record<string, unknown>;
          data.originalRows = 3;
        }),
        mode: "static",
      },
      REMOTE_RESOURCE: {
        html: staticFixture.replace("</main>", '<img src="https://example.com/chart.png"></main>'),
        mode: "static",
      },
      NETWORK_API: {
        html: interactiveFixture.replace("</body>", "<script>fetch('/data')</script></body>"),
        mode: "interactive",
      },
      UNSAFE_CODE: {
        html: interactiveFixture.replace("</main>", "<iframe></iframe></main>"),
        mode: "interactive",
      },
      CSP_INVALID: {
        html: staticFixture.replace("connect-src 'none'", "connect-src *"),
        mode: "static",
      },
      JSON_EMBEDDING_UNSAFE: {
        html: replaceManifest(staticFixture, (manifest) => {
          manifest.title = "Unsafe < title";
        }),
        mode: "static",
      },
      SUMMARY_MISSING: {
        html: staticFixture.replace(" data-klopsi-summary", ""),
        mode: "static",
      },
      DISCLOSURES_MISSING: {
        html: staticFixture.replace(" data-klopsi-disclosures", ""),
        mode: "static",
      },
      LINEAGE_MISSING: {
        html: staticFixture.replace(" data-klopsi-lineage", ""),
        mode: "static",
      },
      VIEW_METADATA_INVALID: {
        html: replaceManifest(staticFixture, (manifest) => {
          const views = manifest.views as Array<Record<string, unknown>>;
          views[0]!.question = "";
        }),
        mode: "static",
      },
      STATIC_SCRIPT_FORBIDDEN: {
        html: staticFixture.replace(
          "</body>",
          "<script>document.title = 'changed'</script></body>",
        ),
        mode: "static",
      },
      FILTER_REGION_MISSING: {
        html: interactiveFixture.replace(" data-klopsi-filter-region", ""),
        mode: "interactive",
      },
      RECORD_COUNT_MISSING: {
        html: interactiveFixture.replace(" data-klopsi-record-count", ""),
        mode: "interactive",
      },
      DETAIL_TABLE_MISSING: {
        html: interactiveFixture.replace(" data-klopsi-detail-table", ""),
        mode: "interactive",
      },
      RESET_MISSING: {
        html: interactiveFixture.replace(" data-klopsi-reset", ""),
        mode: "interactive",
      },
      EMPTY_STATE_MISSING: {
        html: interactiveFixture.replace(" data-klopsi-empty-state", ""),
        mode: "interactive",
      },
      NOSCRIPT_MISSING: {
        html: interactiveFixture.replace(/<noscript>[\s\S]*?<\/noscript>/u, ""),
        mode: "interactive",
      },
      TEMPLATE_MARKER_UNRESOLVED: {
        html: staticFixture.replace("Verified dashboard fixture</h1>", "{{TITLE}}</h1>"),
        mode: "static",
      },
    };

    expect(Object.keys(variants)).toEqual(expectedCodes);
    for (const code of expectedCodes) {
      const variant = variants[code];
      const result = await verifyContent(code.toLowerCase(), variant.html, variant.mode);
      expect(result.exitCode, code).toBe(1);
      expect(result.valid, code).toBe(false);
      expect(
        result.findings?.map((item) => item.code),
        `${code}: ${JSON.stringify(result.findings)}`,
      ).toContain(code);
      expect(result.findings?.length, code).toBeLessThanOrEqual(100);
    }
  }, 30_000);

  it("accepts visible remote citation anchors", async () => {
    const cited = staticFixture.replace(
      "</main>",
      '<a href="https://example.com/source">Source citation</a></main>',
    );

    expect(await verifyContent("citation", cited, "static")).toMatchObject({
      exitCode: 0,
      valid: true,
    });
  });

  it("returns at most 100 findings when more violations are collected", async () => {
    const cappedVerifier = join(temporaryDirectory, "verify-dashboard-cap.mjs");
    const instrumentedSource = DASHBOARD_VERIFIER_SOURCE.replace(
      "const findings = [];",
      "const findings = Array.from({ length: 101 }, (_value, index) => finding('TEST_' + index, 'Injected contract finding.'));",
    );
    await writeFile(cappedVerifier, instrumentedSource, "utf8");

    const originalVerifier = verifierPath;
    verifierPath = cappedVerifier;
    try {
      const result = await verify("valid-static.html", "static");
      expect(result).toMatchObject({ exitCode: 1, valid: false });
      expect(result.findings).toHaveLength(100);
      expect(result.findings?.[0]?.code).toBe("TEST_0");
      expect(result.findings?.[99]?.code).toBe("TEST_99");
    } finally {
      verifierPath = originalVerifier;
    }
  });

  it("detects prohibited network APIs in event-handler attributes", async () => {
    const withHandler = interactiveFixture.replace(
      "<body>",
      `<body onload="fetch('/dashboard-data')">`,
    );

    const result = await verifyContent("event-handler-network", withHandler, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("NETWORK_API");
  });

  it("detects unsafe code in event-handler attributes", async () => {
    const withHandler = interactiveFixture.replace(
      "</main>",
      `<button type="button" onclick="eval('alert(1)')">Unsafe</button></main>`,
    );

    const result = await verifyContent("event-handler-unsafe", withHandler, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("UNSAFE_CODE");
  });

  it("rejects every inline event-handler attribute in both modes", async () => {
    for (const [mode, fixture] of [
      ["static", staticFixture],
      ["interactive", interactiveFixture],
    ] as const) {
      const withHandler = fixture.replace(
        "</main>",
        `<button type="button" onclick="this.hidden=true">Hide</button></main>`,
      );
      const result = await verifyContent(`ordinary-handler-${mode}`, withHandler, mode);
      expect(
        result.findings?.map((item) => item.code),
        mode,
      ).toContain("UNSAFE_CODE");
    }
  });

  it("rejects an inline event-handler attribute with an empty value", async () => {
    const withHandler = interactiveFixture.replace(
      "</main>",
      `<button type="button" onclick>Empty handler</button></main>`,
    );

    const result = await verifyContent("empty-handler", withHandler, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("UNSAFE_CODE");
  });

  it("rejects meta refresh navigation", async () => {
    const withRefresh = staticFixture.replace(
      "<head>",
      `<head><meta http-equiv="refresh" content="0;url=https://example.com/dashboard">`,
    );

    const result = await verifyContent("meta-refresh", withRefresh, "static");
    expect(result.findings?.map((item) => item.code)).toContain("REMOTE_RESOURCE");
  });

  it("rejects duplicate CSP directives even when the last value is restrictive", async () => {
    const duplicateDirective = staticFixture.replace(
      "connect-src 'none';",
      "connect-src https:; connect-src 'none';",
    );

    const result = await verifyContent("duplicate-csp", duplicateDirective, "static");
    expect(result.findings?.map((item) => item.code)).toContain("CSP_INVALID");
  });

  it("rejects duplicate presentation manifest blocks", async () => {
    const manifest = staticFixture.match(
      /<script id="klopsi-presentation-manifest" type="application\/json">[\s\S]*?<\/script>/u,
    )?.[0];
    expect(manifest).toBeDefined();
    const duplicated = staticFixture.replace("</body>", `${manifest}</body>`);

    const result = await verifyContent("duplicate-manifest", duplicated, "static");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("rejects duplicate interactive presentation-data blocks", async () => {
    const data = interactiveFixture.match(
      /<script id="klopsi-presentation-data" type="application\/json">[\s\S]*?<\/script>/u,
    )?.[0];
    expect(data).toBeDefined();
    const duplicated = interactiveFixture.replace("</body>", `${data}</body>`);

    const result = await verifyContent("duplicate-data", duplicated, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("counts a wrong-type manifest occurrence before the valid manifest", async () => {
    const wrongType = '<script id="klopsi-presentation-manifest" type="text/plain">{}</script>';
    const duplicated = staticFixture.replace(
      /<script id="klopsi-presentation-manifest" type="application\/json">/u,
      `${wrongType}$&`,
    );

    const result = await verifyContent("wrong-type-manifest-first", duplicated, "static");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("counts a wrong-type data occurrence before the valid presentation data", async () => {
    const wrongType = '<script id="klopsi-presentation-data" type="text/plain">[]</script>';
    const duplicated = interactiveFixture.replace(
      /<script id="klopsi-presentation-data" type="application\/json">/u,
      `${wrongType}$&`,
    );

    const result = await verifyContent("wrong-type-data-first", duplicated, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("rejects extra presentation manifest keys", async () => {
    const extraKey = replaceManifest(staticFixture, (manifest) => {
      manifest.extra = true;
    });

    const result = await verifyContent("manifest-extra-key", extraKey, "static");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("requires canonical valid ISO-8601 presentation timestamps", async () => {
    for (const [name, generatedAt] of [
      ["loose", "2026-07-21"],
      ["invalid-date", "2026-02-30T00:00:00.000Z"],
    ] as const) {
      const invalidTimestamp = replaceManifest(staticFixture, (manifest) => {
        manifest.generatedAt = generatedAt;
      });
      const result = await verifyContent(`timestamp-${name}`, invalidTimestamp, "static");
      expect(
        result.findings?.map((item) => item.code),
        generatedAt,
      ).toContain("MANIFEST_INVALID");
    }
  });

  it("requires coordinate geography fields to exist in manifest data fields", async () => {
    const missingCoordinates = replaceManifest(staticFixture, (manifest) => {
      manifest.geography = {
        kind: "coordinates",
        crs: "EPSG:4326",
        latitudeField: "latitude",
        longitudeField: "longitude",
      };
    });

    const result = await verifyContent("missing-coordinate-fields", missingCoordinates, "static");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("requires an embedded geometry field to exist in manifest data fields", async () => {
    const missingGeometry = replaceManifest(staticFixture, (manifest) => {
      manifest.geography = {
        kind: "geometry",
        crs: "EPSG:3794",
        geometryField: "geometry",
      };
    });

    const result = await verifyContent("missing-geometry-field", missingGeometry, "static");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("rejects extraneous keys in every conditional geography form", async () => {
    const variants = [
      {
        name: "none",
        update(manifest: Record<string, unknown>) {
          manifest.geography = { kind: "none", crs: null, geometryField: "geometry" };
        },
      },
      {
        name: "coordinates",
        update(manifest: Record<string, unknown>) {
          const data = manifest.data as { fields: Array<Record<string, unknown>> };
          data.fields.push(
            { name: "latitude", type: "number", unit: "degrees" },
            { name: "longitude", type: "number", unit: "degrees" },
          );
          manifest.geography = {
            kind: "coordinates",
            crs: "EPSG:4326",
            latitudeField: "latitude",
            longitudeField: "longitude",
            geometryField: "geometry",
          };
        },
      },
      {
        name: "geometry",
        update(manifest: Record<string, unknown>) {
          const data = manifest.data as { fields: Array<Record<string, unknown>> };
          data.fields.push({ name: "geometry", type: "geometry", unit: null });
          manifest.geography = {
            kind: "geometry",
            crs: "EPSG:3794",
            geometryField: "geometry",
            latitudeField: "latitude",
          };
        },
      },
    ] as const;

    for (const variant of variants) {
      const extraKey = replaceManifest(staticFixture, variant.update);
      const result = await verifyContent(`geography-extra-${variant.name}`, extraKey, "static");
      expect(
        result.findings?.map((item) => item.code),
        variant.name,
      ).toContain("MANIFEST_INVALID");
    }
  });

  it("reports independent findings when the manifest and data body are both invalid", async () => {
    const invalidBody = "x".repeat(MAX_DATA_BYTES + 1);
    const withInvalidBody = interactiveFixture.replace(
      /(<script id="klopsi-presentation-data" type="application\/json">)[\s\S]*?(<\/script>)/u,
      `$1${invalidBody}$2`,
    );
    const combinedInvalid = replaceManifest(withInvalidBody, (manifest) => {
      manifest.title = "";
      manifest.mode = "static";
      manifest.views = [];
      const data = manifest.data as Record<string, unknown>;
      data.originalRows = 10_002;
      data.presentedRows = 10_001;
      data.embeddedBytes = 0;
    });

    const result = await verifyContent("combined-invalid", combinedInvalid, "interactive");
    expect(result.exitCode).toBe(1);
    expect(result.findings?.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "MANIFEST_INVALID",
        "MODE_MISMATCH",
        "VIEW_METADATA_INVALID",
        "DATA_TOO_LARGE",
        "ROW_LIMIT_EXCEEDED",
        "REDUCTION_UNDISCLOSED",
      ]),
    );
  });

  it("uses exit 2 for invalid invocation and non-regular input", async () => {
    expect(await runVerifier(["--json"])).toMatchObject({ exitCode: 2 });
    expect(await runVerifier([join(fixtures, "valid-static.html"), "--wat"])).toMatchObject({
      exitCode: 2,
    });
    expect(
      await runVerifier([
        join(fixtures, "valid-static.html"),
        "--mode",
        "static",
        "--mode",
        "interactive",
        "--json",
      ]),
    ).toMatchObject({ exitCode: 2 });
    expect(await runVerifier([temporaryDirectory, "--mode", "static", "--json"])).toMatchObject({
      exitCode: 2,
    });
  });
});
