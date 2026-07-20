# Multi-format Resource Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep agents inside OPSI when accessing resilient delimited files, ZIP-contained tabular data, generic XML records, and read-only WFS resources.

**Architecture:** A provider-neutral access contract describes supported operations and safe next actions. The data engine handles decoding, archive selection, and XML normalization; a core WFS service performs bounded read-only protocol operations through the existing secure downloader; the CLI and generated skills expose the resulting workflows without raw URLs.

**Tech Stack:** TypeScript 6, Node.js 24, Commander 15, Vitest 4, csv-parse 7, DuckDB Node API, undici 8, unzipper, saxes, pnpm workspaces.

## Global Constraints

- Preserve existing HTTPS, DNS/IP, redirect, timeout, byte, row, memory, cell, and output limits.
- Do not implement PDF extraction, HTML scraping, WMS rendering, recursive archives, arbitrary XPath/CQL/raw request parameters, or any WFS write operation.
- WFS support is read-only for versions 2.0.0, 1.1.0, and 1.0.0.
- Every remote input begins from an exact resource ID or canonical reference returned by OPSI.
- Structured output stays on stdout; diagnostics stay on stderr; stable exit categories remain unchanged.
- Every production behavior follows a witnessed red-green TDD cycle.
- Generated Agent Skills must prohibit raw HTTP fallback for operations implemented by OPSI.

---

### Task 1: Access contracts and structured recovery actions

**Files:**
- Modify: `packages/domain/src/provider.ts`
- Modify: `packages/domain/src/errors.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/test/domain.test.ts`
- Modify: `apps/cli/src/public-sdk.d.ts`
- Modify: `apps/cli/test/pack.test.ts`

**Interfaces:**
- Produces: `NextAction`, `ResourceAccessOperation`, `ResourceAccessDescriptor`, and `OpsiError.nextActions`.
- Consumes: existing `ResolvedResourceKind`, `CanonicalReference`, and `FailureExitCode`.

- [ ] **Step 1: Write failing domain tests for access descriptors and error serialization**

```ts
it("serializes safe recovery arguments without a shell command", () => {
  const error = new OpsiError({
    code: "ARCHIVE_ENTRY_REQUIRED",
    message: "Select an archive entry.",
    exitCode: EXIT_CODES.INVALID_INPUT,
    nextActions: [{
      action: "resource.preview",
      argv: ["resource", "preview", "opsi:resource:r", "--entry", "data.csv", "--json"],
    }],
  });
  expect(error.toJSON()).toMatchObject({
    nextActions: [{ action: "resource.preview", argv: expect.any(Array) }],
  });
  expect(JSON.stringify(error)).not.toContain("curl");
});
```

- [ ] **Step 2: Run the focused test and verify it fails because `nextActions` is not accepted**

Run: `pnpm vitest run --project unit packages/domain/test/domain.test.ts`

Expected: FAIL with a TypeScript/runtime mismatch for `nextActions`.

- [ ] **Step 3: Add the exact contracts and serialization**

```ts
export interface NextAction {
  readonly action: string;
  readonly argv: readonly string[];
  readonly reason?: string;
}

export type ResourceAccessOperation =
  | "inspect" | "preview" | "schema" | "validate" | "query" | "convert"
  | "download" | "layers" | "count" | "export" | "open";

export interface ResourceAccessDescriptor {
  readonly input: string;
  readonly kind: ResolvedResourceKind | "local";
  readonly declaredFormat?: string;
  readonly detectedFormat?: string;
  readonly protocol?: "wfs" | "wms" | "unknown";
  readonly version?: string;
  readonly operations: readonly ResourceAccessOperation[];
  readonly selections?: Readonly<Record<string, readonly string[]>>;
  readonly limitations: readonly string[];
  readonly nextActions: readonly NextAction[];
}
```

Add `nextActions?: readonly NextAction[]` to `OpsiErrorOptions` and `OpsiError`; include it in `toJSON()` only when non-empty.

