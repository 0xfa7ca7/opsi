export interface AgentSkillResource {
  readonly path: string;
  readonly content: string;
}

const PRESENTATION_CONTRACT = `# KLOPSI dashboard presentation contract

This reference is the normative shared contract for static and interactive HTML dashboard artifacts. The verifier is a bounded, dependency-free contract linter; it is not an HTML parser, sanitizer, browser, or security sandbox.

## 1. Input readiness and source verification

- Start from a prepared local artifact or a bounded structured result persisted through KLOPSI when that path is supported. Route invalid input to \`klopsi-validation\` and reshaping, projection, aggregation, or sampling to \`klopsi-analysis\` or \`klopsi-services\`.
- Run \`klopsi provenance verify <artifact> --json\` whenever an adjacent KLOPSI provenance record exists. Stop on verification failure. If no record exists, mark the source \`verified: false\`; never invent verification or lineage.
- Preserve exact source identities and compute or retain a SHA-256 digest for every presented source.

## 2. Artifact and data limits

- A complete HTML file, including embedded markup, styles, scripts, data, and geometry, must be no larger than 15 MB (15 * 1024 * 1024 bytes).
- Interactive presentation data must contain at most 10,000 prepared rows and its UTF-8 JSON script body must be no larger than 5 MB (5 * 1024 * 1024 bytes).
- Static mode embeds only the aggregate values needed by its visible views and sets \`data.embeddedBytes\` to \`0\`; it does not include an executable script or a presentation-data block.

## 3. No silent truncation and reduction disclosure

Never silently truncate. When the source exceeds a limit, aggregate or project first. Sample only when aggregation cannot answer the question, and ask before sampling when it could materially change interpretation.

When \`originalRows\` exceeds \`presentedRows\`, include at least one reduction record and explain the same reduction visibly under \`data-klopsi-disclosures\`. A reduction record contains \`method\`, \`originalRows\`, \`presentedRows\`, \`groupingFields\`, \`exclusions\`, and \`sampleBasis\` (null when no sampling occurred). State grouping fields, exclusions, and the sample basis plainly.

## 4. Presentation manifest

Embed exactly one non-executable block named \`klopsi-presentation-manifest\`:

\`<script id="klopsi-presentation-manifest" type="application/json">…</script>\`

Its JSON object has these exact required top-level fields:

- \`schemaVersion\`: the string \`"1"\`;
- \`mode\`: \`"static"\` or \`"interactive"\`;
- \`generator\`: the string \`"klopsi-agent-skill"\`;
- \`generatedAt\`: a canonical UTC ISO-8601 timestamp in \`YYYY-MM-DDTHH:mm:ss.sssZ\` form;
- \`title\`: a nonempty presentation title;
- \`sources\`: a nonempty array of \`identity\`, 64-character lowercase hexadecimal \`sha256\`, boolean \`verified\`, and optional nonempty \`provenancePath\` records;
- \`transformations\`: an array of nonempty plain-language strings;
- \`reductions\`: an array of the reduction records defined above;
- \`data\`: nonnegative integer \`originalRows\`, \`presentedRows\`, and \`embeddedBytes\`, plus a nonempty \`fields\` array. Each field has nonempty \`name\` and \`type\`, and \`unit\` is a nonempty string or null;
- \`geography\`: one of the conditional forms below;
- \`views\`: 2–6 records for static mode or 2–4 for interactive mode. Every record has nonempty \`id\`, \`question\`, \`population\`, \`unit\`, \`takeaway\`, and a nonnegative integer \`recordCount\`.

Geography is conditional:

- no map: \`{"kind":"none","crs":null}\`;
- point coordinates: \`kind\` is \`"coordinates"\`, \`crs\` is nonempty, and \`latitudeField\` and \`longitudeField\` name embedded fields;
- embedded geometry: \`kind\` is \`"geometry"\`, \`crs\` is nonempty, and \`geometryField\` names the embedded geometry field.

Do not map data without valid embedded coordinates or geometry and known CRS information. Never geocode, guess coordinates, infer a CRS, or fetch tiles.

Interactive mode additionally embeds exactly one \`klopsi-presentation-data\` application/JSON script whose body is a JSON array. Its UTF-8 byte length and row count must exactly equal manifest \`embeddedBytes\` and \`presentedRows\`.

## 5. Offline and content security

The artifact is one self-contained HTML file. Opening it must not load remote scripts, styles, images, fonts, frames, media, imports, data, telemetry, APIs, map tiles, or meta-refresh navigation. Ordinary visible citation anchors may link to sources because they do not load on open.

Include a Content Security Policy meta element that at minimum sets \`default-src 'none'\`, \`connect-src 'none'\`, \`object-src 'none'\`, \`base-uri 'none'\`, and \`form-action 'none'\`, with no duplicate directives. Inline styles and the interactive inline script may be enabled explicitly. Do not use inline \`on*\` event handlers, \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, \`EventSource\`, \`sendBeacon\`, dynamic \`import()\`, \`eval\`, \`new Function\`, frames, objects, or embeds.

## 6. Safe JSON and DOM text handling

Serialize JSON with every \`<\` escaped as \`\\u003c\` before placing it in either application/JSON script body, so data cannot terminate the containing element. Parse only those inert JSON blocks. Render data-derived labels, cells, tooltips, and summaries with \`textContent\`, DOM node creation, or equivalent attribute-safe APIs; never concatenate data into \`innerHTML\`.

## 7. Accessibility and visual metadata

Use a document language, UTF-8 charset, viewport metadata, a descriptive title, one main landmark, and a visible level-one heading. Every presentation includes visible \`data-klopsi-summary\`, \`data-klopsi-disclosures\`, and \`data-klopsi-lineage\` regions.

Choose encodings from the analytical question. Every view exposes its question, population, units, relevant record count, and plain-language takeaway. Do not use color as the only information carrier, fabricate precision, make unsupported causal claims, or leave scales unlabeled. Tables use semantic headers; controls are visibly labeled and keyboard operable; SVG graphics have an accessible name and description.

Interactive dashboards also include \`data-klopsi-filter-region\`, \`data-klopsi-record-count\`, \`data-klopsi-detail-table\`, \`data-klopsi-reset\`, \`data-klopsi-empty-state\`, and a useful \`noscript\` summary. Reset restores the documented initial state and the matching count reflects the current filtered row set.

## 8. Verify before handoff

Run the shared verifier after writing or changing the dashboard:

\`\`\`sh
node ../klopsi-shared/scripts/verify-dashboard.mjs <dashboard.html> --mode <static|interactive> --json
\`\`\`

Exit 0 means the bounded checks found no contract violations. Exit 1 returns repairable contract findings with stable \`code\` and \`message\` values. Exit 2 means the invocation or input path is invalid. Repair every finding and rerun before handoff. A pass does not mean arbitrary HTML is safe; review the produced artifact and open it only in an appropriately isolated environment.

## 9. Presentation evidence is not provenance

The embedded manifest records presentation evidence, source digests, verification status, transformations, reductions, and visual semantics. It is not a KLOPSI provenance sidecar and passing the dashboard verifier is not official artifact provenance. Use \`klopsi provenance verify\` to make provenance claims.
`;

