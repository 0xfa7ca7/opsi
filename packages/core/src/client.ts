import type { SearchPage, SearchQuery } from "@opsi/domain";
import { DatasetCatalog, ProviderCatalog, ResourceCatalog } from "./catalog.js";
import { ProviderRegistry } from "./registry.js";
import { CacheService } from "./cache.js";
import { DownloadService, type DownloadServiceOptions } from "./downloads.js";
import type { ContentCache } from "@opsi/storage";
import { DataEngine } from "@opsi/data-engine";
import { DataService } from "./data.js";
import { ConversionService } from "./conversions.js";

export interface OpsiClientOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
  readonly downloads?: Omit<DownloadServiceOptions, "registry" | "providerId">;
  readonly cache?: ContentCache;
  readonly cwd?: string;
}

export class OpsiClient {
  readonly datasets: DatasetCatalog;
  readonly resources: ResourceCatalog;
  readonly providers: ProviderCatalog;
  readonly downloads?: DownloadService;
  readonly cache?: CacheService;
  readonly data: DataService;
  readonly conversions: ConversionService;
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
    if (options.downloads !== undefined)
      this.downloads = new DownloadService({
        ...options.downloads,
        registry: this.registry,
        providerId: this.providerId,
      });
    if (options.cache !== undefined) this.cache = new CacheService(options.cache);
  }

  search(query: SearchQuery): Promise<SearchPage> {
    return this.registry.get(this.providerId).search(query);
  }
}
