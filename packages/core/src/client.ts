import type { SearchPage, SearchQuery } from "@opsi/domain";
import { DatasetCatalog, ProviderCatalog, ResourceCatalog } from "./catalog.js";
import { ProviderRegistry } from "./registry.js";
import { CacheService } from "./cache.js";
import { DownloadService, type DownloadServiceOptions } from "./downloads.js";
import type { ContentCache } from "@opsi/storage";

export interface OpsiClientOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
  readonly downloads?: Omit<DownloadServiceOptions, "registry" | "providerId">;
  readonly cache?: ContentCache;
}

export class OpsiClient {
  readonly datasets: DatasetCatalog;
  readonly resources: ResourceCatalog;
  readonly providers: ProviderCatalog;
  readonly downloads?: DownloadService;
  readonly cache?: CacheService;
  private readonly registry: ProviderRegistry;
  private readonly providerId: string;

  constructor(options: OpsiClientOptions) {
    this.registry = options.registry;
    this.providerId = options.providerId;
    this.datasets = new DatasetCatalog(this.registry, this.providerId);
    this.resources = new ResourceCatalog(this.registry, this.providerId);
    this.providers = new ProviderCatalog(this.registry);
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