- [ ] **Step 4: Update public declarations and pack-consumer assertions**

Assert a clean consumer can import `NextAction` and `ResourceAccessDescriptor` from `opsi/sdk` without private workspace types.

- [ ] **Step 5: Run domain and pack tests**

Run: `pnpm vitest run --project unit packages/domain/test/domain.test.ts && pnpm test:pack`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/domain apps/cli/src/public-sdk.d.ts apps/cli/test/pack.test.ts
git commit -m "feat: add resource access contracts"
```

### Task 2: Resilient delimited decoding and dialect detection

**Files:**
- Create: `packages/data-engine/src/text-decoding.ts`
- Modify: `packages/data-engine/src/types.ts`
- Modify: `packages/data-engine/src/detect.ts`
- Modify: `packages/data-engine/src/csv.ts`
- Modify: `packages/data-engine/src/inspect.ts`
- Modify: `packages/data-engine/src/index.ts`
- Modify: `packages/data-engine/test/detect.test.ts`
- Modify: `packages/data-engine/test/preview.test.ts`
- Modify: `packages/data-engine/test/validate.test.ts`

**Interfaces:**
- Produces: `TextEncoding`, `DelimitedDialect`, `detectTextEncoding()`, `decodeTextSample()`, and `sniffDelimitedDialect()`.
- Produces: optional `encoding` and `delimiter` fields on inspection/preview results.

- [ ] **Step 1: Add failing UTF-16 and dialect tests**

```ts
it("previews a UTF-16LE tab-separated file declared as CSV", async () => {
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("id\tname\r\n1\tLjubljana\r\n", "utf16le"),
  ]);
  const path = await temporaryBytes("budget.csv", bytes);
  await expect(engine.preview({ path, declaredFormat: "CSV" })).resolves.toMatchObject({
    format: "tsv",
    encoding: "utf-16le",
    delimiter: "\t",
    rows: [{ id: "1", name: "Ljubljana" }],
  });
});

it.each([",", ";", "\t", "|"])("sniffs %j consistently", async (delimiter) => {
  const path = await temporaryFile("sample.csv", `id${delimiter}name\n1${delimiter}a\n2${delimiter}b\n`);
  await expect(engine.preview(path)).resolves.toMatchObject({ delimiter });
});
```

- [ ] **Step 2: Run the preview tests and witness failure on UTF-16 and semicolon/pipe data**

Run: `pnpm vitest run --project unit packages/data-engine/test/detect.test.ts packages/data-engine/test/preview.test.ts`

Expected: FAIL because samples are decoded as UTF-8 and delimiters are limited to comma/tab.

- [ ] **Step 3: Implement bounded encoding and dialect detection**

```ts
export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";
export type DelimitedDialect = "," | "\t" | ";" | "|";

