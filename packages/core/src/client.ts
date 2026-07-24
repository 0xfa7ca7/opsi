import type { SearchPage, SearchQuery } from "@klopsi/domain";
import { DatasetCatalog, ProviderCatalog, ResourceCatalog } from "./catalog.js";
import { ProviderRegistry } from "./registry.js";
import { CacheService } from "./cache.js";
import { DownloadService, type DownloadServiceOptions } from "./downloads.js";
import {
  DerivedArtifactCache,
  type ContentCache,
  type DerivedArtifactPolicy,
} from "@klopsi/storage";
import {
  DataEngine,
  type ArchiveLimits,
  type DataEngineOptions,
  type PcAxisLimits,
  type XmlLimits,
} from "@klopsi/data-engine";
import { DataService } from "./data.js";
import { ConversionService } from "./conversions.js";
import { QueryService } from "./queries.js";
import { DuckDbQueryRunner } from "@klopsi/data-engine";
import { QueryDatabaseCache } from "./query-database-cache.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WfsService } from "./wfs/service.js";
import { ResourceAccessService } from "./access.js";

export interface KlopsiClientOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
  readonly downloads?: Omit<DownloadServiceOptions, "registry" | "providerId">;
  readonly cache?: ContentCache;
  readonly duckdbCache?: DerivedArtifactPolicy;
  readonly cwd?: string;
  readonly queryWorkerPath?: string | URL;
  readonly archiveLimits?: ArchiveLimits;
  readonly xmlLimits?: XmlLimits;
  readonly pcAxisLimits?: PcAxisLimits;
}

function defaultQueryWorkerPath(): URL {
  const bundled = new URL("./query-worker.js", import.meta.url);
  return existsSync(fileURLToPath(bundled))
    ? bundled
    : new URL("../../data-engine/dist/query-worker.js", import.meta.url);
}

export class KlopsiClient {
  readonly datasets: DatasetCatalog;
  readonly resources: ResourceCatalog;
  readonly providers: ProviderCatalog;
  readonly downloads?: DownloadService;
  readonly cache?: CacheService;
  readonly data: DataService;
  readonly conversions: ConversionService;
  readonly query: QueryService;
  readonly services: { readonly wfs: WfsService };
  readonly access: ResourceAccessService;
  private readonly registry: ProviderRegistry;
  private readonly providerId: string;

  constructor(options: KlopsiClientOptions) {
    this.registry = options.registry;
    this.providerId = options.providerId;
    this.datasets = new DatasetCatalog(this.registry, this.providerId);
    this.resources = new ResourceCatalog(this.registry, this.providerId);
    this.providers = new ProviderCatalog(this.registry);
    const dataEngineOptions: DataEngineOptions = {
      ...(options.xmlLimits === undefined ? {} : { xmlLimits: options.xmlLimits }),
      ...(options.pcAxisLimits === undefined ? {} : { pcAxisLimits: options.pcAxisLimits }),
    };
    this.data = new DataService(this, new DataEngine(dataEngineOptions), {
      cwd: options.cwd ?? process.cwd(),
      ...(options.archiveLimits === undefined ? {} : { archiveLimits: options.archiveLimits }),
    });
    this.conversions = new ConversionService(this.data);
    const queryWorkerPath = options.queryWorkerPath ?? defaultQueryWorkerPath();
    const runner = new DuckDbQueryRunner({ workerPath: queryWorkerPath });
    const derived =
      options.cache === undefined || options.duckdbCache === undefined
        ? undefined
        : new DerivedArtifactCache(options.cache, options.duckdbCache);
    this.query = new QueryService(
      this.data,
      new QueryDatabaseCache({
        runner,
        ...(derived === undefined ? {} : { derived }),
        ...(options.xmlLimits === undefined ? {} : { xmlLimits: options.xmlLimits }),
        ...(options.pcAxisLimits === undefined ? {} : { pcAxisLimits: options.pcAxisLimits }),
      }),
    );
    this.services = {
      wfs: new WfsService({
        registry: this.registry,
        providerId: this.providerId,
        ...(options.downloads?.downloader === undefined
          ? {}
          : { downloader: options.downloads.downloader }),
        limits: options.downloads?.limits ?? { maxBytes: 64 * 1024 * 1024, timeoutMs: 30_000 },
        offline: options.downloads?.offline ?? false,
      }),
    };
    this.access = new ResourceAccessService(this, this.registry, this.providerId, options.cwd);
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
