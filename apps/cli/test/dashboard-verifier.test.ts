import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASHBOARD_VERIFIER_SOURCE } from "../src/agent-skill-resources.js";
import { renderAgentSkillPackages } from "../src/agent-skills.js";

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
  const body = JSON.stringify(rows).replaceAll("<", "\\u003c");
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

  it.each([
    ["inner-html", "target.innerHTML = row.label"],
    ["outer-html", "target.outerHTML = row.label"],
    ["inner-html-compound", "target.innerHTML += row.label"],
    ["outer-html-spaced-compound", "target . outerHTML ||= row.label"],
    ["inner-html-bracket-compound", 'target["innerHTML"] ??= row.label'],
    ["outer-html-bracket-spaced-compound", "target [ 'outerHTML' ] &&= row.label"],
    ["adjacent-html", "target.insertAdjacentHTML('beforeend', row.label)"],
    ["adjacent-html-optional-chain", "target?.insertAdjacentHTML('beforeend', row.label)"],
    ["document-write", "document.write(row.label)"],
    ["document-writeln", "document.writeln(row.label)"],
    ["dom-parser", "new DOMParser().parseFromString(row.label, 'text/html')"],
    ["contextual-fragment", "document.createRange().createContextualFragment(row.label)"],
  ])("rejects the %s HTML-producing sink while inert JSON stays allowed", async (name, sink) => {
    const dangerousRows = replaceInteractiveData(interactiveFixture, [
      { category: "</script><script>alert(1)</script>", value: 1 },
    ]);
    const withSink = dangerousRows.replace('"use strict";', `"use strict"; ${sink};`);

    const result = await verifyContent(`unsafe-sink-${name}`, withSink, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("UNSAFE_CODE");
    expect(result.findings?.map((item) => item.code)).not.toContain("JSON_EMBEDDING_UNSAFE");
  });

  it("allows HTML-producing property names when they occur only in inert JSON", async () => {
    const inertRows = replaceInteractiveData(interactiveFixture, [
      {
        category: "target.innerHTML += value",
        note: 'target["outerHTML"] ??= value',
        value: 1,
      },
    ]);

    expect(
      await verifyContent("inert-html-property-names", inertRows, "interactive"),
    ).toMatchObject({
      exitCode: 0,
      valid: true,
    });
  });

  it.each([
    ["javascript-anchor", '<a href="javascript:alert(1)">Citation</a>'],
    ["vbscript-anchor", '<a href="vbscript:msgbox(1)">Citation</a>'],
    [
      "active-data-anchor",
      '<a href="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E">Citation</a>',
    ],
  ])("rejects the %s active URL scheme", async (name, markup) => {
    const withActiveUrl = interactiveFixture.replace("</main>", `${markup}</main>`);

    const result = await verifyContent(name, withActiveUrl, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("UNSAFE_CODE");
  });

  it.each([
    ["tab-entity", '<a href="java&Tab;script:blocked">Citation</a>'],
    ["newline-entity", '<a href="java&NewLine;script:blocked">Citation</a>'],
    ["tab-entity-unquoted", "<a href=java&Tab;script:blocked>Citation</a>"],
    ["newline-entity-unquoted", "<a href=java&NewLine;script:blocked>Citation</a>"],
  ])("rejects an active URL obscured with the %s", async (name, markup) => {
    const withActiveUrl = interactiveFixture.replace("</main>", `${markup}</main>`);

    const result = await verifyContent(name, withActiveUrl, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("UNSAFE_CODE");
  });

  it.each([
    ["incorrect-case", "java&tab;script:blocked"],
    ["tab-without-required-semicolon", "java&Tab script:blocked"],
    ["newline-without-required-semicolon", "java&NewLine script:blocked"],
  ])("keeps %s entity text inert when browsers do not decode it", async (name, href) => {
    const inertEntityText = interactiveFixture.replace(
      "</main>",
      `<a href="${href}">Citation</a></main>`,
    );

    expect(
      await verifyContent(`entity-text-${name}`, inertEntityText, "interactive"),
    ).toMatchObject({ exitCode: 0, valid: true });
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

  it.each([
    ["relative-script", '<script src="dashboard.js"></script>'],
    ["root-style", '<link rel="stylesheet" href="/dashboard.css">'],
    ["file-image", '<img src="file:///tmp/chart.png" alt="Chart">'],
    ["blob-source", '<video><source src="blob:https://example.test/id"></video>'],
    ["relative-frame", '<iframe src="detail.html"></iframe>'],
    ["relative-object", '<object data="detail.svg"></object>'],
    ["relative-embed", '<embed src="detail.svg">'],
    ["relative-form", '<form action="submit"><button>Submit</button></form>'],
    ["relative-poster", '<video poster="poster.png"></video>'],
    ["relative-srcset", '<img srcset="small.png 1x, large.png 2x" alt="Chart">'],
    ["css-import", "<style>@import 'theme.css';</style>"],
    ["css-relative-url", "<style>.chart { background: url(chart.png) }</style>"],
    ["css-root-url", "<style>.chart { background: url(/chart.png) }</style>"],
    ["css-file-url", "<style>.chart { background: url(file:///tmp/chart.png) }</style>"],
    ["css-blob-url", "<style>.chart { background: url(blob:https://example.test/id) }</style>"],
  ])("rejects the %s loadable companion reference", async (name, markup) => {
    const withCompanion = staticFixture.replace("</main>", `${markup}</main>`);

    const result = await verifyContent(name, withCompanion, "static");
    expect(result.findings?.map((item) => item.code)).toContain("REMOTE_RESOURCE");
  });

  it("allows safe embedded raster data and fragment-only SVG references", async () => {
    const embedded = staticFixture
      .replace("</svg>", '<use href="#comparison-title"></use></svg>')
      .replace(
        "</main>",
        '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Embedded chart"></main>',
      );

    const result = await verifyContent("safe-embedded-resource", embedded, "static");
    expect(result, JSON.stringify(result)).toMatchObject({
      exitCode: 0,
      valid: true,
    });
  });

  it("rejects CSP sources that can re-enable companion resources", async () => {
    for (const source of ["'self'", "https:", "blob:", "file:"]) {
      const relaxed = interactiveFixture.replace(
        "script-src 'unsafe-inline'",
        `script-src 'unsafe-inline' ${source}`,
      );
      const result = await verifyContent(
        `csp-${source.replaceAll(/[^a-z]/giu, "")}`,
        relaxed,
        "interactive",
      );
      expect(
        result.findings?.map((item) => item.code),
        source,
      ).toContain("CSP_INVALID");
    }
  });

  it("rejects duplicate CSP directives even when the last value is restrictive", async () => {
    const duplicateDirective = staticFixture.replace(
      "connect-src 'none';",
      "connect-src https:; connect-src 'none';",
    );

    const result = await verifyContent("duplicate-csp", duplicateDirective, "static");
    expect(result.findings?.map((item) => item.code)).toContain("CSP_INVALID");
  });

  it.each([
    ["script-src-elem", "script-src-elem 'unsafe-inline';"],
    ["script-src-attr", "script-src-attr 'unsafe-inline';"],
    ["restrictive-worker-src", "worker-src 'none';"],
  ])("rejects the unexpected %s CSP directive", async (name, directive) => {
    const unexpected = interactiveFixture.replace(
      "script-src 'unsafe-inline'",
      `script-src 'unsafe-inline'; ${directive}`,
    );

    const result = await verifyContent(`csp-${name}`, unexpected, "interactive");
    expect(result.findings?.map((item) => item.code)).toContain("CSP_INVALID");
  });

  it("rejects case-insensitive duplicate CSP directive names with identical values", async () => {
    const duplicateDirective = staticFixture.replace(
      "connect-src 'none';",
      "connect-src 'none'; CONNECT-SRC 'none';",
    );

    const result = await verifyContent("duplicate-csp-case", duplicateDirective, "static");
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

  it("rejects extra keys in every nested manifest record", async () => {
    const mutations: Array<readonly [string, (manifest: Record<string, unknown>) => void]> = [
      [
        "source",
        (manifest) => {
          (manifest.sources as Array<Record<string, unknown>>)[0]!.extra = true;
        },
      ],
      [
        "field",
        (manifest) => {
          (
            (manifest.data as Record<string, unknown>).fields as Array<Record<string, unknown>>
          )[0]!.extra = true;
        },
      ],
      [
        "reduction",
        (manifest) => {
          manifest.reductions = [
            {
              method: "sample",
              originalRows: 2,
              presentedRows: 1,
              groupingFields: [],
              exclusions: [],
              sampleBasis: "first row",
              extra: true,
            },
          ];
          const data = manifest.data as Record<string, unknown>;
          data.presentedRows = 1;
        },
      ],
      [
        "view",
        (manifest) => {
          (manifest.views as Array<Record<string, unknown>>)[0]!.extra = true;
        },
      ],
      [
        "data",
        (manifest) => {
          (manifest.data as Record<string, unknown>).extra = true;
        },
      ],
    ];

    for (const [name, mutate] of mutations) {
      const result = await verifyContent(
        `nested-extra-${name}`,
        replaceManifest(staticFixture, mutate),
        "static",
      );
      expect(
        result.findings?.map((item) => item.code),
        name,
      ).toContain("MANIFEST_INVALID");
    }
  });

  it("requires reductions to form one ordered chain from overall original to presented rows", async () => {
    const variants: Array<readonly [string, readonly Record<string, unknown>[], number, number]> = [
      [
        "wrong-start",
        [
          {
            method: "filter",
            originalRows: 999,
            presentedRows: 2,
            groupingFields: [],
            exclusions: ["invalid"],
            sampleBasis: null,
          },
        ],
        3,
        2,
      ],
      [
        "broken-chain",
        [
          {
            method: "filter",
            originalRows: 4,
            presentedRows: 3,
            groupingFields: [],
            exclusions: ["invalid"],
            sampleBasis: null,
          },
          {
            method: "aggregate",
            originalRows: 2,
            presentedRows: 1,
            groupingFields: ["category"],
            exclusions: [],
            sampleBasis: null,
          },
        ],
        4,
        1,
      ],
      [
        "wrong-end",
        [
          {
            method: "aggregate",
            originalRows: 3,
            presentedRows: 2,
            groupingFields: ["category"],
            exclusions: [],
            sampleBasis: null,
          },
        ],
        3,
        1,
      ],
      [
        "non-reducing",
        [
          {
            method: "projection",
            originalRows: 2,
            presentedRows: 2,
            groupingFields: [],
            exclusions: [],
            sampleBasis: null,
          },
        ],
        2,
        2,
      ],
    ];

    for (const [name, reductions, originalRows, presentedRows] of variants) {
      const invalid = replaceManifest(staticFixture, (manifest) => {
        manifest.reductions = reductions;
        const data = manifest.data as Record<string, unknown>;
        data.originalRows = originalRows;
        data.presentedRows = presentedRows;
      });
      const result = await verifyContent(`reduction-${name}`, invalid, "static");
      expect(
        result.findings?.map((item) => item.code),
        name,
      ).toContain("MANIFEST_INVALID");
    }
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

  it("validates interactive EPSG:4326 coordinate rows and spatial exclusions", async () => {
    const rows = [{ latitude: 46.05, longitude: 14.5, value: 1 }];
    const spatial = replaceManifest(
      replaceInteractiveData(interactiveFixture, rows),
      (manifest) => {
        const data = manifest.data as Record<string, unknown>;
        data.originalRows = 2;
        data.fields = [
          { name: "latitude", type: "number", unit: "degrees" },
          { name: "longitude", type: "number", unit: "degrees" },
          { name: "value", type: "number", unit: "count" },
        ];
        manifest.reductions = [
          {
            method: "exclude invalid spatial rows",
            originalRows: 2,
            presentedRows: 1,
            groupingFields: [],
            exclusions: ["one row lacked valid coordinates"],
            sampleBasis: null,
          },
        ];
        manifest.geography = {
          kind: "coordinates",
          crs: "EPSG:4326",
          latitudeField: "latitude",
          longitudeField: "longitude",
          validRecords: 1,
          excludedRecords: 1,
        };
      },
    );

    expect(await verifyContent("valid-coordinate-data", spatial, "interactive")).toMatchObject({
      exitCode: 0,
      valid: true,
    });

    for (const [name, latitude, longitude] of [
      ["nonfinite", "NaN", 14.5],
      ["latitude-range", 91, 14.5],
      ["longitude-range", 46.05, 181],
    ] as const) {
      const invalid = replaceInteractiveData(spatial, [{ latitude, longitude, value: 1 }]);
      const result = await verifyContent(`coordinate-${name}`, invalid, "interactive");
      expect(
        result.findings?.map((item) => item.code),
        name,
      ).toContain("MANIFEST_INVALID");
    }
  });

  it("accepts verifiable static spatial evidence and rejects unverifiable static geography", async () => {
    const spatialRows = [{ geometry: { type: "Point", coordinates: [14.5, 46.05] }, value: 2 }];
    const body = JSON.stringify(spatialRows);
    const staticMap = replaceManifest(
      staticFixture.replace(
        "</body>",
        `<script id="klopsi-presentation-data" type="application/json">${body}</script></body>`,
      ),
      (manifest) => {
        const data = manifest.data as Record<string, unknown>;
        data.embeddedBytes = Buffer.byteLength(body);
        data.originalRows = 1;
        data.presentedRows = 1;
        data.fields = [
          { name: "geometry", type: "geometry", unit: null },
          { name: "value", type: "number", unit: "count" },
        ];
        manifest.geography = {
          kind: "geometry",
          crs: "EPSG:4326",
          geometryField: "geometry",
          validRecords: 1,
          excludedRecords: 0,
        };
      },
    );

    expect(await verifyContent("valid-static-map", staticMap, "static")).toMatchObject({
      exitCode: 0,
      valid: true,
    });

    const withoutEvidence = staticMap.replace(
      /<script id="klopsi-presentation-data"[\s\S]*?<\/script>/u,
      "",
    );
    const result = await verifyContent("static-map-without-evidence", withoutEvidence, "static");
    expect(result.findings?.map((item) => item.code)).toContain("MANIFEST_INVALID");
  });

  it("rejects unsupported CRS identifiers and structurally invalid geometry", async () => {
    const rows = [
      {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [14, 46],
              [15, 46],
              [15, 47],
            ],
          ],
        },
      },
    ];
    let invalid = replaceInteractiveData(interactiveFixture, rows);
    invalid = replaceManifest(invalid, (manifest) => {
      const data = manifest.data as Record<string, unknown>;
      data.fields = [{ name: "geometry", type: "geometry", unit: null }];
      manifest.geography = {
        kind: "geometry",
        crs: "urn:invented:crs",
        geometryField: "geometry",
        validRecords: 1,
        excludedRecords: 0,
      };
    });
    const result = await verifyContent("invalid-crs-geometry", invalid, "interactive");
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

  it.each([
    ["doctype", (html: string) => html.replace("<!doctype html>", ""), "DOCTYPE_MISSING"],
    ["language", (html: string) => html.replace(' lang="en"', ""), "LANGUAGE_MISSING"],
    [
      "charset",
      (html: string) => html.replace(/<meta charset="utf-8" \/>/u, ""),
      "CHARSET_MISSING",
    ],
    [
      "viewport",
      (html: string) => html.replace(/<meta name="viewport"[^>]*\/>/u, ""),
      "VIEWPORT_MISSING",
    ],
    [
      "title",
      (html: string) =>
        html.replace("<title>Verified dashboard fixture</title>", "<title> </title>"),
      "TITLE_MISSING",
    ],
    ["main", (html: string) => html.replace("<main>", "<main hidden>"), "MAIN_INVALID"],
    [
      "heading",
      (html: string) =>
        html.replace(
          "<h1>Verified dashboard fixture</h1>",
          "<h1 hidden>Verified dashboard fixture</h1>",
        ),
      "HEADING_INVALID",
    ],
  ])("reports stable document structure finding for missing %s", async (_name, mutate, code) => {
    const result = await verifyContent(`structure-${code}`, mutate(staticFixture), "static");
    expect(result.findings?.map((item) => item.code)).toContain(code);
  });

  it("requires visible nonempty summary, disclosure, and lineage regions", async () => {
    for (const [name, attribute] of [
      ["summary", "data-klopsi-summary"],
      ["disclosures", "data-klopsi-disclosures"],
      ["lineage", "data-klopsi-lineage"],
    ] as const) {
      for (const mutation of [
        (html: string) => html.replace(attribute, `${attribute} hidden`),
        (html: string) =>
          name === "summary"
            ? html.replace(
                /<p class="summary" data-klopsi-summary>[\s\S]*?<\/p>/u,
                '<p class="summary" data-klopsi-summary> </p>',
              )
            : html.replace(
                new RegExp(`<section class="card" ${attribute}>[\\s\\S]*?<\\/section>`, "u"),
                `<section class="card" ${attribute}> </section>`,
              ),
      ]) {
        const result = await verifyContent(`region-${name}`, mutation(staticFixture), "static");
        expect(
          result.findings?.map((item) => item.code),
          name,
        ).toContain(
          name === "summary"
            ? "SUMMARY_MISSING"
            : name === "disclosures"
              ? "DISCLOSURES_MISSING"
              : "LINEAGE_MISSING",
        );
      }
    }
  });

  it("validates interactive controls, reset, live count, table, empty state, and noscript", async () => {
    const variants: Array<readonly [string, string, string]> = [
      [
        "unlabeled-control",
        interactiveFixture.replace('<label for="search-filter">Search category</label>', ""),
        "FILTER_REGION_MISSING",
      ],
      [
        "custom-control",
        interactiveFixture.replace(
          "</form>",
          '<div role="button" tabindex="0">Custom filter</div></form>',
        ),
        "FILTER_REGION_MISSING",
      ],
      [
        "reset-link",
        interactiveFixture.replace(
          '<button type="button" data-klopsi-reset>Reset filters</button>',
          '<a data-klopsi-reset href="#">Reset filters</a>',
        ),
        "RESET_MISSING",
      ],
      [
        "disabled-reset",
        interactiveFixture.replace("data-klopsi-reset", "data-klopsi-reset disabled"),
        "RESET_MISSING",
      ],
      [
        "hidden-reset",
        interactiveFixture.replace("data-klopsi-reset", "data-klopsi-reset hidden"),
        "RESET_MISSING",
      ],
      [
        "aria-hidden-reset",
        interactiveFixture.replace("data-klopsi-reset", 'data-klopsi-reset aria-hidden="true"'),
        "RESET_MISSING",
      ],
      [
        "aria-disabled-reset",
        interactiveFixture.replace("data-klopsi-reset", 'data-klopsi-reset aria-disabled="true"'),
        "RESET_MISSING",
      ],
      [
        "inert-reset",
        interactiveFixture.replace("data-klopsi-reset", "data-klopsi-reset inert"),
        "RESET_MISSING",
      ],
      [
        "untabbable-reset",
        interactiveFixture.replace("data-klopsi-reset", 'data-klopsi-reset tabindex="-1"'),
        "RESET_MISSING",
      ],
      [
        "disabled-filter",
        interactiveFixture.replace('id="search-filter"', 'id="search-filter" disabled'),
        "FILTER_REGION_MISSING",
      ],
      [
        "hidden-filter",
        interactiveFixture.replace('id="search-filter"', 'id="search-filter" hidden'),
        "FILTER_REGION_MISSING",
      ],
      [
        "aria-hidden-filter",
        interactiveFixture.replace('id="search-filter"', 'id="search-filter" aria-hidden="true"'),
        "FILTER_REGION_MISSING",
      ],
      [
        "aria-disabled-filter",
        interactiveFixture.replace('id="search-filter"', 'id="search-filter" aria-disabled="true"'),
        "FILTER_REGION_MISSING",
      ],
      [
        "inert-filter",
        interactiveFixture.replace('id="search-filter"', 'id="search-filter" inert'),
        "FILTER_REGION_MISSING",
      ],
      [
        "untabbable-filter",
        interactiveFixture.replace('id="search-filter"', 'id="search-filter" tabindex="-1"'),
        "FILTER_REGION_MISSING",
      ],
      [
        "non-polite-count",
        interactiveFixture.replace('aria-live="polite"', 'aria-live="assertive"'),
        "RECORD_COUNT_MISSING",
      ],
      [
        "non-table-detail",
        interactiveFixture.replace(
          "<table data-klopsi-detail-table>",
          "<div data-klopsi-detail-table>",
        ),
        "DETAIL_TABLE_MISSING",
      ],
      [
        "missing-thead",
        interactiveFixture.replace(/<thead>[\s\S]*?<\/thead>/u, ""),
        "DETAIL_TABLE_MISSING",
      ],
      [
        "empty-empty-state",
        interactiveFixture.replace(
          "No records match the current filters. Reset filters or broaden the search.",
          " ",
        ),
        "EMPTY_STATE_MISSING",
      ],
      [
        "empty-noscript",
        interactiveFixture.replace(/<noscript>[\s\S]*?<\/noscript>/u, "<noscript> </noscript>"),
        "NOSCRIPT_MISSING",
      ],
    ];
    for (const [name, html, code] of variants) {
      const result = await verifyContent(`interactive-a11y-${name}`, html, "interactive");
      expect(
        result.findings?.map((item) => item.code),
        name,
      ).toContain(code);
    }
  });

  it("requires accessible SVG title and description when SVG exists", async () => {
    for (const [name, html] of [
      ["no-title", staticFixture.replace(/<title id="comparison-title">[\s\S]*?<\/title>/u, "")],
      ["no-desc", staticFixture.replace(/<desc id="comparison-desc">[\s\S]*?<\/desc>/u, "")],
      [
        "wrong-label",
        staticFixture.replace(
          'aria-labelledby="comparison-title comparison-desc"',
          'aria-labelledby="missing-title missing-desc"',
        ),
      ],
    ] as const) {
      const result = await verifyContent(`svg-${name}`, html, "static");
      expect(
        result.findings?.map((item) => item.code),
        name,
      ).toContain("SVG_ACCESSIBILITY_INVALID");
    }
  });

  it("ignores fake markers and structure inside comments and script text", async () => {
    const withInertText = staticFixture
      .replace("<main>", "<!-- {{COMMENT_MARKER}} <main><h1>Fake</h1></main> --><main>")
      .replace(
        "</body>",
        '<script type="application/json">"{{SCRIPT_MARKER}} <main><h1>Fake</h1></main>"</script></body>',
      );

    expect(await verifyContent("inert-marker-text", withInertText, "static")).toMatchObject({
      exitCode: 0,
      valid: true,
    });
  });

  it("instantiates and exercises the generated interactive starter behavior", () => {
    const template =
      renderAgentSkillPackages("1.2.3")
        .get("klopsi-interactive-dashboard")
        ?.files.get("assets/interactive-dashboard.html") ?? "";
    expect(template).toContain('data-field="category"');
    expect(template).toContain('data-sort-field="category"');

    const script = [...template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu)].at(-1)?.[1];
    expect(script).toBeDefined();
    if (script === undefined) return;

    type Listener = () => void;
    const listeners = new Map<string, Listener>();
    const control = {
      dataset: { filterField: "category" },
      value: "",
      focused: false,
      focus() {
        this.focused = true;
      },
    };
    const form = {
      querySelectorAll: () => [control],
      querySelector: () => control,
      addEventListener: (name: string, listener: Listener) =>
        listeners.set(`form:${name}`, listener),
      reset: () => {
        control.value = "";
      },
    };
    const headerAttributes = new Map<string, string>();
    const header = {
      dataset: { field: "category" },
      setAttribute: (name: string, value: string) => headerAttributes.set(name, value),
    };
    const sortAttributes = new Map<string, string>();
    const sortButton = {
      dataset: { sortField: "category", sortLabel: "Category" },
      textContent: "Category",
      closest: () => header,
      addEventListener: (name: string, listener: Listener) =>
        listeners.set(`sort:${name}`, listener),
      setAttribute: (name: string, value: string) => sortAttributes.set(name, value),
    };
    const resetButton = {
      addEventListener: (name: string, listener: Listener) =>
        listeners.set(`reset:${name}`, listener),
    };
    const count = { textContent: "" };
    const viewCount = { textContent: "" };
    const tableBody = {
      children: [] as unknown[],
      replaceChildren() {
        this.children = [];
      },
      append(child: unknown) {
        this.children.push(child);
      },
    };
    const table = {
      hidden: false,
      querySelector: () => tableBody,
      querySelectorAll: () => [header],
    };
    const emptyState = { hidden: true };
    const makeNode = () => ({
      textContent: "",
      children: [] as unknown[],
      append(...children: unknown[]) {
        this.children.push(...children);
      },
    });
    const document = {
      querySelector(selector: string) {
        return new Map<string, unknown>([
          ["#klopsi-presentation-data", { textContent: '[{"category":"A"},{"category":"B"}]' }],
          ["[data-klopsi-filter-region] form", form],
          ["[data-klopsi-reset]", resetButton],
          ["[data-klopsi-record-count]", count],
          ["[data-klopsi-detail-table]", table],
          ["[data-klopsi-empty-state]", emptyState],
        ]).get(selector);
      },
      querySelectorAll(selector: string) {
        if (selector === "[data-view-count]") return [viewCount];
        if (selector === "[data-sort-field]") return [sortButton];
        return [];
      },
      createElement: makeNode,
    };

    runInNewContext(script, { document, JSON, String, Object, Array });
    expect(count.textContent).toBe("2 of 2 records match.");
    expect(tableBody.children).toHaveLength(2);
    expect(headerAttributes.get("aria-sort")).toBe("none");

    control.value = "missing";
    listeners.get("form:input")?.();
    expect(count.textContent).toBe("0 of 2 records match.");
    expect(emptyState.hidden).toBe(false);

    listeners.get("sort:click")?.();
    expect(headerAttributes.get("aria-sort")).toBe("ascending");
    expect(sortAttributes.get("aria-label")).toContain("currently ascending");

    listeners.get("reset:click")?.();
    expect(count.textContent).toBe("2 of 2 records match.");
    expect(control.focused).toBe(true);
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
