/* global Buffer, process */
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

function markupOnly(html) {
  return html
    .replace(/<!--[\s\S]*?-->/gu, (comment) => ' '.repeat(comment.length))
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/giu, (_match, opening, body, closing) => opening + ' '.repeat(body.length) + closing);
}

function extractJsonScripts(html, id) {
  const source = html.replace(/<!--[\s\S]*?-->/gu, (comment) => ' '.repeat(comment.length));
  const blocks = [];
  const pattern = /<script\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const tag = match[0];
    const matches = attributeValue(tag, 'id') === id;
    const type = attributeValue(tag, 'type')?.trim().toLowerCase();
    const closeStart = source.toLowerCase().indexOf('</script', pattern.lastIndex);
    if (closeStart < 0) {
      if (matches) blocks.push({ body: undefined, type });
      break;
    }
    const closeEnd = source.indexOf('>', closeStart);
    if (closeEnd < 0) {
      if (matches) blocks.push({ body: undefined, type });
      break;
    }
    if (matches) blocks.push({ body: source.slice(pattern.lastIndex, closeStart), type });
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
    && hasExactKeys(source, source.provenancePath === undefined
      ? ['identity', 'sha256', 'verified']
      : ['identity', 'sha256', 'verified', 'provenancePath'])
    && isNonemptyString(source.identity)
    && typeof source.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(source.sha256)
    && typeof source.verified === 'boolean'
    && (source.provenancePath === undefined || isNonemptyString(source.provenancePath));
}

function validField(field) {
  return isObject(field)
    && hasExactKeys(field, ['name', 'type', 'unit'])
    && isNonemptyString(field.name)
    && isNonemptyString(field.type)
    && (field.unit === null || isNonemptyString(field.unit));
}

function validReduction(reduction) {
  return isObject(reduction)
    && hasExactKeys(reduction, ['method', 'originalRows', 'presentedRows', 'groupingFields', 'exclusions', 'sampleBasis'])
    && isNonemptyString(reduction.method)
    && isCount(reduction.originalRows)
    && isCount(reduction.presentedRows)
    && Array.isArray(reduction.groupingFields)
    && reduction.groupingFields.every(isNonemptyString)
    && Array.isArray(reduction.exclusions)
    && reduction.exclusions.every(isNonemptyString)
    && (reduction.sampleBasis === null || isNonemptyString(reduction.sampleBasis))
    && reduction.originalRows > reduction.presentedRows;
}

function validGeography(geography, fields) {
  if (!isObject(geography)) return false;
  if (geography.kind === 'none') {
    return hasExactKeys(geography, ['kind', 'crs']) && geography.crs === null;
  }
  const fieldNames = new Set(fields.map((field) => field.name));
  if (geography.kind === 'coordinates') {
    return hasExactKeys(geography, ['kind', 'crs', 'latitudeField', 'longitudeField', 'validRecords', 'excludedRecords'])
      && geography.crs === 'EPSG:4326'
      && isNonemptyString(geography.latitudeField)
      && isNonemptyString(geography.longitudeField)
      && isCount(geography.validRecords)
      && isCount(geography.excludedRecords)
      && fieldNames.has(geography.latitudeField)
      && fieldNames.has(geography.longitudeField);
  }
  if (geography.kind === 'geometry') {
    return hasExactKeys(geography, ['kind', 'crs', 'geometryField', 'validRecords', 'excludedRecords'])
      && ['EPSG:4326', 'EPSG:3794', 'OGC:CRS84'].includes(geography.crs)
      && isNonemptyString(geography.geometryField)
      && isCount(geography.validRecords)
      && isCount(geography.excludedRecords)
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
    || !hasExactKeys(manifest.data, ['originalRows', 'presentedRows', 'embeddedBytes', 'fields'])
    || !isCount(manifest.data.originalRows)
    || !isCount(manifest.data.presentedRows)
    || !isCount(manifest.data.embeddedBytes)
    || manifest.data.originalRows < manifest.data.presentedRows
    || !Array.isArray(manifest.data.fields)
    || manifest.data.fields.length === 0
    || !manifest.data.fields.every(validField)
    || !validGeography(manifest.geography, manifest.data.fields)
    || !Array.isArray(manifest.views)
    || !manifest.views.every(validView)) return false;
  if (manifest.reductions.length === 0) {
    if (manifest.data.originalRows !== manifest.data.presentedRows) return false;
  } else {
    if (manifest.reductions[0].originalRows !== manifest.data.originalRows
      || manifest.reductions.at(-1).presentedRows !== manifest.data.presentedRows) return false;
    for (let index = 1; index < manifest.reductions.length; index += 1) {
      if (manifest.reductions[index - 1].presentedRows !== manifest.reductions[index].originalRows) return false;
    }
  }
  return true;
}

