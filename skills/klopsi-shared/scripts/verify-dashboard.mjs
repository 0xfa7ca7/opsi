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

function extractJsonScript(html, id) {
  const pattern = /<script\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    if (attributeValue(tag, 'id') !== id || attributeValue(tag, 'type')?.toLowerCase() !== 'application/json') continue;
    const closeStart = html.toLowerCase().indexOf('</script', pattern.lastIndex);
    if (closeStart < 0) return { found: true, body: undefined };
    const closeEnd = html.indexOf('>', closeStart);
    if (closeEnd < 0) return { found: true, body: undefined };
    return { found: true, body: html.slice(pattern.lastIndex, closeStart) };
  }
  return { found: false, body: undefined };
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

function validGeography(geography) {
  if (!isObject(geography)) return false;
  if (geography.kind === 'none') return geography.crs === null;
  if (geography.kind === 'coordinates') {
    return isNonemptyString(geography.crs)
      && isNonemptyString(geography.latitudeField)
      && isNonemptyString(geography.longitudeField);
  }
  if (geography.kind === 'geometry') {
    return isNonemptyString(geography.crs) && isNonemptyString(geography.geometryField);
  }
  return false;
}

function validManifest(manifest) {
  if (!isObject(manifest)) return false;
  if (manifest.schemaVersion !== '1'
    || (manifest.mode !== 'static' && manifest.mode !== 'interactive')
    || manifest.generator !== 'klopsi-agent-skill'
    || !isNonemptyString(manifest.generatedAt)
    || Number.isNaN(Date.parse(manifest.generatedAt))
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
    || !validGeography(manifest.geography)
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

function hasValidCsp(html) {
  const tag = openingTags(html).find((candidate) =>
    /^<meta\b/iu.test(candidate)
      && attributeValue(candidate, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (tag === undefined) return false;
  const content = attributeValue(tag, 'content');
  if (content === undefined) return false;
  const directives = new Map(content.split(';').map((part) => {
    const tokens = part.trim().split(/\s+/u).filter(Boolean);
    return [tokens[0]?.toLowerCase(), tokens.slice(1).map((token) => token.toLowerCase())];
  }).filter(([name]) => name !== undefined));
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
  const manifestBlock = extractJsonScript(html, 'klopsi-presentation-manifest');
  const parsedManifest = parseJsonBlock(manifestBlock);
  add(findings, !manifestBlock.found, 'MANIFEST_MISSING', 'A presentation manifest JSON block is required.');
  add(findings, manifestBlock.found && !parsedManifest.parsed, 'MANIFEST_INVALID', 'The presentation manifest must contain valid JSON.');
  add(findings, parsedManifest.unsafe, 'JSON_EMBEDDING_UNSAFE', 'JSON script bodies must escape every less-than character as \\u003c.');

  const manifest = parsedManifest.value;
  const manifestValid = parsedManifest.parsed && validManifest(manifest);
  add(findings, parsedManifest.parsed && !manifestValid, 'MANIFEST_INVALID', 'The presentation manifest does not match the required schema.');

  if (manifestValid) {
    add(findings, manifest.mode !== mode, 'MODE_MISMATCH', 'The manifest mode does not match the expected presentation mode.');
    const minimumViews = 2;
    const maximumViews = mode === 'static' ? 6 : 4;
    add(findings, manifest.views.length < minimumViews || manifest.views.length > maximumViews || !manifest.views.every(validView), 'VIEW_METADATA_INVALID', 'Views must have the required count and complete analytical metadata.');
    add(findings, manifest.data.embeddedBytes > MAX_DATA_BYTES, 'DATA_TOO_LARGE', 'Embedded presentation data exceeds the 5 MB limit.');
    add(findings, mode === 'interactive' && manifest.data.presentedRows > MAX_INTERACTIVE_ROWS, 'ROW_LIMIT_EXCEEDED', 'Interactive presentation data exceeds 10,000 rows.');
    add(findings, manifest.data.originalRows > manifest.data.presentedRows && manifest.reductions.length === 0, 'REDUCTION_UNDISCLOSED', 'A row reduction requires at least one manifest reduction record.');
  }

  const dataBlock = extractJsonScript(html, 'klopsi-presentation-data');
  const parsedData = parseJsonBlock(dataBlock);
  add(findings, dataBlock.found && parsedData.unsafe, 'JSON_EMBEDDING_UNSAFE', 'JSON script bodies must escape every less-than character as \\u003c.');
  if (mode === 'interactive') {
    add(findings, !dataBlock.found || !parsedData.parsed || !Array.isArray(parsedData.value), 'MANIFEST_INVALID', 'Interactive dashboards require a valid presentation-data JSON array.');
    if (dataBlock.body !== undefined && parsedData.parsed && Array.isArray(parsedData.value)) {
      const embeddedBytes = Buffer.byteLength(dataBlock.body, 'utf8');
      add(findings, embeddedBytes > MAX_DATA_BYTES, 'DATA_TOO_LARGE', 'Embedded presentation data exceeds the 5 MB limit.');
      add(findings, parsedData.value.length > MAX_INTERACTIVE_ROWS, 'ROW_LIMIT_EXCEEDED', 'Interactive presentation data exceeds 10,000 rows.');
      if (manifestValid) {
        add(findings, manifest.data.embeddedBytes !== embeddedBytes || manifest.data.presentedRows !== parsedData.value.length, 'MANIFEST_INVALID', 'Manifest data counts must exactly match the embedded presentation-data body.');
      }
    }
  } else if (manifestValid) {
    add(findings, manifest.data.embeddedBytes !== 0 || dataBlock.found, 'MANIFEST_INVALID', 'Static dashboards must not embed a presentation-data block.');
  }

  add(findings, hasRemoteResource(html), 'REMOTE_RESOURCE', 'Dashboards must not load remote resources when opened.');
  const executable = executableScriptBodies(html).join('\n');
  add(findings, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\.sendBeacon\s*\(|\bimport\s*\(/u.test(executable), 'NETWORK_API', 'Dashboard scripts must not use network APIs or dynamic imports.');
  add(findings, hasUnsafeElement(html) || /\beval\s*\(|\bnew\s+Function\s*\(/u.test(executable), 'UNSAFE_CODE', 'Dashboards must not use eval, new Function, iframe, object, or embed.');
  add(findings, !hasValidCsp(html), 'CSP_INVALID', 'The dashboard requires the offline Content Security Policy directives.');
  add(findings, !hasAttribute(html, 'data-klopsi-summary'), 'SUMMARY_MISSING', 'Dashboards require a visible plain-language summary.');
  add(findings, !hasAttribute(html, 'data-klopsi-disclosures'), 'DISCLOSURES_MISSING', 'Dashboards require visible transformation and reduction disclosures.');
  add(findings, !hasAttribute(html, 'data-klopsi-lineage'), 'LINEAGE_MISSING', 'Dashboards require visible source lineage and verification status.');
  add(findings, mode === 'static' && executableScriptBodies(html).length > 0, 'STATIC_SCRIPT_FORBIDDEN', 'Static dashboards must not contain executable scripts.');
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
