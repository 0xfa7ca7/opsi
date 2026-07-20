import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { rm } from "node:fs/promises";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from "saxes";
import type { DataRow, ValidationIssue } from "./types.js";
import { detectTextEncoding } from "./text-decoding.js";

export interface XmlLimits {
  readonly maxDocumentBytes: number;
  readonly maxDepth: number;
  readonly maxAttributesPerElement: number;
  readonly maxValueBytes: number;
  readonly maxColumns: number;
  readonly maxRecords: number;
  readonly maxStateBytes: number;
}

export interface XmlDiscovery {
  readonly recordPath: string;
  readonly choices: readonly string[];
  readonly namespaces: Readonly<Record<string, string>>;
}

export interface XmlPreview {
  readonly format: "xml";
  readonly recordPath: string;
  readonly namespaces: Readonly<Record<string, string>>;
  readonly columns: readonly string[];
  readonly rows: readonly DataRow[];
  readonly returnedCount: number;
  readonly truncated: boolean;
  readonly warnings: readonly ValidationIssue[];
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  maxDocumentBytes: 64 * 1024 * 1024,
  maxDepth: 128,
  maxAttributesPerElement: 256,
  maxValueBytes: 1024 * 1024,
  maxColumns: 1_024,
  maxRecords: 100_000,
  maxStateBytes: 64 * 1024 * 1024,
};

