import type { SearchPage, SearchQuery } from "@opsi/domain";
import { DatasetCatalog, ProviderCatalog, ResourceCatalog } from "./catalog.js";
import { ProviderRegistry } from "./registry.js";

export interface OpsiClientOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
}

export class OpsiClient {
  readonly datasets: DatasetCatalog;
  readonly resources: ResourceCatalog;
  readonly providers: ProviderCatalog;
  private readonly registry: ProviderRegistry;
  private readonly providerId: string;

  constructor(options: OpsiClientOptions) {
    this.registry = options.registry;
    this.providerId = options.providerId;
    this.datasets = new DatasetCatalog(this.registry, this.providerId);
    this.resources = new ResourceCatalog(this.registry, this.providerId);
    this.providers = new ProviderCatalog(this.registry);
  }

  search(query: SearchQuery): Promise<SearchPage> {
    return this.registry.get(this.providerId).search(query);
  }
}
