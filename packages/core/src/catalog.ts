import {
  type Dataset,
  type DatasetId,
  type ProviderDescriptor,
  type Resource,
  type ResourceId,
} from "@opsi/domain";
import type { ProviderRegistry } from "./registry.js";

export class DatasetCatalog {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly providerId: string,
  ) {}

  get(id: DatasetId): Promise<Dataset> {
    return this.registry.get(this.providerId).getDataset(id);
  }

  resources(id: DatasetId): Promise<readonly Resource[]> {
    return this.registry.get(this.providerId).listDatasetResources(id);
  }
}

export class ResourceCatalog {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly providerId: string,
  ) {}

  get(id: ResourceId): Promise<Resource> {
    return this.registry.get(this.providerId).getResource(id);
  }
}

export class ProviderCatalog {
  constructor(private readonly registry: ProviderRegistry) {}

  list(): readonly ProviderDescriptor[] {
    return this.registry.list();
  }
}
