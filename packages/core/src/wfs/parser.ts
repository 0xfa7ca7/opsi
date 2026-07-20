import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { SaxesParser, type SaxesTagNS } from "saxes";
import type { WfsCapabilities, WfsField, WfsLayer, WfsVersion } from "./types.js";

const DEFAULT_MAX = 8 * 1024 * 1024;
type Options = { readonly xmlns: true };

function parse(xml: string | Uint8Array, configure: (parser: SaxesParser<Options>) => void, maxBytes = DEFAULT_MAX): void {
  const text = typeof xml === "string" ? xml : new TextDecoder("utf-8", { fatal: true }).decode(xml);
  if (Buffer.byteLength(text) > maxBytes)
    throw new OpsiError({ code: "WFS_RESPONSE_TOO_LARGE", message: "The WFS XML response exceeds the byte limit.", exitCode: EXIT_CODES.INTEGRITY_FAILURE, context: { limit: maxBytes } });
  const parser = new SaxesParser<Options>({ xmlns: true });
  configure(parser);
  parser.on("doctype", () => { throw new Error("DTD declarations are forbidden"); });
  parser.on("error", (error) => { throw error; });
  try { parser.write(text).close(); } catch (error) {
    if (error instanceof OpsiError) throw error;
    throw new OpsiError({ code: "INVALID_WFS_RESPONSE", message: "The WFS service returned malformed or unsafe XML.", exitCode: EXIT_CODES.INTEGRITY_FAILURE, cause: error });
  }
}

export function parseWfsCapabilities(xml: string | Uint8Array, maxBytes = DEFAULT_MAX): WfsCapabilities {
  let version: WfsVersion | undefined;
  const stack: string[] = [];
  const operations = new Set<string>();
  const outputFormats = new Set<string>();
  const layers: WfsLayer[] = [];
  let current: { name?: string; title?: string; defaultCrs?: string; otherCrs: string[] } | undefined;
  let text = "";
  parse(xml, (parser) => {
    parser.on("opentag", (tag: SaxesTagNS) => {
      stack.push(tag.local); text = "";
      if (stack.length === 1) {
        const candidate = tag.attributes.version?.value;
        if (candidate === "2.0.0" || candidate === "1.1.0" || candidate === "1.0.0") version = candidate;
      }
      if (tag.local === "Operation") {
        const name = tag.attributes.name?.value;
        if (name !== undefined) operations.add(name);
      }
      if (tag.local === "FeatureType") current = { otherCrs: [] };
    });
    parser.on("text", (value) => { text += value; });
    parser.on("closetag", (tag) => {
      const value = text.trim();
      if (current !== undefined) {
        if (tag.local === "Name") current.name = value;
        else if (tag.local === "Title") current.title = value;
        else if (tag.local === "DefaultCRS" || tag.local === "DefaultSRS" || tag.local === "SRS") current.defaultCrs = value;
        else if (tag.local === "OtherCRS" || tag.local === "OtherSRS") current.otherCrs.push(value);
        else if (tag.local === "FeatureType") { if (current.name !== undefined) layers.push({ name: current.name, ...(current.title === undefined ? {} : { title: current.title }), ...(current.defaultCrs === undefined ? {} : { defaultCrs: current.defaultCrs }), otherCrs: current.otherCrs }); current = undefined; }
      }
      if ((tag.local === "Value" || tag.local === "Format") && stack.some((part) => part === "OutputFormats" || part === "Parameter") && value) outputFormats.add(value);
      stack.pop(); text = "";
    });
  }, maxBytes);
  if (version === undefined) throw new OpsiError({ code: "WFS_VERSION_UNSUPPORTED", message: "The WFS capabilities version is unsupported.", exitCode: EXIT_CODES.UNSUPPORTED });
  return { version, operations: [...operations], layers, outputFormats: [...outputFormats] };
}

export function parseWfsSchema(xml: string | Uint8Array, layer: string, maxBytes = DEFAULT_MAX): readonly WfsField[] {
  const fields: WfsField[] = [];
  let inSequence = 0;
  parse(xml, (parser) => {
    parser.on("opentag", (tag: SaxesTagNS) => {
      if (tag.local === "sequence") inSequence += 1;
      if (tag.local === "element" && inSequence > 0) {
        const name = tag.attributes.name?.value;
        const type = tag.attributes.type?.value;
        if (name !== undefined && type !== undefined) fields.push({ name, type, nullable: tag.attributes.minOccurs?.value === "0" || tag.attributes.nillable?.value === "true" });
      }
    });
    parser.on("closetag", (tag) => { if (tag.local === "sequence") inSequence -= 1; });
  }, maxBytes);
  if (fields.length === 0) throw new OpsiError({ code: "WFS_SCHEMA_EMPTY", message: `No fields were found for WFS layer '${layer}'.`, exitCode: EXIT_CODES.INTEGRITY_FAILURE });
  return fields;
}

export function parseWfsCount(xml: string | Uint8Array, maxBytes = DEFAULT_MAX): number {
  let count: number | undefined;
  parse(xml, (parser) => parser.on("opentag", (tag: SaxesTagNS) => {
    if (count !== undefined || tag.local !== "FeatureCollection") return;
    const raw = tag.attributes.numberMatched?.value ?? tag.attributes.numberOfFeatures?.value;
    if (raw !== undefined && /^\d+$/u.test(raw)) count = Number(raw);
  }), maxBytes);
  if (count === undefined || !Number.isSafeInteger(count)) throw new OpsiError({ code: "WFS_COUNT_INVALID", message: "The WFS count response is missing a valid count.", exitCode: EXIT_CODES.INTEGRITY_FAILURE });
  return count;
}

export function parseWfsException(xml: string | Uint8Array, maxBytes = DEFAULT_MAX): OpsiError | undefined {
  let serviceCode: string | undefined;
  let text = "";
  let exceptionText = "";
  parse(xml, (parser) => {
    parser.on("opentag", (tag: SaxesTagNS) => { if (tag.local === "Exception" || tag.local === "ServiceException") serviceCode = tag.attributes.exceptionCode?.value ?? tag.attributes.code?.value; text = ""; });
    parser.on("text", (value) => { text += value; });
    parser.on("closetag", (tag) => { if (tag.local === "ExceptionText" || tag.local === "ServiceException") exceptionText = text.trim().slice(0, 1024); });
  }, maxBytes);
  if (serviceCode === undefined && exceptionText === "") return undefined;
  return new OpsiError({ code: "SERVICE_EXCEPTION", message: exceptionText || "The WFS service rejected the request.", exitCode: EXIT_CODES.PROVIDER_FAILURE, context: { ...(serviceCode === undefined ? {} : { serviceCode }) } });
}
