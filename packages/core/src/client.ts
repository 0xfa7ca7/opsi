import type { SearchPage, SearchQuery } from "@opsi/domain";
import { DatasetCatalog, ProviderCatalog, ResourceCatalog } from "./catalog.js";
import { ProviderRegistry } from "./registry.js";
import { CacheService } from "./cache.js";
import { DownloadService, type DownloadServiceOptions } from "./downloads.js";
import { DerivedArtifactCache, type ContentCache, type DerivedArtifactPolicy } from "@opsi/storage";
import { DataEngine } from "@opsi/data-engine";
import { DataService } from "./data.js";
import { ConversionService } from "./conversions.js";
import { QueryService } from "./queries.js";
import { DuckDbQueryRunner } from "@opsi/data-engine";
import { QueryDatabaseCache } from "./query-database-cache.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WfsService } from "./wfs/service.js";

export interface OpsiClientOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
  readonly downloads?: Omit<DownloadServiceOptions, "registry" | "providerId">;
  readonly cache?: ContentCache;
  readonly duckdbCache?: DerivedArtifactPolicy;
  readonly cwd?: string;
  readonly queryWorkerPath?: string | URL;
}

function defaultQueryWorkerPath(): URL {
  const bundled = new URL("./query-worker.js", import.meta.url);
  return existsSync(fileURLToPath(bundled))
    ? bundled
    : new URL("../../data-engine/dist/query-worker.js", import.meta.url);
}

export class OpsiClient {
  readonly datasets: DatasetCatalog;
  readonly resources: ResourceCatalog;
  readonly providers: ProviderCatalog;
  readonly downloads?: DownloadService;
  readonly cache?: CacheService;
  readonly data: DataService;
  readonly conversions: ConversionService;
  readonly query: QueryService;
  readonly services: { readonly wfs: WfsService };
  private readonly registry: ProviderRegistry;
  private readonly providerId: string;

  constructor(options: OpsiClientOptions) {
    this.registry = options.registry;
    this.providerId = options.providerId;
    this.datasets = new DatasetCatalog(this.registry, this.providerId);
    this.resources = new ResourceCatalog(this.registry, this.providerId);
    this.providers = new ProviderCatalog(this.registry);
    this.data = new DataService(this, new DataEngine(), { cwd: options.cwd ?? process.cwd() });
    this.conversions = new ConversionService(this.data);
    const queryWorkerPath = options.queryWorkerPath ?? defaultQueryWorkerPath();
    const runner = new DuckDbQueryRunner({ workerPath: queryWorkerPath });
    const derived =
      options.cache === undefined || options.duckdbCache === undefined
        ? undefined
        : new DerivedArtifactCache(options.cache, options.duckdbCache);
    this.query = new QueryService(
      this.data,
      new QueryDatabaseCache({ runner, ...(derived === undefined ? {} : { derived }) }),
    );
    this.services = {
      wfs: new WfsService({
        registry: this.registry,
        providerId: this.providerId,
        ...(options.downloads?.downloader === undefined ? {} : { downloader: options.downloads.downloader }),
        limits: options.downloads?.limits ?? { maxBytes: 64 * 1024 * 1024, timeoutMs: 30_000 },
        offline: options.downloads?.offline ?? false,
      }),
    };
    if (options.downloads !== undefined)
      this.downloads = new DownloadService({
        ...options.downloads,
        registry: this.registry,
        providerId: this.providerId,
      });
    if (options.cache !== undefined) this.cache = new CacheService(options.cache, derived);
  }

  search(query: SearchQuery): Promise<SearchPage> {
    return this.registry.get(this.providerId).search(query);
  }
}