export const DASHBOARD_VERIFIER_SOURCE = String.raw`/* global Buffer, process */
import { readFile, stat } from 'node:fs/promises';

const MAX_HTML_BYTES = 15 * 1024 * 1024;
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const MAX_INTERACTIVE_ROWS = 10_000;

function finding(code, message) {
  return { code, message };
}

function add(findings, condition, code, message) {
  if (condition) findings.push(finding(code, message));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function attributeValue(tag, name) {
  const pattern = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", 'iu');
  const match = pattern.exec(tag);
  return match === null ? undefined : (match[1] ?? match[2] ?? match[3]);
}

function openingTags(html) {
  return html.match(/<[a-z][^>]*>/giu) ?? [];
}

function hasAttribute(html, name) {
  return openingTags(html).some((tag) => attributeValue(tag, name) !== undefined || new RegExp('\\s' + name + '(?=\\s|>)', 'iu').test(tag));
}

function extractJsonScripts(html, id) {
  const blocks = [];
  const pattern = /<script\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    const matches = attributeValue(tag, 'id') === id
      && attributeValue(tag, 'type')?.toLowerCase() === 'application/json';
    const closeStart = html.toLowerCase().indexOf('</script', pattern.lastIndex);
    if (closeStart < 0) {
      if (matches) blocks.push({ body: undefined });
      break;
    }
    const closeEnd = html.indexOf('>', closeStart);
    if (closeEnd < 0) {
      if (matches) blocks.push({ body: undefined });
      break;
    }
    if (matches) blocks.push({ body: html.slice(pattern.lastIndex, closeStart) });
    pattern.lastIndex = closeEnd + 1;
  }
  return blocks;
}

function parseJsonBlock(block) {
  if (block.body === undefined) return { value: undefined, parsed: false, unsafe: false };
  const unsafe = block.body.includes('<');
  try {
    return { value: JSON.parse(block.body), parsed: true, unsafe };
  } catch {
    return { value: undefined, parsed: false, unsafe };
  }
}

function validSource(source) {
  return isObject(source)
    && isNonemptyString(source.identity)
    && typeof source.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(source.sha256)
    && typeof source.verified === 'boolean'
    && (source.provenancePath === undefined || isNonemptyString(source.provenancePath));
}

function validField(field) {
  return isObject(field)
    && isNonemptyString(field.name)
    && isNonemptyString(field.type)
    && (field.unit === null || isNonemptyString(field.unit));
}

function validReduction(reduction) {
  return isObject(reduction)
    && isNonemptyString(reduction.method)
    && isCount(reduction.originalRows)
    && isCount(reduction.presentedRows)
    && Array.isArray(reduction.groupingFields)
    && reduction.groupingFields.every(isNonemptyString)
    && Array.isArray(reduction.exclusions)
    && reduction.exclusions.every(isNonemptyString)
    && (reduction.sampleBasis === null || isNonemptyString(reduction.sampleBasis));
}

function validGeography(geography, fields) {
  if (!isObject(geography)) return false;
  if (geography.kind === 'none') return geography.crs === null;
  const fieldNames = new Set(fields.map((field) => field.name));
  if (geography.kind === 'coordinates') {
    return isNonemptyString(geography.crs)
      && isNonemptyString(geography.latitudeField)
      && isNonemptyString(geography.longitudeField)
      && fieldNames.has(geography.latitudeField)
      && fieldNames.has(geography.longitudeField);
  }
  if (geography.kind === 'geometry') {
    return isNonemptyString(geography.crs)
      && isNonemptyString(geography.geometryField)
      && fieldNames.has(geography.geometryField);
  }
  return false;
}

function validManifest(manifest) {
  if (!isObject(manifest)) return false;
  if (!hasExactKeys(manifest, [
    'schemaVersion',
    'mode',
    'generator',
    'generatedAt',
    'title',
    'sources',
    'transformations',
    'reductions',
    'data',
    'geography',
    'views',
  ])
    || manifest.schemaVersion !== '1'
    || (manifest.mode !== 'static' && manifest.mode !== 'interactive')
    || manifest.generator !== 'klopsi-agent-skill'
    || !isCanonicalTimestamp(manifest.generatedAt)
    || !isNonemptyString(manifest.title)
    || !Array.isArray(manifest.sources)
    || manifest.sources.length === 0
    || !manifest.sources.every(validSource)
    || !Array.isArray(manifest.transformations)
    || !manifest.transformations.every(isNonemptyString)
    || !Array.isArray(manifest.reductions)
    || !manifest.reductions.every(validReduction)
    || !isObject(manifest.data)
    || !isCount(manifest.data.originalRows)
    || !isCount(manifest.data.presentedRows)
    || !isCount(manifest.data.embeddedBytes)
    || manifest.data.originalRows < manifest.data.presentedRows
    || !Array.isArray(manifest.data.fields)
    || manifest.data.fields.length === 0
    || !manifest.data.fields.every(validField)
    || !validGeography(manifest.geography, manifest.data.fields)
    || !Array.isArray(manifest.views)) return false;
  return true;
}

function validView(view) {
  return isObject(view)
    && isNonemptyString(view.id)
    && isNonemptyString(view.question)
    && isNonemptyString(view.population)
    && isNonemptyString(view.unit)
    && isCount(view.recordCount)
    && isNonemptyString(view.takeaway);
}

function executableScriptBodies(html) {
  const bodies = [];
  const pattern = /<script\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    const closeStart = html.toLowerCase().indexOf('</script', pattern.lastIndex);
    if (closeStart < 0) break;
    const type = attributeValue(tag, 'type')?.toLowerCase();
    if (type !== 'application/json') bodies.push(html.slice(pattern.lastIndex, closeStart));
    const closeEnd = html.indexOf('>', closeStart);
    pattern.lastIndex = closeEnd < 0 ? html.length : closeEnd + 1;
  }
  return bodies;
}

function eventHandlerBodies(html) {
  const bodies = [];
  for (const tag of openingTags(html)) {
    const pattern = /\son[a-z][a-z0-9_-]*\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
    let match;
    while ((match = pattern.exec(tag)) !== null) bodies.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return bodies;
}

function hasRemoteResource(html) {
  const remote = /^(?:https?:)?\/\//iu;
  for (const tag of openingTags(html)) {
    const tagName = /^<([a-z][a-z0-9:-]*)/iu.exec(tag)?.[1]?.toLowerCase();
    for (const name of ['src', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href']) {
      const value = attributeValue(tag, name);
      if (value !== undefined && remote.test(value.trim())) return true;
    }
    if (tagName !== 'a') {
      const href = attributeValue(tag, 'href');
      if (href !== undefined && remote.test(href.trim())) return true;
    }
    const inlineStyle = attributeValue(tag, 'style');
    if (inlineStyle !== undefined && /url\s*\(\s*['"]?(?:https?:)?\/\//iu.test(inlineStyle)) return true;
  }
  const styleBodies = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map((match) => match[1] ?? '');
  return styleBodies.some((body) => /(?:url\s*\(\s*['"]?|@import\s+(?:url\s*\()?\s*['"]?)(?:https?:)?\/\//iu.test(body));
}

function hasUnsafeElement(html) {
  return openingTags(html).some((tag) => /^<\/?(?:iframe|object|embed)\b/iu.test(tag));
}

function hasMetaRefresh(html) {
  return openingTags(html).some((tag) =>
    /^<meta\b/iu.test(tag) && attributeValue(tag, 'http-equiv')?.trim().toLowerCase() === 'refresh');
}

function hasValidCsp(html) {
  const tag = openingTags(html).find((candidate) =>
    /^<meta\b/iu.test(candidate)
      && attributeValue(candidate, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (tag === undefined) return false;
  const content = attributeValue(tag, 'content');
  if (content === undefined) return false;
  const directives = new Map();
  for (const part of content.split(';')) {
    const tokens = part.trim().split(/\s+/u).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (name === undefined) continue;
    if (directives.has(name)) return false;
    directives.set(name, tokens.slice(1).map((token) => token.toLowerCase()));
  }
  for (const name of ['default-src', 'connect-src', 'object-src', 'base-uri', 'form-action']) {
    const values = directives.get(name);
    if (values === undefined || values.length !== 1 || values[0] !== "'none'") return false;
  }
  return true;
}

function hasTemplateMarker(html) {
  return /\{\{[A-Z0-9_ -]+\}\}|\[\[[A-Z0-9_ -]+\]\]|__[A-Z][A-Z0-9_ -]+__/u.test(html);
}

function output(result, exitCode, jsonRequested) {
  if (jsonRequested) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (result.findings.length > 0) {
    for (const item of result.findings) process.stderr.write(item.code + ': ' + item.message + '\n');
  }
  process.exitCode = exitCode;
}

function invalidInvocation(message, mode, jsonRequested) {
  const result = { valid: false, mode: mode ?? null, findings: [finding('INVALID_INVOCATION', message)] };
  output(result, 2, jsonRequested);
}

async function main() {
  const args = process.argv.slice(2);
  const jsonRequested = args.includes('--json');
  let inputPath;
  let mode;
  let invalid;
  let jsonSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      if (jsonSeen) {
        invalid = 'Duplicate argument: --json';
        break;
      }
      jsonSeen = true;
      continue;
    }
    if (argument === '--mode') {
      if (mode !== undefined) {
        invalid = 'Duplicate argument: --mode';
        break;
      }
      const value = args[index + 1];
      if (value !== 'static' && value !== 'interactive') {
        invalid = 'Expected --mode static or --mode interactive.';
        break;
      }
      mode = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('-') || inputPath !== undefined) {
      invalid = 'Unknown or duplicate argument: ' + argument;
      break;
    }
    inputPath = argument;
  }
  if (invalid !== undefined || inputPath === undefined || mode === undefined) {
    invalidInvocation(invalid ?? 'Usage: verify-dashboard.mjs <dashboard.html> --mode <static|interactive> [--json]', mode, jsonRequested);
    return;
  }

  let metadata;
  try {
    metadata = await stat(inputPath);
  } catch {
    invalidInvocation('Dashboard input does not exist or cannot be inspected.', mode, jsonRequested);
    return;
  }
  if (!metadata.isFile()) {
    invalidInvocation('Dashboard input must be a regular file.', mode, jsonRequested);
    return;
  }
  if (metadata.size > MAX_HTML_BYTES) {
    const findings = [finding('HTML_TOO_LARGE', 'Dashboard HTML exceeds the 15 MB file limit.')];
    output({ valid: false, mode, findings }, 1, jsonRequested);
    return;
  }

  let html;
  try {
    html = await readFile(inputPath, 'utf8');
  } catch {
    invalidInvocation('Dashboard input could not be read.', mode, jsonRequested);
    return;
  }

  const findings = [];
  const manifestBlocks = extractJsonScripts(html, 'klopsi-presentation-manifest');
  const manifestBlock = manifestBlocks[0] ?? { body: undefined };
  const parsedManifest = parseJsonBlock(manifestBlock);
  add(findings, manifestBlocks.length === 0, 'MANIFEST_MISSING', 'A presentation manifest JSON block is required.');
  add(findings, manifestBlocks.length > 1, 'MANIFEST_INVALID', 'Dashboards require exactly one presentation manifest JSON block.');
  add(findings, manifestBlocks.length > 0 && !parsedManifest.parsed, 'MANIFEST_INVALID', 'The presentation manifest must contain valid JSON.');
  add(findings, manifestBlocks.some((block) => block.body?.includes('<') === true), 'JSON_EMBEDDING_UNSAFE', 'JSON script bodies must escape every less-than character as \\u003c.');

  const manifest = parsedManifest.value;
  const manifestValid = parsedManifest.parsed && validManifest(manifest);
  add(findings, parsedManifest.parsed && !manifestValid, 'MANIFEST_INVALID', 'The presentation manifest does not match the required schema.');

  const manifestObject = isObject(manifest) ? manifest : undefined;
  const manifestData = manifestObject !== undefined && isObject(manifestObject.data)
    ? manifestObject.data
    : undefined;
  const manifestViews = manifestObject !== undefined && Array.isArray(manifestObject.views)
    ? manifestObject.views
    : undefined;
  const manifestReductions = manifestObject !== undefined && Array.isArray(manifestObject.reductions)
    ? manifestObject.reductions
    : undefined;
  if (manifestObject !== undefined) {
    add(findings, typeof manifestObject.mode === 'string' && manifestObject.mode !== mode, 'MODE_MISMATCH', 'The manifest mode does not match the expected presentation mode.');
    const minimumViews = 2;
    const maximumViews = mode === 'static' ? 6 : 4;
    add(findings, manifestViews === undefined || manifestViews.length < minimumViews || manifestViews.length > maximumViews || !manifestViews.every(validView), 'VIEW_METADATA_INVALID', 'Views must have the required count and complete analytical metadata.');
  }
  if (manifestData !== undefined) {
    add(findings, isCount(manifestData.embeddedBytes) && manifestData.embeddedBytes > MAX_DATA_BYTES, 'DATA_TOO_LARGE', 'Embedded presentation data exceeds the 5 MB limit.');
    add(findings, mode === 'interactive' && isCount(manifestData.presentedRows) && manifestData.presentedRows > MAX_INTERACTIVE_ROWS, 'ROW_LIMIT_EXCEEDED', 'Interactive presentation data exceeds 10,000 rows.');
    add(findings, isCount(manifestData.originalRows) && isCount(manifestData.presentedRows) && manifestData.originalRows > manifestData.presentedRows && (manifestReductions === undefined || manifestReductions.length === 0), 'REDUCTION_UNDISCLOSED', 'A row reduction requires at least one manifest reduction record.');
  }

  const dataBlocks = extractJsonScripts(html, 'klopsi-presentation-data');
  const dataBlock = dataBlocks[0] ?? { body: undefined };
  const parsedData = parseJsonBlock(dataBlock);
  add(findings, dataBlocks.some((block) => block.body?.includes('<') === true), 'JSON_EMBEDDING_UNSAFE', 'JSON script bodies must escape every less-than character as \\u003c.');
  add(findings, dataBlocks.some((block) => block.body !== undefined && Buffer.byteLength(block.body, 'utf8') > MAX_DATA_BYTES), 'DATA_TOO_LARGE', 'Embedded presentation data exceeds the 5 MB limit.');
  if (mode === 'interactive') {
    add(findings, dataBlocks.length !== 1, 'MANIFEST_INVALID', 'Interactive dashboards require exactly one presentation-data JSON block.');
    add(findings, dataBlocks.length > 0 && (!parsedData.parsed || !Array.isArray(parsedData.value)), 'MANIFEST_INVALID', 'Interactive dashboards require a valid presentation-data JSON array.');
    if (dataBlock.body !== undefined && parsedData.parsed && Array.isArray(parsedData.value)) {
      const embeddedBytes = Buffer.byteLength(dataBlock.body, 'utf8');
      add(findings, parsedData.value.length > MAX_INTERACTIVE_ROWS, 'ROW_LIMIT_EXCEEDED', 'Interactive presentation data exceeds 10,000 rows.');
      if (manifestData !== undefined) {
        add(findings, manifestData.embeddedBytes !== embeddedBytes || manifestData.presentedRows !== parsedData.value.length, 'MANIFEST_INVALID', 'Manifest data counts must exactly match the embedded presentation-data body.');
      }
    }
  } else if (manifestData !== undefined) {
    add(findings, manifestData.embeddedBytes !== 0 || dataBlocks.length > 0, 'MANIFEST_INVALID', 'Static dashboards must not embed a presentation-data block.');
  }

  add(findings, hasRemoteResource(html) || hasMetaRefresh(html), 'REMOTE_RESOURCE', 'Dashboards must not load remote resources when opened.');
  const executableScripts = executableScriptBodies(html);
  const eventHandlers = eventHandlerBodies(html);
  const executable = [...executableScripts, ...eventHandlers].join('\n');
  add(findings, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\.sendBeacon\s*\(|\bimport\s*\(/u.test(executable), 'NETWORK_API', 'Dashboard scripts must not use network APIs or dynamic imports.');
  add(findings, hasUnsafeElement(html) || /\beval\s*\(|\bnew\s+Function\s*\(/u.test(executable), 'UNSAFE_CODE', 'Dashboards must not use eval, new Function, iframe, object, or embed.');
  add(findings, !hasValidCsp(html), 'CSP_INVALID', 'The dashboard requires the offline Content Security Policy directives.');
  add(findings, !hasAttribute(html, 'data-klopsi-summary'), 'SUMMARY_MISSING', 'Dashboards require a visible plain-language summary.');
  add(findings, !hasAttribute(html, 'data-klopsi-disclosures'), 'DISCLOSURES_MISSING', 'Dashboards require visible transformation and reduction disclosures.');
  add(findings, !hasAttribute(html, 'data-klopsi-lineage'), 'LINEAGE_MISSING', 'Dashboards require visible source lineage and verification status.');
  add(findings, mode === 'static' && (executableScripts.length > 0 || eventHandlers.length > 0), 'STATIC_SCRIPT_FORBIDDEN', 'Static dashboards must not contain executable scripts.');
  add(findings, mode === 'interactive' && !hasAttribute(html, 'data-klopsi-filter-region'), 'FILTER_REGION_MISSING', 'Interactive dashboards require a labeled filter region.');
  add(findings, mode === 'interactive' && !hasAttribute(html, 'data-klopsi-record-count'), 'RECORD_COUNT_MISSING', 'Interactive dashboards require a visible matching-record count.');
  add(findings, mode === 'interactive' && !hasAttribute(html, 'data-klopsi-detail-table'), 'DETAIL_TABLE_MISSING', 'Interactive dashboards require a semantic detail table.');
  add(findings, mode === 'interactive' && !hasAttribute(html, 'data-klopsi-reset'), 'RESET_MISSING', 'Interactive dashboards require a reset control.');
  add(findings, mode === 'interactive' && !hasAttribute(html, 'data-klopsi-empty-state'), 'EMPTY_STATE_MISSING', 'Interactive dashboards require a visible empty-state region.');
  add(findings, mode === 'interactive' && !/<noscript\b[^>]*>[\s\S]*?\S[\s\S]*?<\/noscript\s*>/iu.test(html), 'NOSCRIPT_MISSING', 'Interactive dashboards require a useful noscript summary.');
  add(findings, hasTemplateMarker(html), 'TEMPLATE_MARKER_UNRESOLVED', 'Dashboard templates must not contain unresolved markers.');

  const boundedFindings = findings.slice(0, 100);
  const result = { valid: boundedFindings.length === 0, mode, findings: boundedFindings };
  output(result, result.valid ? 0 : 1, jsonRequested);
}

main().catch(() => {
  invalidInvocation('Dashboard verification failed before contract checks completed.', undefined, process.argv.includes('--json'));
});
`;

const RESOURCES = new Map<string, readonly AgentSkillResource[]>([
  [
    "klopsi-shared",
    [
      {
        path: "references/presentation-contract.md",
        content: PRESENTATION_CONTRACT,
      },
      {
        path: "scripts/verify-dashboard.mjs",
        content: DASHBOARD_VERIFIER_SOURCE,
      },
    ],
  ],
]);

export function resourcesForAgentSkill(name: string): readonly AgentSkillResource[] {
  return RESOURCES.get(name) ?? [];
}
