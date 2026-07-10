import {
  EXIT_CODES,
  OpsiError,
  providerId,
  type DataProvider,
  type Dataset,
  type DatasetId,
  type ProviderDescriptor,
  type ResolvedResource,
  type Resource,
  type ResourceId,
  type SearchFilters,
  type SearchPage,
  type SearchQuery,
  type SearchSort,
} from "@opsi/domain";
import { mapOpsiDataset, mapOpsiDatasetSummary } from "./map-dataset.js";
import { mapOpsiResource } from "./map-resource.js";
import { OpsiTransport } from "./transport.js";

const DEFAULT_SORT = "relevance asc, metadata_modified desc";
const SORT_FIELDS = new Set([
  "relevance",
  "metadata_created",
  "metadata_modified",
  "name",
  "title",
]);
const FILTER_FIELDS = new Set([
  "organization",
  "tags",
  "formats",
  "license",
  "modifiedAfter",
  "modifiedBefore",
]);
const SOLR_SPECIAL = /([+&|!(){}[\]^"~*?:\\/])/gu;

function unsupported(capability: string): OpsiError {
  return new OpsiError({
    code: "PROVIDER_CAPABILITY_UNSUPPORTED",
    message: `OPSI does not support ${capability}.`,
    exitCode: EXIT_CODES.UNSUPPORTED,
    context: { provider: "opsi", capability },
  });
}

function solrValue(value: string): string {
  return value.replace(SOLR_SPECIAL, "\\$1");
}

function quoted(field: string, value: string): string {
  return `${field}:"${solrValue(value)}"`;
}

function filterQuery(filters: SearchFilters | undefined): string {
  if (filters === undefined) return "";
  const unknown = Object.keys(filters).find((key) => !FILTER_FIELDS.has(key));
  if (unknown !== undefined) throw unsupported(`search filter '${unknown}'`);
  const clauses: string[] = [];
  if (filters.organization !== undefined)
    clauses.push(quoted("organization", filters.organization));
  for (const tag of filters.tags ?? []) clauses.push(quoted("tags", tag));
  for (const format of filters.formats ?? []) clauses.push(quoted("res_format", format));
  if (filters.license !== undefined) clauses.push(quoted("license_id", filters.license));
  if (filters.modifiedAfter !== undefined || filters.modifiedBefore !== undefined) {
    const after =
      filters.modifiedAfter === undefined ? "*" : `"${solrValue(filters.modifiedAfter)}"`;
    const before =
      filters.modifiedBefore === undefined ? "*" : `"${solrValue(filters.modifiedBefore)}"`;
    clauses.push(`metadata_modified:[${after} TO ${before}]`);
  }
  return clauses.join(" AND ");
}

function sortQuery(sort: readonly SearchSort[] | undefined): string {
  if (sort === undefined || sort.length === 0) return DEFAULT_SORT;
  for (const item of sort) {
    if (!SORT_FIELDS.has(item.field)) throw unsupported(`search sort '${item.field}'`);
  }
  return sort.map((item) => `${item.field} ${item.direction}`).join(", ");
}

export class OpsiProvider implements DataProvider {
  readonly descriptor: ProviderDescriptor = {
    id: providerId("opsi"),
    name: "OPSI",
    description: "Slovenian Open Data Portal",
    homepage: "https://podatki.gov.si/",
    capabilities: ["search", "dataset", "resource", "dataset-resources", "resolve-resource"],
  };

  constructor(private readonly transport: OpsiTransport = new OpsiTransport()) {}

  async search(query: SearchQuery): Promise<SearchPage> {
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;
    const result = await this.transport.call("package_search", {
      q: query.text ?? "*:*",
      fq: filterQuery(query.filters),
      rows: limit,
      start: offset,
      facet: "true",
      "facet.field": [],
      "facet.mincount": 0,
      "facet.limit": 50,
      sort: sortQuery(query.sort),
    });
    const nextOffset = offset + result.results.length;
    return {
      items: result.results.map(mapOpsiDatasetSummary),
      total: result.count,
      limit,
      offset,
      ...(nextOffset >= result.count ? {} : { nextOffset }),
    };
  }

  async getDataset(id: DatasetId): Promise<Dataset> {
    return mapOpsiDataset(
      await this.transport.call("package_show", { id, use_default_schema: false }),
    );
  }

  async getResource(id: ResourceId): Promise<Resource> {
    return mapOpsiResource(await this.transport.call("resource_show", { id }));
  }

  async listDatasetResources(id: DatasetId): Promise<readonly Resource[]> {
    return (await this.getDataset(id)).resources;
  }

  async resolveResource(resource: Resource): Promise<ResolvedResource> {
    const format = resource.format?.toLowerCase();
    const kind = format === "api" || format === "wms" || format === "wfs" ? "service" : "file";
    return {
      resource,
      kind,
      url: resource.url,
      ...(resource.reference === undefined ? {} : { reference: resource.reference }),
      ...(resource.format === undefined ? {} : { format: resource.format }),
      ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
    };
  }
}
