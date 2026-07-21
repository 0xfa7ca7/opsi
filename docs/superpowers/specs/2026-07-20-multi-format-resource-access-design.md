# Multi-format Resource Access Design

## Summary

KLOPSI 0.2.0 discovers Slovenian open-data resources reliably, but its usable-data boundary is limited to direct CSV, TSV, JSON, NDJSON, XLSX, and Parquet files. Agents therefore leave the CLI when a catalogue resource is a ZIP archive, XML document, or WFS service. This change keeps KLOPSI as the network, safety, normalization, and provenance boundary for those resource types.

The release adds native, bounded adapters for resilient delimited text, ZIP-contained tabular data, generic XML records, and read-only WFS. It also adds a machine-readable resource access descriptor and updates generated Agent Skills so supported Slovenian-data workflows do not fall back to raw HTTP tools.

## Goals

- Let agents inspect every KLOPSI resource and receive a deterministic description of how it can be used.
- Preview, validate, query, and convert supported tabular files contained in ZIP archives.
- Preview, validate, query, and convert bounded repeated records from generic XML documents.
- Inspect and query WFS 1.0.0, 1.1.0, and 2.0.0 services without constructing raw URLs.
- Correctly handle common Slovenian delimited files that use UTF-16 or non-comma delimiters despite being declared as CSV.
- Preserve existing HTTPS, DNS/IP, redirect, timeout, byte, row, memory, cell, and output limits.
- Record enough provenance to reproduce archive extraction, XML normalization, and WFS exports.
- Generate Agent Skills that expose the new command surface and prohibit raw HTTP fallback for supported operations.

## Non-goals

- PDF table extraction or HTML scraping.
- WMS map rendering or raster analysis.
- Recursive archive extraction.
- Arbitrary XPath, CQL, XML request bodies, URL parameters, or HTTP headers.
- WFS transactions, feature locks, stored-query creation, or any remote write.
- Automatic weakening of HTTPS or private-network restrictions.
- Complete support for every XML vocabulary or every vendor-specific WFS extension.

## Evidence from live KLOPSI workflows

The design is based on bounded calls through the installed `klopsi` 0.2.0 CLI:

- The national budget resource `klopsi:resource:ed1d98c5-773c-4b13-a4ee-6d13ffe0911c` is declared CSV but downloads as UTF-16 LE, tab-separated text. Current preview exits 6 with `INVALID_TABULAR_DATA`.
- The police traffic resource `klopsi:resource:d7ab0364-1571-4f7f-b4e6-e37a25713951` is a ZIP archive. Current preview exits 5 with `DOWNLOAD_ONLY_FORMAT`.
- The ARSO air-quality resource `klopsi:resource:978f3d54-96d2-4167-a456-da7d9e0b8aec` is XML published over HTTP. Current preview correctly exits 2 with `INSECURE_DOWNLOAD_URL`; the new feature must retain that default.
- The cadastre resource `klopsi:resource:93961fe9-2ddb-4667-a1c3-229d0deccf37` is WFS. Current preview exits 5 with `UNSUPPORTED_RESOURCE_KIND`, causing agents to reconstruct `DescribeFeatureType` and `GetFeature` calls outside KLOPSI.
- PDF and HTML resources are reference documents rather than tabular inputs and must remain explicitly non-queryable.

## Architecture

### Access resolution

Add a core `ResourceAccessService` that produces a provider-neutral `ResourceAccessDescriptor`. It receives a local path, bare resource ID, or canonical reference and resolves:

- resource kind: `file`, `archive`, `service`, `api`, or `page`;
- declared and detected format;
- protocol and negotiated version for supported services;
- supported KLOPSI operations;
- relevant selections such as archive entries, XML record paths, or WFS layers;
- limitations and structured next actions.

The descriptor is rendered by:

```sh
klopsi resource inspect <input> --json
```

Next actions use structured argument arrays rather than shell strings:

```json
{
  "action": "service.layers",
  "argv": [
    "service",
    "layers",
    "klopsi:resource:93961fe9-2ddb-4667-a1c3-229d0deccf37",
    "--json"
  ]
}
```

The core owns orchestration; data-engine adapters never resolve provider metadata or perform unrestricted network access.

### Resilient delimited text

Extend detection and sampling before CSV parsing:

- Recognize UTF-8, UTF-16 LE, and UTF-16 BE byte-order marks.
- Decode a bounded sample and sniff comma, tab, semicolon, or pipe delimiters by consistent field counts across records.
- Prefer signature and bounded content evidence over provider declarations and filename extensions.
- Normalize decoded input into a temporary UTF-8 stream or file before existing CSV parsing.
- Report detected encoding and delimiter in inspection and preview metadata.
- Fail deterministically on ambiguous dialects, malformed encoding, or inconsistent records.

This behavior applies to local files, direct provider files, extracted archive entries, and WFS CSV responses.

### ZIP archives

ZIP remains a container, not a `SupportedDataFormat`. Add an archive adapter that lists central-directory entries without extracting them all.

Selection rules:

1. Ignore directories, macOS metadata, and unsupported entries.
2. Reject absolute paths, drive-letter paths, traversal segments, encrypted entries, symlinks, and nested archives.
3. If exactly one supported tabular/XML entry remains, select it automatically.
4. If more than one remains, return `ARCHIVE_ENTRY_REQUIRED` with sorted choices and a structured next action using `--entry`.
5. If none remain, return `ARCHIVE_NO_SUPPORTED_ENTRY`.

The selected entry is streamed to a private temporary file and passed back through normal format detection. The adapter enforces configuration-backed limits for compressed bytes, expanded bytes, entry count, selected-entry bytes, path length, compression ratio, and extraction time. It never recursively expands archives.

Existing operations gain `--entry <path>` where they accept data input:

```sh
klopsi resource preview <input> --entry <path>
klopsi validate <input> --entry <path>
klopsi query <input> --entry <path> --sql <statement>
klopsi convert <input> --entry <path> --to <format> --output <path>
klopsi dataset schema <id> --resource <resource> --entry <path>
```

### Generic XML

Add `xml` to supported input formats and parse with a streaming SAX-compatible parser declared as a direct dependency.

Record selection is deterministic:

- A bounded discovery pass finds repeated sibling element paths whose instances contain leaf text or attributes.
- If one strongest repeated path exists, use it and report it as `recordPath`.
- If equally plausible paths exist, return `XML_RECORD_PATH_REQUIRED` with sorted choices.
- `--record-path` accepts only an absolute slash-separated element path with optional namespace prefixes. It is not XPath and does not support predicates, functions, parent traversal, or arbitrary expressions.

Each record is flattened into a row:

- leaf element text becomes its namespace-qualified path relative to the record;
- attributes use `@name` at their relative element path;
- repeated scalar children become bounded arrays;
- mixed content, repeated structures beyond the supported depth, and geometry subtrees produce explicit warnings rather than silent loss;
- namespace prefixes and URIs are preserved in metadata.

Parsing enforces document bytes, element depth, attributes per element, text bytes per value, columns, records, array values, and total state. External entities and DTD processing are disabled.

Data operations gain `--record-path <path>`. XML can be previewed, schema-inferred, validated, queried, and converted to existing output formats after normalization.

### Read-only WFS

Add a provider-neutral service layer with a WFS adapter. The adapter follows the OGC Web Feature Service 2.0 presentation model, including bounded `count`, `startIndex`, `resultType`, and `outputFormat`, while negotiating compatible WFS 1.1.0 and 1.0.0 parameter names.

Commands:

```sh
klopsi service inspect <resource>
klopsi service layers <resource>
klopsi service schema <resource> --layer <name>
klopsi service preview <resource> --layer <name> [options]
klopsi service count <resource> --layer <name> [options]
klopsi service export <resource> --layer <name> --output <path> [options]
```

Preview/export options are:

- `--limit <rows>` with a required positive bounded value;
- repeatable/comma-separated `--property <name>`;
- `--bbox <minx,miny,maxx,maxy>`;
- `--crs <uri-or-epsg>` selected from advertised support;
- repeatable `--filter-eq <property=value>` with XSD-aware scalar encoding;
- `--start-index <number>` only where advertised or supported by the negotiated version;
- `--output <path>` and `--force` for export;
- the existing one-invocation network overrides.

The adapter:

1. Normalizes the catalogue capabilities URL without trusting existing request parameters.
2. Fetches and validates `GetCapabilities` through the same secure transport policy as downloads.
3. Negotiates the highest supported version in the order 2.0.0, 1.1.0, 1.0.0.
4. Exposes advertised layers, operations, output formats, filters, CRS values, bounds, and paging support.
5. Uses `DescribeFeatureType` for schema and validates selected properties and typed equality filters against it.
6. Uses `resultType=hits` for count when supported.
7. Prefers advertised CSV, then GeoJSON, then bounded GML/XML normalization.
8. Parses OGC exception reports into typed KLOPSI errors.
9. Never exposes transaction or arbitrary raw-request facilities.

Capabilities and schemas use the metadata cache. Feature responses use the existing content cache only when validators and request identity make reuse safe. Every request retains the global timeout and byte ceiling; preview additionally retains the row limit. Redirects are revalidated by existing network policy.

The WFS 2.0 behavior is grounded in the official OGC standard: <https://docs.ogc.org/is/09-025r2/09-025r2.html>.

### WMS, PDF, HTML, and APIs

`resource inspect` reports these kinds accurately but does not make them tabular:

- WMS: service metadata and protocol are reported; data operations return a typed unsupported-operation result.
- PDF and HTML: classified as reference/document resources with `dataset open` or resource metadata as the safe next action.
- Unknown APIs: classified as API resources but remain unsupported until a protocol adapter exists.

Agents receive a KLOPSI-native explanation and do not receive a suggestion to use raw HTTP.

## Error model

New stable error codes include:

