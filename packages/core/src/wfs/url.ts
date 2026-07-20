import { EXIT_CODES, OpsiError } from "@opsi/domain";
import type { WfsQuery } from "./types.js";

const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/u;
const OWNED = new Set(["service", "request", "version", "typenames", "typename", "count", "maxfeatures", "startindex", "propertyname", "outputformat", "resulttype", "bbox", "filter"]);

function invalid(message: string, context: Readonly<Record<string, unknown>> = {}): never {
  throw new OpsiError({ code: "WFS_URL_INVALID", message, exitCode: EXIT_CODES.INVALID_INPUT, context });
}

function positive(value: number | undefined, name: string, allowZero = false): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0))
    invalid(`${name} is outside its allowed range.`, { name, value });
}

function xml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function buildWfsUrl(base: string | URL, query: WfsQuery): URL {
  const url = new URL(base);
  if (url.username || url.password || url.hash) invalid("WFS URLs cannot contain credentials or fragments.");
  for (const key of [...url.searchParams.keys()]) if (OWNED.has(key.toLowerCase())) url.searchParams.delete(key);
  positive(query.limit, "limit");
  positive(query.startIndex, "startIndex", true);
  if (query.layer !== undefined && !NAME.test(query.layer)) invalid("The WFS layer name is invalid.", { layer: query.layer });
  for (const property of query.properties ?? []) if (!NAME.test(property)) invalid("A WFS property name is invalid.", { property });
  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", query.request);
  url.searchParams.set("version", query.version);
  if (query.request !== "GetCapabilities" && query.layer === undefined) invalid(`${query.request} requires a layer.`);
  if (query.layer !== undefined) url.searchParams.set(query.version === "2.0.0" ? "typeNames" : "typeName", query.layer);
  if (query.limit !== undefined) url.searchParams.set(query.version === "2.0.0" ? "count" : "maxFeatures", String(query.limit));
  if (query.startIndex !== undefined) url.searchParams.set("startIndex", String(query.startIndex));
  if ((query.properties?.length ?? 0) > 0) url.searchParams.set("propertyName", query.properties!.join(","));
  if (query.outputFormat !== undefined) url.searchParams.set("outputFormat", query.outputFormat);
  if (query.resultType !== undefined) url.searchParams.set("resultType", query.resultType);
  if (query.bbox !== undefined) {
    if (query.bbox.some((value) => !Number.isFinite(value))) invalid("WFS bbox coordinates must be finite.");
    url.searchParams.set("bbox", [...query.bbox, ...(query.crs === undefined ? [] : [query.crs])].join(","));
  }
  const filters = Object.entries(query.filters ?? {});
  if (filters.length > 0) {
    for (const [name] of filters) if (!NAME.test(name)) invalid("A WFS filter property is invalid.", { property: name });
    const predicates = filters.map(([name, value]) => `<fes:PropertyIsEqualTo><fes:ValueReference>${xml(name)}</fes:ValueReference><fes:Literal>${xml(value)}</fes:Literal></fes:PropertyIsEqualTo>`).join("");
    url.searchParams.set("filter", `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">${filters.length > 1 ? `<fes:And>${predicates}</fes:And>` : predicates}</fes:Filter>`);
  }
  return url;
}