export function detectTextEncoding(head: Buffer): TextEncoding {
  if (head.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return "utf-16le";
  if (head.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) return "utf-16be";
  return "utf-8";
}
```

Use a fatal `TextDecoder` for bounded samples. Score delimiter candidates by consistent positive field counts over up to ten non-empty records, reject ties with `AMBIGUOUS_DELIMITED_DIALECT`, and stream decoded chunks into `csv-parse` without loading the complete file.

- [ ] **Step 4: Thread detected dialect metadata through detection, preview, validation, and DuckDB staging**

Use `read_csv(..., delim = <detected delimiter>)` after normalizing UTF-16 to an OPSI-owned temporary UTF-8 file. Ensure cleanup executes on success, parser failure, cancellation, and DuckDB failure.

- [ ] **Step 5: Run data-engine tests**

Run: `pnpm vitest run --project unit packages/data-engine/test/detect.test.ts packages/data-engine/test/preview.test.ts packages/data-engine/test/validate.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/data-engine
git commit -m "feat: support resilient delimited text"
```

### Task 3: Safe ZIP inspection and extraction

**Files:**
- Create: `packages/data-engine/src/archive.ts`
- Create: `packages/data-engine/test/archive.test.ts`
- Modify: `packages/data-engine/src/types.ts`
- Modify: `packages/data-engine/src/index.ts`
- Modify: `packages/data-engine/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `ArchiveLimits`, `ArchiveEntry`, `ArchiveInspection`, `inspectArchive()`, and `extractArchiveEntry()`.
- Consumes: `detectFormat()` to identify supported candidate entries after extraction.

- [ ] **Step 1: Add `unzipper` as a direct runtime dependency and write archive fixtures through a test-only ZIP builder**

Run: `pnpm --filter @opsi/data-engine add unzipper@0.12.3`

Use in-memory ZIP fixtures with exact entry names and contents; do not call a system `zip` binary.

- [ ] **Step 2: Write failing tests for automatic selection, ambiguity, and unsafe entries**

```ts
it("selects the only supported data entry", async () => {
  const archive = await zipFixture({ "README.txt": "x", "data/rows.csv": "id\n1\n" });
  await expect(inspectArchive(archive, limits)).resolves.toMatchObject({
    selectedEntry: "data/rows.csv",
  });
});

it.each(["../escape.csv", "/absolute.csv", "C:/drive.csv", "nested.zip"])(
  "rejects unsafe entry %s",
  async (name) => {
    const archive = await zipFixture({ [name]: "id\n1\n" });
    await expect(inspectArchive(archive, limits)).rejects.toMatchObject({
      code: "UNSAFE_ARCHIVE_ENTRY",
      exitCode: 6,
    });
  },
);
```

- [ ] **Step 3: Run the archive test and verify the module is missing**

Run: `pnpm vitest run --project unit packages/data-engine/test/archive.test.ts`

Expected: FAIL because `archive.ts` does not exist.

- [ ] **Step 4: Implement central-directory inspection and bounded single-entry extraction**

Default limits:

```ts
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 10_000,
  maxPathBytes: 1_024,
  maxSelectedBytes: 512 * 1024 * 1024,
  maxExpandedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
};
```

Normalize separators to `/`; reject empty segments, `.`, `..`, absolute paths, drive prefixes, NULs, encrypted entries, symlinks, and archive extensions. Stream only the selected entry to a private `wx` file and count output bytes during extraction.

- [ ] **Step 5: Add ambiguity and limit errors with safe next actions**

`ARCHIVE_ENTRY_REQUIRED` contains sorted entry choices and `resource preview <canonical> --entry <choice> --json` argument arrays when a canonical input is available.

- [ ] **Step 6: Run archive and package tests**

Run: `pnpm vitest run --project unit packages/data-engine/test/archive.test.ts && pnpm --filter @opsi/data-engine typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/data-engine pnpm-lock.yaml
git commit -m "feat: safely inspect and extract zip data"
```

### Task 4: Streaming XML record normalization

**Files:**
- Create: `packages/data-engine/src/xml.ts`
- Create: `packages/data-engine/test/xml.test.ts`
- Modify: `packages/data-engine/src/types.ts`
- Modify: `packages/data-engine/src/detect.ts`
- Modify: `packages/data-engine/src/inspect.ts`
- Modify: `packages/data-engine/src/tabular-stage.ts`
- Modify: `packages/data-engine/src/validate.ts`
- Modify: `packages/data-engine/src/index.ts`
- Modify: `packages/data-engine/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `XmlLimits`, `XmlDiscovery`, `discoverXmlRecords()`, `previewXml()`, and `writeXmlRowsAsNdjson()`.
- Adds `xml` to `SupportedDataFormat` and `--record-path` support through `PreviewOptions`.

- [ ] **Step 1: Add `saxes` as a direct dependency**

Run: `pnpm --filter @opsi/data-engine add saxes@6.0.0`

- [ ] **Step 2: Write failing XML discovery, namespace, ambiguity, and entity tests**

```ts
it("infers repeated namespaced records and flattens attributes", async () => {
  const path = await temporaryFile("air.xml", `<?xml version="1.0"?>
    <a:root xmlns:a="urn:air"><a:station id="LJ"><a:pm10>12</a:pm10></a:station>
    <a:station id="MB"><a:pm10>9</a:pm10></a:station></a:root>`);
  await expect(previewXml(path, { limit: 2 }, limits)).resolves.toMatchObject({
    recordPath: "/a:root/a:station",
    rows: [{ "@id": "LJ", "a:pm10": "12" }, { "@id": "MB", "a:pm10": "9" }],
  });
});

it("rejects DTD/entity input", async () => {
  const path = await temporaryFile("entity.xml", '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>');
  await expect(previewXml(path, {}, limits)).rejects.toMatchObject({ code: "INVALID_XML_DATA" });
});
```

- [ ] **Step 3: Run the XML tests and witness missing behavior**

Run: `pnpm vitest run --project unit packages/data-engine/test/xml.test.ts`

Expected: FAIL because XML is unsupported.

- [ ] **Step 4: Implement bounded SAX discovery and flattening**

Accept only record paths matching:

```ts
const RECORD_PATH = /^\/(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*(?:\/(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*)*$/u;
```

Disable DTD processing, reject entity declarations, preserve qualified element/attribute names, bound document bytes/depth/attributes/value bytes/columns/arrays/state, and select a unique strongest repeated sibling path. Return `XML_RECORD_PATH_REQUIRED` on equal candidates.

- [ ] **Step 5: Integrate XML preview, schema, validation, conversion, and query staging**

Preview calls `previewXml()`. DuckDB staging writes bounded normalized rows to an OPSI-owned NDJSON file, then imports that file with external access disabled. Conversion and validation reuse the same normalized row semantics.

- [ ] **Step 6: Run the XML and affected data-engine suites**

Run: `pnpm vitest run --project unit packages/data-engine/test/xml.test.ts packages/data-engine/test/preview.test.ts packages/data-engine/test/validate.test.ts packages/data-engine/test/convert.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/data-engine pnpm-lock.yaml
git commit -m "feat: normalize bounded xml records"
```

### Task 5: Thread archive/XML selection through core data operations

**Files:**
- Modify: `packages/core/src/data.ts`
- Modify: `packages/core/src/downloads.ts`
- Modify: `packages/core/src/conversions.ts`
- Modify: `packages/core/src/queries.ts`
- Modify: `packages/core/src/client.ts`
- Modify: `packages/core/test/downloads.test.ts`
- Create: `packages/core/test/data-preparation.test.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/commands/preview.ts`
- Modify: `apps/cli/src/commands/dataset.ts`
- Modify: `apps/cli/src/commands/validate.ts`
- Modify: `apps/cli/src/commands/query.ts`
- Modify: `apps/cli/src/commands/convert.ts`
- Modify: `apps/cli/test/data.e2e.test.ts`
- Modify: `apps/cli/test/query.e2e.test.ts`
- Modify: `apps/cli/test/convert.e2e.test.ts`

**Interfaces:**
- Extends `DataResolutionOptions` with `entry?: string` and `recordPath?: string`.
- Replaces `requireTabular` with `requireData`, permitting `file` and `archive` but rejecting `page`, `api`, and `service`.

- [ ] **Step 1: Replace the old ZIP guidance test with failing end-to-end selection tests**

```ts
await expect(cli(["resource", "preview", archive, "--json"])).resolves.toMatchObject({
  exitCode: 2,
  json: { error: { code: "ARCHIVE_ENTRY_REQUIRED", nextActions: expect.any(Array) } },
});
await expect(cli(["resource", "preview", archive, "--entry", "rows.csv", "--json"]))
  .resolves.toMatchObject({ exitCode: 0, json: { data: [{ id: "1" }] } });
```

- [ ] **Step 2: Run focused core and CLI tests and verify they fail on `--entry`/`--record-path`**

Run: `pnpm vitest run --project unit packages/core/test/data-preparation.test.ts && pnpm vitest run --project cli-e2e apps/cli/test/data.e2e.test.ts`

Expected: FAIL because options and archive preparation are absent.

- [ ] **Step 3: Add one scoped preparation lifecycle in `DataService.withResolvedInput()`**

Download files and archives to the existing private temporary directory. For archives, inspect/select/extract exactly one entry before invoking the operation. Pass `recordPath` into engine preview/staging. Always remove downloaded, extracted, transcoded, and normalized temporary files in `finally`.

- [ ] **Step 4: Add CLI options consistently**

Add `--entry <path>` and `--record-path <path>` to resource preview, dataset schema, validate, query, and convert manifests and adapters. Keep command help, completion, and conflict tests manifest-driven.

- [ ] **Step 5: Preserve transformations in convert/query provenance**

Extend prepared input metadata with ordered `TransformationRecord[]`. Merge `decode-delimited`, `archive-extract`, and `xml-records` before the final `query` or `convert` transformation; include source and extracted digests but not temporary paths.

- [ ] **Step 6: Run core and CLI data workflows**

Run: `pnpm vitest run --project unit packages/core/test/data-preparation.test.ts packages/core/test/downloads.test.ts && pnpm vitest run --project cli-e2e apps/cli/test/data.e2e.test.ts apps/cli/test/query.e2e.test.ts apps/cli/test/convert.e2e.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
git add packages/core apps/cli/src apps/cli/test
git commit -m "feat: route archive and xml data operations"
```

### Task 6: WFS protocol parsing and request construction

**Files:**
- Create: `packages/core/src/wfs/types.ts`
- Create: `packages/core/src/wfs/url.ts`
- Create: `packages/core/src/wfs/capabilities.ts`
- Create: `packages/core/src/wfs/schema.ts`
- Create: `packages/core/src/wfs/results.ts`
- Create: `packages/core/test/wfs-protocol.test.ts`
- Modify: `packages/core/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `WfsCapabilities`, `WfsLayer`, `WfsField`, `WfsQuery`, `buildWfsUrl()`, `parseWfsCapabilities()`, `parseWfsSchema()`, `parseWfsCount()`, and `parseWfsException()`.
- Consumes: bounded XML parsing utilities without provider or CLI dependencies.

- [ ] **Step 1: Write WFS 1.0/1.1/2.0 fixture tests before implementation**

```ts
it("builds bounded WFS 2.0 GetFeature KVP", () => {
  const url = buildWfsUrl(base, {
    version: "2.0.0", request: "GetFeature", layer: "SI.GURS.KN:STAVBE",
    limit: 5, startIndex: 0, properties: ["EID_STAVBA"], outputFormat: "csv",
  });
  expect(url.searchParams.get("service")).toBe("WFS");
  expect(url.searchParams.get("typeNames")).toBe("SI.GURS.KN:STAVBE");
  expect(url.searchParams.get("count")).toBe("5");
  expect(url.searchParams.get("propertyName")).toBe("EID_STAVBA");
});
```

Also assert WFS 1.x uses `typeName`/`maxFeatures`, existing `request`, `service`, `version`, filter, and output parameters are replaced rather than duplicated, and credentials/fragments are rejected.

- [ ] **Step 2: Run the protocol test and verify missing modules fail**

Run: `pnpm vitest run --project unit packages/core/test/wfs-protocol.test.ts`

Expected: FAIL because the WFS modules do not exist.

- [ ] **Step 3: Implement strict capabilities, XSD, count, and exception parsers**

Bound input size before parsing. Extract only advertised read operations, versions, feature type names/titles/default CRS/other CRS/bounds, result paging, output formats, and supported comparison/spatial operators. Ignore transaction metadata. Parse `numberMatched`/`numberOfFeatures`; map OGC exception code/text to `SERVICE_EXCEPTION` with redacted bounded context.

- [ ] **Step 4: Implement typed query encoding**

Validate layer and property names against capabilities/schema. Encode equality filters as XML Filter Encoding created from typed values, never accept raw CQL. Validate finite bbox coordinates and advertised CRS. Enforce positive limit and nonnegative start index before URL construction.

- [ ] **Step 5: Run protocol tests and typecheck**

Run: `pnpm vitest run --project unit packages/core/test/wfs-protocol.test.ts && pnpm --filter @opsi/core typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/core pnpm-lock.yaml
git commit -m "feat: add bounded wfs protocol support"
```

### Task 7: Secure WFS service and CLI commands

**Files:**
- Create: `packages/core/src/wfs/service.ts`
- Create: `packages/core/test/wfs-service.test.ts`
- Modify: `packages/core/src/client.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/cli/src/commands/service.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/program.ts`
- Create: `apps/cli/test/service.e2e.test.ts`
- Modify: `apps/cli/test/complete-surface.e2e.test.ts`
- Modify: `apps/cli/src/public-sdk.d.ts`

**Interfaces:**
- Produces: `OpsiClient.services.wfs` with `inspect()`, `layers()`, `schema()`, `preview()`, `count()`, and `export()`.
- Consumes: `Downloader`, provider registry, WFS protocol modules, DataEngine CSV/GeoJSON/XML normalization, cache, and provenance store.

- [ ] **Step 1: Write service tests with an injected secure downloader**

Assert the service resolves an exact WFS resource, negotiates 2.0.0 first, reuses cached capabilities/schema, validates fields before GetFeature, enforces row/byte limits, prefers CSV then GeoJSON then GML, and refuses WMS/page/API resources without calling the downloader.

- [ ] **Step 2: Run the service tests and verify `WfsService` is missing**

Run: `pnpm vitest run --project unit packages/core/test/wfs-service.test.ts`

Expected: FAIL because `WfsService` is undefined.

- [ ] **Step 3: Implement secure temporary WFS retrieval**

Every request uses `Downloader.download()` with the configured global limits, one-invocation network overrides, and allowed origin derived from the canonical resource. Use private temporary destinations and unconditional cleanup. Offline mode succeeds only from exact cached metadata/content identities and otherwise returns `OFFLINE_CACHE_MISS`.

- [ ] **Step 4: Implement preview, count, and atomic export**

Preview returns bounded normalized rows. Count sends `resultType=hits`. Export writes CSV, GeoJSON, or normalized NDJSON atomically and records `wfs-query` provenance with canonical resource, version, layer, selected properties, typed filters, bbox, CRS, pagination, output format, response digest, and retrieval time.

- [ ] **Step 5: Add manifest-driven CLI commands**

```text
service inspect <resource>
service layers <resource>
service schema <resource> --layer <name>
service preview <resource> --layer <name> --limit <rows>
service count <resource> --layer <name>
service export <resource> --layer <name> --output <path>
```

Add repeatable `--property`, repeatable `--filter-eq`, `--bbox`, `--crs`, `--start-index`, `--force`, and existing network options only on applicable commands. Parse `filter-eq` at the first `=` and reject empty property names.

- [ ] **Step 6: Add CLI E2E tests for JSON envelopes, human output, exits, and provenance**

Use the existing local fixture server/provider injection; no test should contact a live WFS endpoint.

- [ ] **Step 7: Run WFS core and CLI tests**

Run: `pnpm vitest run --project unit packages/core/test/wfs-service.test.ts packages/core/test/wfs-protocol.test.ts && pnpm vitest run --project cli-e2e apps/cli/test/service.e2e.test.ts apps/cli/test/complete-surface.e2e.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add packages/core apps/cli
git commit -m "feat: expose read-only wfs workflows"
```

### Task 8: Resource inspection and agent-safe access guidance

**Files:**
- Create: `packages/core/src/access.ts`
- Create: `packages/core/test/access.test.ts`
- Modify: `packages/core/src/client.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/downloads.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/commands/resource.ts`
- Modify: `apps/cli/test/data.e2e.test.ts`
- Modify: `apps/cli/test/final-regressions.test.ts`

**Interfaces:**
- Produces: `OpsiClient.access.inspect(input, options): Promise<ResourceAccessDescriptor>`.
- Consumes: resource resolution, format detection, archive inspection, XML discovery, and WFS inspection.

- [ ] **Step 1: Write failing descriptor tests for every resource kind**

Assert direct file, ZIP, XML, WFS, WMS, PDF, HTML/page, API, and unknown resources return deterministic operations, selections, limitations, and OPSI-only next actions. Assert serialized descriptors and errors contain neither raw URLs nor `curl`.

- [ ] **Step 2: Run focused access tests and witness missing service**

Run: `pnpm vitest run --project unit packages/core/test/access.test.ts`

Expected: FAIL because `ResourceAccessService` does not exist.

- [ ] **Step 3: Implement descriptor ranking and recovery builders**

Use canonical references in every action. Direct data files recommend preview; ambiguous ZIP/XML recommend the exact selection commands; WFS recommends layers/schema/preview; WMS reports metadata-only support; PDF/HTML recommend dataset/resource inspection or dataset open; unknown APIs report unsupported protocol without raw-HTTP advice.

- [ ] **Step 4: Add `resource inspect` and replace vague service/archive errors**

Expose `opsi resource inspect <input>`. Replace `Open the resource endpoint` and external extraction suggestions with structured OPSI actions or an explicit unsupported statement.

- [ ] **Step 5: Run access, download, and CLI regression tests**

Run: `pnpm vitest run --project unit packages/core/test/access.test.ts packages/core/test/downloads.test.ts && pnpm vitest run --project cli-e2e apps/cli/test/data.e2e.test.ts apps/cli/test/final-regressions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/core apps/cli
git commit -m "feat: guide agents through resource access"
```

### Task 9: Configuration, documentation, generated skills, and release metadata

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/load.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `apps/cli/src/agent-skills.ts`
- Modify: `apps/cli/test/agent-skills.test.ts`
- Modify: `apps/cli/test/generate-skills.e2e.test.ts`
- Modify: `apps/cli/test/release-contract.test.ts`
- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `docs/commands.md`
- Modify: `docs/configuration.md`
- Modify: `docs/formats.md`
- Modify: `docs/recipes.md`
- Modify: `docs/skills.md`
- Modify: `skills/opsi/SKILL.md`
- Modify: `skills/opsi-shared/SKILL.md`
- Modify: `skills/opsi-resources/SKILL.md`
- Modify: `skills/opsi-analysis/SKILL.md`
- Create: `skills/opsi-services/SKILL.md`
- Create: `.changeset/multi-format-resource-access.md`

**Interfaces:**
- Produces validated `archive` and `xml` limit configuration with documented defaults.
- Produces installable `opsi-services` skill generated from the command manifest.

- [ ] **Step 1: Write failing configuration and skill-generation assertions**

Assert unknown/invalid limit values fail configuration parsing; generated skills contain service commands, archive/XML options, canonical-reference guidance, bounded previews, exit-code handling, and the rule: `Do not fall back to curl or another raw HTTP client for an operation supported by opsi.`

- [ ] **Step 2: Run focused tests and witness missing config/skill surface**

Run: `pnpm vitest run --project unit packages/config/test/config.test.ts apps/cli/test/agent-skills.test.ts && pnpm vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts`

Expected: FAIL because new fields and `opsi-services` are absent.

- [ ] **Step 3: Add exact default limits and generated skill routing**

Document and validate archive entry count/path/expanded bytes/ratio and XML depth/attribute/value/column/state limits. Generate the new skill and update orchestrator routing. Keep installed CLI help authoritative when generated text differs.

- [ ] **Step 4: Update user documentation and recipes**

Include complete commands for the tested UTF-16 budget, police ZIP selection, generic XML record paths, and cadastre WFS layer/schema/preview/count workflows. State that ARSO HTTP still requires explicit one-invocation consent and that PDF/HTML/WMS remain non-tabular.

- [ ] **Step 5: Add a minor changeset and release-contract coverage**

```md
---
"opsi": minor
---

Add bounded ZIP, XML, resilient delimited, and read-only WFS data access with agent-safe recovery guidance.
```

- [ ] **Step 6: Regenerate checked-in skills and run consistency tests**

Run: `pnpm build && node apps/cli/dist/main.js generate-skills --output-dir skills && pnpm vitest run --project unit packages/config/test/config.test.ts apps/cli/test/agent-skills.test.ts && pnpm vitest run --project cli-e2e apps/cli/test/generate-skills.e2e.test.ts apps/cli/test/release-contract.test.ts`

Expected: PASS and `git diff --exit-code` after a second identical generation run.

- [ ] **Step 7: Commit**

```sh
git add packages/config apps/cli README.md docs skills .changeset pnpm-lock.yaml
git commit -m "docs: publish multi-format agent workflows"
```

### Task 10: Acceptance, regression verification, and PR readiness

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Consumes every task deliverable.
- Produces fresh verification evidence and a reviewable PR.

- [ ] **Step 1: Run targeted live smoke tests through the worktree CLI**

```sh
node apps/cli/dist/main.js --json resource preview opsi:resource:ed1d98c5-773c-4b13-a4ee-6d13ffe0911c --limit 2
node apps/cli/dist/main.js --json resource inspect opsi:resource:d7ab0364-1571-4f7f-b4e6-e37a25713951
node apps/cli/dist/main.js --json service layers opsi:resource:93961fe9-2ddb-4667-a1c3-229d0deccf37
node apps/cli/dist/main.js --json service schema opsi:resource:93961fe9-2ddb-4667-a1c3-229d0deccf37 --layer SI.GURS.KN:STAVBE
node apps/cli/dist/main.js --json service preview opsi:resource:93961fe9-2ddb-4667-a1c3-229d0deccf37 --layer SI.GURS.KN:STAVBE --property EID_STAVBA,RPE_OBCINE_NAZIV --limit 2
node apps/cli/dist/main.js --json service count opsi:resource:93961fe9-2ddb-4667-a1c3-229d0deccf37 --layer SI.GURS.KN:STAVBE --filter-eq RPE_OBCINE_NAZIV=Ljubljana
```

Expected: successful bounded results except documented transient provider/network failures, which must remain typed and must not prompt raw HTTP fallback.

- [ ] **Step 2: Run the complete quality gate**

Run: `pnpm check`

Expected: formatter, lint, typecheck, unit, integration, E2E, and pack checks all exit 0.

- [ ] **Step 3: Verify generated artifacts and repository state**

Run: `git diff --check && git status --short && git log --oneline origin/main..HEAD`

Expected: no whitespace errors, only intentional changes, and coherent task commits.

- [ ] **Step 4: Review the implementation against every acceptance requirement in the design spec**

Confirm budget decoding, ZIP selection, XML normalization, WFS layers/schema/preview/count, structured next actions, provenance, limits, skills, and no supported raw-HTTP fallback.

- [ ] **Step 5: Commit any verification fixes and rerun the affected test plus `pnpm check`**

Use a focused `fix:` commit only when verification finds a real defect.

- [ ] **Step 6: Push and open the PR requested by the user**

```sh
git push -u origin codex/multi-format-access
gh pr create --base main --head codex/multi-format-access \
  --title "feat: add multi-format resource access" \
  --body $'## Summary\n- add resilient delimited, safe ZIP, generic XML, and read-only WFS access\n- keep agent network access, limits, recovery guidance, and provenance inside OPSI\n- update generated OPSI skills and user documentation\n\n## Verification\n- pnpm check\n- bounded live smoke tests for budget, police ZIP, and cadastre WFS\n\n## Design\n- docs/superpowers/specs/2026-07-20-multi-format-resource-access-design.md\n- docs/superpowers/plans/2026-07-20-multi-format-resource-access.md'
```

The PR body summarizes format support, safety limits, agent-skill changes, test evidence, live-smoke results, exclusions, and the design/plan documents.