- `ARCHIVE_ENTRY_REQUIRED`, `ARCHIVE_NO_SUPPORTED_ENTRY`, `UNSAFE_ARCHIVE_ENTRY`, `ARCHIVE_LIMIT_EXCEEDED`;
- `XML_RECORD_PATH_REQUIRED`, `XML_RECORD_PATH_INVALID`, `XML_LIMIT_EXCEEDED`, `INVALID_XML_DATA`;
- `WFS_LAYER_REQUIRED`, `WFS_LAYER_NOT_FOUND`, `WFS_VERSION_UNSUPPORTED`, `WFS_OUTPUT_FORMAT_UNSUPPORTED`, `WFS_RESPONSE_INVALID`, `WFS_OPERATION_UNSUPPORTED`;
- `SERVICE_LIMIT_EXCEEDED` and `SERVICE_EXCEPTION`.

Exit categories retain current semantics:

- invalid selections and syntax: exit 2;
- provider/network failures: exit 4;
- unsupported protocols or advertised operations: exit 5;
- malformed, unsafe, or integrity-invalid content: exit 6.

Errors include bounded context and `nextActions` when a safe KLOPSI continuation exists. URLs, credentials, cookies, raw response bodies, and unbounded provider diagnostics are never included.

## Provenance

Downloaded source artifacts keep existing provenance. Derived artifacts add ordered transformations:

- `decode-delimited`: source encoding and detected delimiter;
- `archive-extract`: archive digest, normalized entry path, compressed size, extracted size, and extracted digest;
- `xml-records`: record path, namespace map, flattening policy, and limits;
- `wfs-query`: canonical resource, negotiated version, layer, properties, typed filters, bbox, CRS, start index, limit, selected output format, response digest, and retrieval time.

Preview and inspection do not publish artifacts. Convert, query export, and WFS export publish atomically with adjacent provenance and support `provenance verify`. Temporary files and partial provenance are removed on failure.

## Agent Skills

The command manifest remains the source of truth for CLI paths and options. Skill generation adds `klopsi-services` and updates:

- `klopsi` routing for service-resource workflows;
- `klopsi-shared` with the rule that Slovenian open-data network access stays inside KLOPSI whenever a supported operation exists;
- `klopsi-resources` with inspect, archive entry, XML record-path, and recovery workflows;
- `klopsi-analysis` with archive/XML query and conversion options;
- `klopsi-diagnostics` and generated-skill inventory where required.

Generated instructions tell agents to inspect structured `nextActions`, preserve canonical references, keep previews bounded, and report unsupported protocols instead of falling back to `curl` or another raw HTTP client. Generation, checked-in skills, packaged contents, command help, and documentation must remain synchronized by tests.

## Testing strategy

All production behavior is developed test-first.

### Unit fixtures

- UTF-8, UTF-16 LE/BE, comma, tab, semicolon, pipe, ambiguous dialect, invalid encoding, and inconsistent records.
- Single-candidate, multi-candidate, empty, nested, traversal, absolute-path, encrypted, symlink, excessive-count, oversized, and excessive-ratio ZIP archives.
- Namespaced, repeated, nested, ambiguous, mixed-content, DTD/entity, deep, wide, oversized, and malformed XML.
- WFS 1.0.0, 1.1.0, and 2.0.0 capabilities; XSD schemas; CSV, GeoJSON, and GML results; hits responses; and OGC exception reports.

### Contract and integration tests

- Exact WFS KVP construction, version negotiation, URL normalization, property validation, filter encoding, paging, and output negotiation.
- HTTPS, DNS/IP, redirect, timeout, byte, row, XML-state, archive-expansion, and output limits.
- Access descriptors, stable errors, redaction, structured next actions, cache identity, atomic publication, cleanup, and provenance verification.
- Archive/XML inputs flowing through preview, schema, validation, query, conversion, and query export.

### CLI end-to-end tests

- Human, JSON, NDJSON, CSV, and TSV rendering where supported.
- stdout/stderr separation and exit categories.
- Inspect-to-selection workflows for ambiguous ZIP, XML, and WFS resources.
- WFS layers, schema, preview, count, and export.
- Help, completion, SDK declarations, package contents, and generated Agent Skills.

### Live smoke tests

Live tests are opt-in and do not gate normal CI because upstream availability is external:

- budget UTF-16 delimited preview;
- police ZIP inspection and bounded preview;
- ARSO XML access-policy behavior, preserving the default HTTP rejection;
- cadastre WFS capabilities, schema, preview, and count.

## Verification and acceptance

Before the pull request, run formatting, linting, build/type checking, unit, integration, CLI end-to-end, packaging, generated-skill consistency, and focused live smoke tests.

Acceptance requires:

- The tested budget resource previews without manual transcoding.
- A police ZIP resource can be inspected and a contained supported file previewed without external extraction tools.
- A permitted XML resource can be normalized with deterministic record selection and queried through KLOPSI.
- The cadastre `STAVBE` layer can be listed, schema-inspected, previewed with selected properties, and counted with a Ljubljana equality filter using only KLOPSI commands.
- No supported workflow requires direct URLs, `curl`, `xmllint`, `unzip`, or an untracked transformation.
- Existing tests and security policies continue to pass.
