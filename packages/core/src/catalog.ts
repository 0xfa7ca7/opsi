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

  get(id: DatasetId, selectedProviderId: string = this.providerId): Promise<Dataset> {
    return this.registry.get(selectedProviderId).getDataset(id);
  }

  resources(
    id: DatasetId,
    selectedProviderId: string = this.providerId,
  ): Promise<readonly Resource[]> {
    return this.registry.get(selectedProviderId).listDatasetResources(id);
  }
}

export class ResourceCatalog {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly providerId: string,
  ) {}

  get(id: ResourceId, selectedProviderId: string = this.providerId): Promise<Resource> {
    return this.registry.get(selectedProviderId).getResource(id);
  }
}

export class ProviderCatalog {
  constructor(private readonly registry: ProviderRegistry) {}

  list(): readonly ProviderDescriptor[] {
    return this.registry.list();
  }
}