const RECORD_PATH =
  /^\/(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*(?:\/(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*)*$/u;
type NamespaceOptions = {
  readonly xmlns: true;
  readonly position?: boolean;
  readonly fileName?: string;
};

function xmlError(error: unknown): OpsiError {
  return error instanceof OpsiError
    ? error
    : new OpsiError({
        code: "INVALID_XML_DATA",
        message: "The XML document is malformed or uses unsupported declarations.",
        exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        cause: error,
      });
}

async function parseXml(
  path: string,
  limits: XmlLimits,
  configure: (parser: SaxesParser<NamespaceOptions>) => void,
): Promise<void> {
  const parser = new SaxesParser<NamespaceOptions>({
    xmlns: true,
    position: true,
    fileName: path,
  });
  configure(parser);
  parser.on("doctype", () => {
    throw new OpsiError({
      code: "INVALID_XML_DATA",
      message: "DTD and entity declarations are not supported.",
      exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    });
  });
  parser.on("error", (error) => {
    throw error;
  });
  let bytes = 0;
  let decoder: InstanceType<typeof TextDecoder> | undefined;
  try {
    for await (const raw of createReadStream(path)) {
      const chunk = Buffer.from(raw as Uint8Array);
      bytes += chunk.length;
      if (bytes > limits.maxDocumentBytes)
        throw new OpsiError({
          code: "XML_LIMIT_EXCEEDED",
          message: "The XML document exceeds the byte limit.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
          context: { limit: limits.maxDocumentBytes },
        });
      decoder ??= new TextDecoder(detectTextEncoding(chunk), { fatal: true });
      parser.write(decoder.decode(chunk, { stream: true }));
    }
    if (decoder !== undefined) parser.write(decoder.decode());
    parser.close();
  } catch (error) {
    throw xmlError(error);
  }
}

export async function discoverXmlRecords(
  path: string,
  limits: XmlLimits = DEFAULT_XML_LIMITS,
): Promise<XmlDiscovery> {
  const stack: string[] = [];
  const counts = new Map<string, number>();
  const parents = new Set<string>();
  const namespaces: Record<string, string> = {};
  await parseXml(path, limits, (parser) => {
    parser.on("opentag", (tag: SaxesTagNS) => {
      if (stack.length + 1 > limits.maxDepth)
        throw new OpsiError({
          code: "XML_LIMIT_EXCEEDED",
          message: "The XML nesting depth exceeds the limit.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        });
      if (Object.keys(tag.attributes).length > limits.maxAttributesPerElement)
        throw new OpsiError({
          code: "XML_LIMIT_EXCEEDED",
          message: "An XML element has too many attributes.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        });
      if (stack.length > 0) parents.add(`/${stack.join("/")}`);
      stack.push(tag.name);
      const elementPath = `/${stack.join("/")}`;
      counts.set(elementPath, (counts.get(elementPath) ?? 0) + 1);
      for (const [prefix, uri] of Object.entries(tag.ns)) namespaces[prefix] = uri;
    });
    parser.on("closetag", () => {
      stack.pop();
    });
  });
  const repeated = [...counts.entries()]
    .filter(([candidate, count]) => count > 1 && parents.has(candidate))
    .sort(([left], [right]) => left.localeCompare(right));
  if (repeated.length === 0)
    throw new OpsiError({
      code: "XML_RECORD_PATH_REQUIRED",
      message: "No repeated XML record structure could be inferred.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      context: { choices: [] },
    });
  const bestCount = Math.max(...repeated.map(([, count]) => count));
  const choices = repeated
    .filter(([, count]) => count === bestCount)
    .map(([candidate]) => candidate);
  if (choices.length !== 1)
    throw new OpsiError({
      code: "XML_RECORD_PATH_REQUIRED",
      message: "Multiple repeated XML record structures are equally plausible.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      context: { choices },
    });
  return { recordPath: choices[0] as string, choices, namespaces };
}

function addValue(row: Record<string, unknown>, key: string, value: string): void {
  const current = row[key];
  if (current === undefined) row[key] = value;
  else if (Array.isArray(current)) current.push(value);
  else row[key] = [current, value];
}

export async function previewXml(
  path: string,
  options: { readonly limit?: number; readonly recordPath?: string } = {},
  limits: XmlLimits = DEFAULT_XML_LIMITS,
): Promise<XmlPreview> {
  const limit = options.limit ?? 20;
  const discovery =
    options.recordPath === undefined
      ? await discoverXmlRecords(path, limits)
      : { recordPath: options.recordPath, choices: [options.recordPath], namespaces: {} };
  if (!RECORD_PATH.test(discovery.recordPath))
    throw new OpsiError({
      code: "XML_RECORD_PATH_INVALID",
      message: "The XML record path must be an absolute slash-separated element path.",
      exitCode: EXIT_CODES.INVALID_INPUT,
    });
  const stack: Array<{ name: string; text: string; hasChild: boolean }> = [];
  const rows: Array<Record<string, unknown>> = [];
  const namespaces: Record<string, string> = { ...discovery.namespaces };
  let record: { readonly depth: number; readonly row: Record<string, unknown> } | undefined;
  let stateBytes = 0;
  await parseXml(path, limits, (parser) => {
    parser.on("opentag", (tag: SaxesTagNS) => {
      if (stack.length + 1 > limits.maxDepth)
        throw new OpsiError({
          code: "XML_LIMIT_EXCEEDED",
          message: "The XML nesting depth exceeds the limit.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        });
      if (Object.keys(tag.attributes).length > limits.maxAttributesPerElement)
        throw new OpsiError({
          code: "XML_LIMIT_EXCEEDED",
          message: "An XML element has too many attributes.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        });
      const parent = stack.at(-1);
      if (parent !== undefined) parent.hasChild = true;
      stack.push({ name: tag.name, text: "", hasChild: false });
      for (const [prefix, uri] of Object.entries(tag.ns)) namespaces[prefix] = uri;
      const currentPath = `/${stack.map((frame) => frame.name).join("/")}`;
      if (
        currentPath === discovery.recordPath &&
        rows.length <= Math.min(limit, limits.maxRecords)
      ) {
        const row: Record<string, unknown> = {};
        for (const attribute of Object.values(tag.attributes) as SaxesAttributeNS[])
          addValue(row, `@${attribute.name}`, attribute.value);
        record = { depth: stack.length, row };
      } else if (record !== undefined) {
        const relative = stack
          .slice(record.depth)
          .map((frame) => frame.name)
          .join("/");
        for (const attribute of Object.values(tag.attributes) as SaxesAttributeNS[])
          addValue(record.row, `${relative}/@${attribute.name}`, attribute.value);
      }
    });
    parser.on("text", (text) => {
      const frame = stack.at(-1);
      if (frame === undefined || record === undefined) return;
      frame.text += text;
      stateBytes += Buffer.byteLength(text);
      if (Buffer.byteLength(frame.text) > limits.maxValueBytes || stateBytes > limits.maxStateBytes)
        throw new OpsiError({
          code: "XML_LIMIT_EXCEEDED",
          message: "XML text state exceeds a configured limit.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        });
    });
    parser.on("closetag", () => {
      const frame = stack.at(-1);
      if (frame === undefined) return;
      if (record !== undefined && !frame.hasChild) {
        const relative = stack
          .slice(record.depth)
          .map((candidate) => candidate.name)
          .join("/");
        const value = frame.text.trim();
        if (relative.length > 0 && value.length > 0) addValue(record.row, relative, value);
      }
      if (record !== undefined && stack.length === record.depth) {
        if (Object.keys(record.row).length > limits.maxColumns)
          throw new OpsiError({
            code: "XML_LIMIT_EXCEEDED",
            message: "An XML record has too many columns.",
            exitCode: EXIT_CODES.INTEGRITY_FAILURE,
          });
        rows.push(record.row);
        record = undefined;
      }
      stack.pop();
    });
  });
  const returned = rows.slice(0, limit);
  const columns = [...new Set(returned.flatMap((row) => Object.keys(row)))];
  return {
    format: "xml",
    recordPath: discovery.recordPath,
    namespaces,
    columns,
    rows: returned,
    returnedCount: returned.length,
    truncated: rows.length > limit,
    warnings: [],
  };
}

export async function writeXmlRowsAsNdjson(
  path: string,
  output: string,
  options: { readonly recordPath?: string; readonly signal?: AbortSignal } = {},
  limits: XmlLimits = DEFAULT_XML_LIMITS,
): Promise<{
  readonly recordPath: string;
  readonly rows: number;
  readonly warnings: readonly ValidationIssue[];
}> {
  options.signal?.throwIfAborted();
  let descriptor: number | undefined;
  try {
    const preview = await previewXml(
      path,
      {
        limit: limits.maxRecords,
        ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
      },
      limits,
    );
    options.signal?.throwIfAborted();
    if (preview.truncated)
      throw new OpsiError({
        code: "XML_LIMIT_EXCEEDED",
        message: "The XML document exceeds the record limit.",
        exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        context: { limit: limits.maxRecords },
      });
    descriptor = openSync(output, "wx", 0o600);
    for (const row of preview.rows) {
      options.signal?.throwIfAborted();
      writeSync(descriptor, `${JSON.stringify(row)}\n`);
    }
    if (preview.rows.length === 0)
      throw new OpsiError({
        code: "EMPTY_TABULAR_INPUT",
        message: "The selected XML record path has no rows.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    return {
      recordPath: preview.recordPath,
      rows: preview.rows.length,
      warnings: preview.warnings,
    };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    descriptor = undefined;
    await rm(output, { force: true });
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
