import {
  EXIT_CODES,
  OpsiError,
  providerId,
  type DataProvider,
  type Dataset,
  type DatasetId,
  type ProviderDescriptor,
  type ResolvedResource,
  type MetadataCache,
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

  private readonly metadataCache: MetadataCache | undefined;
  private readonly offline: boolean;
  private readonly metadataTtlMs: number;
  constructor(
    private readonly transport: OpsiTransport = new OpsiTransport(),
    options: {
      readonly metadataCache?: MetadataCache;
      readonly offline?: boolean;
      readonly metadataTtlMs?: number;
    } = {},
  ) {
    this.metadataCache = options.metadataCache;
    this.offline = options.offline ?? false;
    this.metadataTtlMs = options.metadataTtlMs ?? 24 * 60 * 60 * 1_000;
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const version = "opsi-metadata-v1";
    const cached = await this.metadataCache?.get<T>(key, version);
    if (cached !== undefined) return cached;
    if (this.offline)
      throw new OpsiError({
        code: "OFFLINE_CACHE_MISS",
        message: "Offline mode has no cached metadata for this request.",
        exitCode: EXIT_CODES.NOT_FOUND,
        context: { provider: "opsi", key },
      });
    const value = await load();
    await this.metadataCache?.set(key, version, value, this.metadataTtlMs);
    return value;
  }

  async search(query: SearchQuery): Promise<SearchPage> {
    const limit = query.limit ?? 10;
    const offset = query.offset ?? 0;
    const input = {
      q: query.text ?? "*:*",
      fq: filterQuery(query.filters),
      rows: limit,
      start: offset,
      facet: "true",
      "facet.field": [],
      "facet.mincount": 0,
      "facet.limit": 50,
      sort: sortQuery(query.sort),
    } as const;
    const result = await this.cached(`search:${JSON.stringify(input)}`, () =>
      this.transport.call("package_search", input),
    );
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
    return this.cached(`dataset:${id}`, async () =>
      mapOpsiDataset(await this.transport.call("package_show", { id, use_default_schema: false })),
    );
  }

  async getResource(id: ResourceId): Promise<Resource> {
    return this.cached(`resource:${id}`, async () =>
      mapOpsiResource(await this.transport.call("resource_show", { id })),
    );
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