function validView(view) {
  return isObject(view)
    && hasExactKeys(view, ['id', 'question', 'population', 'unit', 'recordCount', 'takeaway'])
    && isNonemptyString(view.id)
    && isNonemptyString(view.question)
    && isNonemptyString(view.population)
    && isNonemptyString(view.unit)
    && isCount(view.recordCount)
    && isNonemptyString(view.takeaway);
}

function executableScriptBodies(html) {
  const source = html.replace(/<!--[\s\S]*?-->/gu, (comment) => ' '.repeat(comment.length));
  const bodies = [];
  const pattern = /<script\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const tag = match[0];
    const closeStart = source.toLowerCase().indexOf('</script', pattern.lastIndex);
    if (closeStart < 0) break;
    const type = attributeValue(tag, 'type')?.toLowerCase();
    if (type !== 'application/json') bodies.push(source.slice(pattern.lastIndex, closeStart));
    const closeEnd = source.indexOf('>', closeStart);
    pattern.lastIndex = closeEnd < 0 ? source.length : closeEnd + 1;
  }
  return bodies;
}

function eventHandlerBodies(html) {
  const bodies = [];
  for (const tag of openingTags(markupOnly(html))) {
    const pattern = /\son[a-z][a-z0-9_-]*(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?(?=\s|>)/giu;
    let match;
    while ((match = pattern.exec(tag)) !== null) bodies.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return bodies;
}

function isSafeEmbeddedData(value, tagName, attribute) {
  value = normalizedUrl(value);
  if (!/^data:/iu.test(value)) return false;
  if ((tagName === 'img' && attribute === 'src') || (tagName === 'image' && attribute === 'href') || attribute === 'poster') {
    return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  if (tagName === 'source' && attribute === 'src') {
    return /^data:(?:audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  if (tagName === 'audio' && attribute === 'src') {
    return /^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  if (tagName === 'video' && attribute === 'src') {
    return /^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/iu.test(value);
  }
  return false;
}

function hasActiveUrl(html) {
  const active = /^(?:javascript|vbscript):|^data:text\/(?:html|xml)|^data:application\/(?:xhtml\+xml|xml)/iu;
  for (const tag of openingTags(markupOnly(html))) {
    for (const name of ['href', 'src', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href']) {
      const value = attributeValue(tag, name);
      if (value !== undefined && active.test(normalizedUrl(value))) return true;
    }
  }
  const styleBodies = [...markupOnly(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map((match) => match[1] ?? '');
  return styleBodies.some((body) => [...body.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/giu)]
    .some((match) => active.test(normalizedUrl(match[2] ?? ''))));
}

function hasCompanionResource(html) {
  const markup = markupOnly(html);
  for (const tag of openingTags(markup)) {
    const tagName = /^<([a-z][a-z0-9:-]*)/iu.exec(tag)?.[1]?.toLowerCase();
    if (tagName === undefined) continue;
    for (const name of ['src', 'srcset', 'poster', 'data', 'action', 'formaction', 'background']) {
      const value = attributeValue(tag, name);
      if (value === undefined || normalizedUrl(value) === '') continue;
      if (isSafeEmbeddedData(value, tagName, name)) continue;
      return true;
    }
    if (tagName !== 'a') {
      const href = attributeValue(tag, 'href');
      if (href !== undefined && normalizedUrl(href) !== '' && !normalizedUrl(href).startsWith('#')
        && !isSafeEmbeddedData(href, tagName, 'href')) return true;
      const xlinkHref = attributeValue(tag, 'xlink:href');
      if (xlinkHref !== undefined && normalizedUrl(xlinkHref) !== '' && !normalizedUrl(xlinkHref).startsWith('#')) return true;
    }
    const inlineStyle = attributeValue(tag, 'style');
    if (inlineStyle !== undefined && hasUnsafeCssReference(inlineStyle)) return true;
  }
  const styleBodies = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/giu)].map((match) => match[1] ?? '');
  return styleBodies.some(hasUnsafeCssReference);
}

function hasUnsafeCssReference(css) {
  if (/@import\b/iu.test(css) || /\\(?:[0-9a-f]{1,6}\s?|.)/iu.test(css)) return true;
  for (const match of css.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/giu)) {
    const value = normalizedUrl(match[2] ?? '');
    if (value.startsWith('#')) continue;
    if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/iu.test(value)) continue;
    return true;
  }
  return false;
}

function normalizedUrl(value) {
  return value
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/giu, (_match, hexadecimal, decimal) => String.fromCodePoint(Number.parseInt(hexadecimal ?? decimal, hexadecimal === undefined ? 10 : 16)))
    .replace(/&(?:Tab|NewLine);/gu, '')
    .replace(/&colon;/giu, ':')
    .split('')
    .filter((character) => character.codePointAt(0) > 0x20)
    .join('')
    .trim();
}

function hasUnsafeElement(html) {
  return openingTags(markupOnly(html)).some((tag) => /^<(?:iframe|object|embed)\b/iu.test(tag));
}

function hasMetaRefresh(html) {
  return openingTags(markupOnly(html)).some((tag) =>
    /^<meta\b/iu.test(tag) && attributeValue(tag, 'http-equiv')?.trim().toLowerCase() === 'refresh');
}

function hasValidCsp(html, mode) {
  const tags = openingTags(markupOnly(html)).filter((candidate) =>
    /^<meta\b/iu.test(candidate)
      && attributeValue(candidate, 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (tags.length !== 1) return false;
  const tag = tags[0];
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
  const expected = new Map([
    ['default-src', ["'none'"]],
    ['connect-src', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
    ['img-src', ['data:']],
    ['style-src', ["'unsafe-inline'"]],
  ]);
  if (mode === 'interactive') expected.set('script-src', ["'unsafe-inline'"]);
  if (directives.size !== expected.size) return false;
  for (const [name, expectedValues] of expected) {
    const values = directives.get(name);
    if (values === undefined || values.length !== expectedValues.length
      || values.some((value, index) => value !== expectedValues[index])) return false;
  }
  return true;
}

function hasTemplateMarker(html) {
  const visibleMarkup = markupOnly(html).replace(/\/\*[\s\S]*?\*\//gu, (comment) => ' '.repeat(comment.length));
  return /\{\{[A-Z0-9_ -]+\}\}|\[\[[A-Z0-9_ -]+\]\]|__[A-Z][A-Z0-9_ -]+__/u.test(visibleMarkup);
}

function elementBlocks(html, selector) {
  const markup = markupOnly(html);
  const blocks = [];
  const pattern = /<([a-z][a-z0-9:-]*)\b[^>]*>/giu;
  let match;
  while ((match = pattern.exec(markup)) !== null) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    if (!selector(tagName, tag)) continue;
    const closing = new RegExp('<\\/' + tagName + '\\s*>', 'giu');
    closing.lastIndex = pattern.lastIndex;
    const close = closing.exec(markup);
    blocks.push({ tagName, tag, body: close === null ? '' : markup.slice(pattern.lastIndex, close.index) });
  }
  return blocks;
}

function isHiddenTag(tag) {
  return /\shidden(?:\s|=|>)/iu.test(tag)
    || attributeValue(tag, 'aria-hidden')?.trim().toLowerCase() === 'true'
    || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attributeValue(tag, 'style') ?? '');
}

function isUnavailableControl(tag) {
  return isHiddenTag(tag)
    || hasNamedAttribute(tag, 'disabled')
    || hasNamedAttribute(tag, 'inert')
    || attributeValue(tag, 'aria-disabled')?.trim().toLowerCase() === 'true'
    || attributeValue(tag, 'type')?.trim().toLowerCase() === 'hidden'
    || attributeValue(tag, 'tabindex')?.trim() === '-1';
}

function visibleText(body) {
  return body.replace(/<[^>]*>/gu, ' ').replace(/&(?:nbsp|#160|#x0*a0);/giu, ' ').trim();
}

function validVisibleRegion(html, attribute) {
  const blocks = elementBlocks(html, (_tagName, tag) => attributeValue(tag, attribute) !== undefined || new RegExp('\\s' + attribute + '(?=\\s|>)', 'iu').test(tag));
  return blocks.length === 1 && !isHiddenTag(blocks[0].tag) && visibleText(blocks[0].body).length > 0;
}

function validDocumentStructure(html) {
  const markup = markupOnly(html);
  const htmlTag = openingTags(markup).find((tag) => /^<html\b/iu.test(tag));
  const charset = openingTags(markup).some((tag) => /^<meta\b/iu.test(tag) && attributeValue(tag, 'charset')?.trim().toLowerCase() === 'utf-8');
  const viewport = openingTags(markup).some((tag) => /^<meta\b/iu.test(tag)
    && attributeValue(tag, 'name')?.trim().toLowerCase() === 'viewport'
    && /(?:^|,)\s*width\s*=\s*device-width(?:\s*,|$)/iu.test(attributeValue(tag, 'content') ?? '')
    && /(?:^|,)\s*initial-scale\s*=\s*1(?:\.0+)?(?:\s*,|$)/iu.test(attributeValue(tag, 'content') ?? ''));
  const head = elementBlocks(markup, (tagName) => tagName === 'head');
  const title = head.length === 1 ? elementBlocks(head[0].body, (tagName) => tagName === 'title') : [];
  const mains = elementBlocks(markup, (tagName) => tagName === 'main').filter((block) => !isHiddenTag(block.tag));
  const headings = elementBlocks(markup, (tagName) => tagName === 'h1').filter((block) => !isHiddenTag(block.tag) && visibleText(block.body).length > 0);
  return {
    doctype: /^\s*<!doctype\s+html\s*>/iu.test(markup),
    language: htmlTag !== undefined && isNonemptyString(attributeValue(htmlTag, 'lang')),
    charset,
    viewport,
    title: title.length === 1 && visibleText(title[0].body).length > 0,
    main: mains.length === 1,
    heading: headings.length === 1,
  };
}

function validInteractiveStructure(html) {
  const filter = elementBlocks(html, (_tagName, tag) => hasNamedAttribute(tag, 'data-klopsi-filter-region'));
  let filterValid = filter.length === 1 && !isHiddenTag(filter[0].tag)
    && (isNonemptyString(attributeValue(filter[0].tag, 'aria-label')) || isNonemptyString(attributeValue(filter[0].tag, 'aria-labelledby')));
  if (filterValid) {
    const controls = openingTags(filter[0].body).filter((tag) => /^<(?:input|select|textarea|button)\b/iu.test(tag));
    const customControls = openingTags(filter[0].body).some((tag) => /\srole\s*=\s*(?:"|')?(?:button|checkbox|combobox|listbox|radio|slider|spinbutton|textbox)/iu.test(tag));
    filterValid = controls.length > 0 && !customControls && controls.every((tag) => {
      if (isUnavailableControl(tag)) return false;
      if (/^<button\b/iu.test(tag)) return isNonemptyString(attributeValue(tag, 'aria-label')) || /<button\b[^>]*>[\s\S]*?\S[\s\S]*?<\/button>/iu.test(filter[0].body);
      const id = attributeValue(tag, 'id');
      return isNonemptyString(attributeValue(tag, 'aria-label'))
        || isNonemptyString(attributeValue(tag, 'aria-labelledby'))
        || (isNonemptyString(id) && elementBlocks(filter[0].body, (tagName, labelTag) => tagName === 'label' && attributeValue(labelTag, 'for') === id)
          .some((label) => visibleText(label.body).length > 0));
    });
  }
  const reset = elementBlocks(html, (tagName, tag) => tagName === 'button' && hasNamedAttribute(tag, 'data-klopsi-reset'));
  const count = elementBlocks(html, (_tagName, tag) => hasNamedAttribute(tag, 'data-klopsi-record-count'));
  const table = elementBlocks(html, (tagName, tag) => tagName === 'table' && hasNamedAttribute(tag, 'data-klopsi-detail-table'));
  const empty = elementBlocks(html, (_tagName, tag) => hasNamedAttribute(tag, 'data-klopsi-empty-state'));
  const noscript = elementBlocks(html, (tagName) => tagName === 'noscript');
  return {
    filter: filterValid,
    reset: reset.length === 1 && !isUnavailableControl(reset[0].tag) && visibleText(reset[0].body).length > 0 && attributeValue(reset[0].tag, 'type')?.toLowerCase() === 'button',
    count: count.length === 1 && !isHiddenTag(count[0].tag) && attributeValue(count[0].tag, 'aria-live')?.toLowerCase() === 'polite' && visibleText(count[0].body).length > 0,
    table: table.length === 1 && /<thead\b[^>]*>[\s\S]*<th\b[^>]*>[\s\S]*<\/thead>/iu.test(table[0].body),
    empty: empty.length === 1 && visibleText(empty[0].body).length > 0,
    noscript: noscript.length === 1 && visibleText(noscript[0].body).length > 0,
  };
}

function hasNamedAttribute(tag, name) {
  return attributeValue(tag, name) !== undefined || new RegExp('\\s' + name + '(?=\\s|>)', 'iu').test(tag);
}

function hasAccessibleSvgs(html) {
  return elementBlocks(html, (tagName) => tagName === 'svg').every((svg) => {
    const labels = (attributeValue(svg.tag, 'aria-labelledby') ?? '').trim().split(/\s+/u);
    const titles = elementBlocks(svg.body, (tagName) => tagName === 'title')
      .filter((title) => visibleText(title.body).length > 0);
    const descriptions = elementBlocks(svg.body, (tagName) => tagName === 'desc')
      .filter((description) => visibleText(description.body).length > 0);
    const titleId = titles.length === 1 ? attributeValue(titles[0].tag, 'id') : undefined;
    const descriptionId = descriptions.length === 1 ? attributeValue(descriptions[0].tag, 'id') : undefined;
    return attributeValue(svg.tag, 'role')?.toLowerCase() === 'img'
      && titleId !== undefined && descriptionId !== undefined
      && labels.includes(titleId) && labels.includes(descriptionId);
  });
}

function validPosition(value, crs) {
  if (!Array.isArray(value) || value.length < 2 || !value.every(Number.isFinite)) return false;
  if (crs === 'EPSG:4326' || crs === 'OGC:CRS84') {
    return value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
  }
  return true;
}

function equalPosition(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validLineString(value, crs) {
  return Array.isArray(value) && value.length >= 2 && value.every((position) => validPosition(position, crs));
}

function validLinearRing(value, crs) {
  return Array.isArray(value) && value.length >= 4
    && value.every((position) => validPosition(position, crs))
    && equalPosition(value[0], value.at(-1));
}

function validGeometry(value, crs) {
  if (!isObject(value) || !isNonemptyString(value.type)) return false;
  if (value.type === 'GeometryCollection') {
    return hasExactKeys(value, ['type', 'geometries'])
      && Array.isArray(value.geometries)
      && value.geometries.every((geometry) => validGeometry(geometry, crs));
  }
  if (!hasExactKeys(value, ['type', 'coordinates'])) return false;
  if (value.type === 'Point') return validPosition(value.coordinates, crs);
  if (value.type === 'MultiPoint') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((position) => validPosition(position, crs));
  if (value.type === 'LineString') return validLineString(value.coordinates, crs);
  if (value.type === 'MultiLineString') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((line) => validLineString(line, crs));
  if (value.type === 'Polygon') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((ring) => validLinearRing(ring, crs));
  if (value.type === 'MultiPolygon') return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) => validLinearRing(ring, crs)));
  return false;
}

function validSpatialRows(manifest, rows) {
  const geography = manifest.geography;
  if (geography.kind === 'none') return true;
  if (!Array.isArray(rows) || geography.validRecords !== rows.length) return false;
  if (geography.excludedRecords > 0) {
    const disclosed = manifest.reductions
      .filter((reduction) => reduction.exclusions.length > 0)
      .reduce((total, reduction) => total + reduction.originalRows - reduction.presentedRows, 0);
    if (disclosed !== geography.excludedRecords) return false;
  }
  if (geography.kind === 'coordinates') {
    return rows.every((row) => isObject(row)
      && Number.isFinite(row[geography.latitudeField])
      && Number.isFinite(row[geography.longitudeField])
      && row[geography.latitudeField] >= -90 && row[geography.latitudeField] <= 90
      && row[geography.longitudeField] >= -180 && row[geography.longitudeField] <= 180);
  }
  return rows.every((row) => isObject(row) && validGeometry(row[geography.geometryField], geography.crs));
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
  const manifestBlock = manifestBlocks.find((block) => block.type === 'application/json')
    ?? manifestBlocks[0]
    ?? { body: undefined, type: undefined };
  const parsedManifest = parseJsonBlock(manifestBlock);
  add(findings, manifestBlocks.length === 0, 'MANIFEST_MISSING', 'A presentation manifest JSON block is required.');
  add(findings, manifestBlocks.length > 0 && (manifestBlocks.length !== 1 || manifestBlocks[0].type !== 'application/json'), 'MANIFEST_INVALID', 'Dashboards require exactly one presentation manifest script with type="application/json".');
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
  const dataBlock = dataBlocks.find((block) => block.type === 'application/json')
    ?? dataBlocks[0]
    ?? { body: undefined, type: undefined };
  const parsedData = parseJsonBlock(dataBlock);
  add(findings, dataBlocks.some((block) => block.body?.includes('<') === true), 'JSON_EMBEDDING_UNSAFE', 'JSON script bodies must escape every less-than character as \\u003c.');
  add(findings, dataBlocks.some((block) => block.body !== undefined && Buffer.byteLength(block.body, 'utf8') > MAX_DATA_BYTES), 'DATA_TOO_LARGE', 'Embedded presentation data exceeds the 5 MB limit.');
  const spatialMode = manifestObject !== undefined
    && isObject(manifestObject.geography)
    && (manifestObject.geography.kind === 'coordinates' || manifestObject.geography.kind === 'geometry');
  if (mode === 'interactive' || spatialMode) {
    add(findings, dataBlocks.length !== 1 || dataBlocks[0].type !== 'application/json', 'MANIFEST_INVALID', 'Interactive and spatial static dashboards require exactly one presentation-data script with type="application/json".');
    add(findings, dataBlocks.length > 0 && (!parsedData.parsed || !Array.isArray(parsedData.value)), 'MANIFEST_INVALID', 'Presentation-data must be a valid JSON array.');
    if (dataBlock.body !== undefined && parsedData.parsed && Array.isArray(parsedData.value)) {
      const embeddedBytes = Buffer.byteLength(dataBlock.body, 'utf8');
      add(findings, mode === 'interactive' && parsedData.value.length > MAX_INTERACTIVE_ROWS, 'ROW_LIMIT_EXCEEDED', 'Interactive presentation data exceeds 10,000 rows.');
      if (manifestData !== undefined) {
        add(findings, manifestData.embeddedBytes !== embeddedBytes || manifestData.presentedRows !== parsedData.value.length, 'MANIFEST_INVALID', 'Manifest data counts must exactly match the embedded presentation-data body.');
      }
      if (manifestValid && manifestObject !== undefined && spatialMode) {
        add(findings, !validSpatialRows(manifestObject, parsedData.value), 'MANIFEST_INVALID', 'Spatial presentation rows must match declared fields, CRS ranges, geometry structure, and exclusion disclosures.');
      }
    }
  } else if (manifestData !== undefined) {
    add(findings, manifestData.embeddedBytes !== 0 || dataBlocks.length > 0, 'MANIFEST_INVALID', 'Static dashboards must not embed a presentation-data block.');
  }

  const structure = validDocumentStructure(html);
  add(findings, !structure.doctype, 'DOCTYPE_MISSING', 'Dashboards require an HTML doctype.');
  add(findings, !structure.language, 'LANGUAGE_MISSING', 'Dashboards require a nonempty document language.');
  add(findings, !structure.charset, 'CHARSET_MISSING', 'Dashboards require a UTF-8 charset declaration.');
  add(findings, !structure.viewport, 'VIEWPORT_MISSING', 'Dashboards require a responsive device-width viewport.');
  add(findings, !structure.title, 'TITLE_MISSING', 'Dashboards require one nonempty document title.');
  add(findings, !structure.main, 'MAIN_INVALID', 'Dashboards require exactly one nonhidden main landmark.');
  add(findings, !structure.heading, 'HEADING_INVALID', 'Dashboards require exactly one nonhidden, nonempty level-one heading.');
  add(findings, hasCompanionResource(html) || hasMetaRefresh(html), 'REMOTE_RESOURCE', 'Dashboards must not load companion or remote resources when opened.');
  const executableScripts = executableScriptBodies(html);
  const eventHandlers = eventHandlerBodies(html);
  const executable = [...executableScripts, ...eventHandlers].join('\n');
  add(findings, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\.sendBeacon\s*\(|\bimport\s*\(/u.test(executable), 'NETWORK_API', 'Dashboard scripts must not use network APIs or dynamic imports.');
  const htmlProducingAssignment = /(?:\.\s*(?:innerHTML|outerHTML|srcdoc)|\[\s*(['"])(?:innerHTML|outerHTML|srcdoc)\1\s*\])\s*(?:\?\?=|\|\|=|&&=|\*\*=|>>>=|<<=|>>=|[+\-*/%&|^]=|=(?!=))/u;
  add(findings, eventHandlers.length > 0
    || hasUnsafeElement(html)
    || hasActiveUrl(html)
    || htmlProducingAssignment.test(executable)
    || /(?:javascript|vbscript):|data:text\/(?:html|xml)|\beval\s*\(|\bnew\s+Function\s*\(|(?:\?\.|\.)\s*(?:insertAdjacentHTML|setHTMLUnsafe|createContextualFragment|createHTMLDocument|parseHTMLUnsafe)\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(|\bDOMParser\b/u.test(executable), 'UNSAFE_CODE', 'Dashboards must not use executable URL schemes, HTML parsing or injection sinks, inline handlers, dynamic code, frames, objects, or embeds.');
  add(findings, !hasValidCsp(html, mode), 'CSP_INVALID', 'The dashboard requires the mode-constrained offline Content Security Policy directives.');
  add(findings, !validVisibleRegion(html, 'data-klopsi-summary'), 'SUMMARY_MISSING', 'Dashboards require one visible nonempty plain-language summary.');
  add(findings, !validVisibleRegion(html, 'data-klopsi-disclosures'), 'DISCLOSURES_MISSING', 'Dashboards require one visible nonempty transformation and reduction disclosure region.');
  add(findings, !validVisibleRegion(html, 'data-klopsi-lineage'), 'LINEAGE_MISSING', 'Dashboards require one visible nonempty source lineage and verification region.');
  add(findings, !hasAccessibleSvgs(html), 'SVG_ACCESSIBILITY_INVALID', 'Every SVG requires a role, title, description, and matching accessible references.');
  add(findings, mode === 'static' && (executableScripts.length > 0 || eventHandlers.length > 0), 'STATIC_SCRIPT_FORBIDDEN', 'Static dashboards must not contain executable scripts.');
  const interactiveStructure = mode === 'interactive' ? validInteractiveStructure(html) : undefined;
  add(findings, mode === 'interactive' && !interactiveStructure.filter, 'FILTER_REGION_MISSING', 'Interactive dashboards require a labeled region containing labeled native controls.');
  add(findings, mode === 'interactive' && !interactiveStructure.count, 'RECORD_COUNT_MISSING', 'Interactive dashboards require a visible polite live matching-record count.');
  add(findings, mode === 'interactive' && !interactiveStructure.table, 'DETAIL_TABLE_MISSING', 'Interactive dashboards require a semantic detail table with a header group and headers.');
  add(findings, mode === 'interactive' && !interactiveStructure.reset, 'RESET_MISSING', 'Interactive dashboards require a visible native reset button.');
  add(findings, mode === 'interactive' && !interactiveStructure.empty, 'EMPTY_STATE_MISSING', 'Interactive dashboards require a useful nonempty empty-state region.');
  add(findings, mode === 'interactive' && !interactiveStructure.noscript, 'NOSCRIPT_MISSING', 'Interactive dashboards require a useful noscript summary.');
  add(findings, hasTemplateMarker(html), 'TEMPLATE_MARKER_UNRESOLVED', 'Dashboard templates must not contain unresolved markers.');

  const boundedFindings = findings.slice(0, 100);
  const result = { valid: boundedFindings.length === 0, mode, findings: boundedFindings };
  output(result, result.valid ? 0 : 1, jsonRequested);
}

main().catch(() => {
  invalidInvocation('Dashboard verification failed before contract checks completed.', undefined, process.argv.includes('--json'));
});
