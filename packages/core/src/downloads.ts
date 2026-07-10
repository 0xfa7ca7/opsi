import { join } from "node:path";
import { createReadStream } from "node:fs";
import { EXIT_CODES, OpsiError, type ResourceId } from "@opsi/domain";
import {
  Downloader,
  ProvenanceStore,
  filenameFromUrl,
  safeFilename,
  redactUrl,
  type ContentCache,
  type DownloadLimits,
  type DownloadResult,
  type ProbeResult,
} from "@opsi/storage";
import type { ProviderRegistry } from "./registry.js";

export interface ResourceDownloadOptions {
  readonly destination?: string;
  readonly force?: boolean;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
  readonly signal?: AbortSignal;
}
export interface DownloadServiceOptions {
  readonly registry: ProviderRegistry;
  readonly providerId: string;
  readonly downloader?: Downloader;
  readonly provenance?: ProvenanceStore;
  readonly cache?: ContentCache;
  readonly offline?: boolean;
  readonly downloadDir: string;
  readonly limits: DownloadLimits;
}
interface CachedDownload {
  readonly sha256: string;
  readonly bytes: number;
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
  readonly mediaType?: string;
}
export class DownloadService {
  private readonly downloader: Downloader;
  private readonly provenance: ProvenanceStore;
  constructor(private readonly options: DownloadServiceOptions) {
    this.downloader = options.downloader ?? new Downloader();
    this.provenance = options.provenance ?? new ProvenanceStore();
  }
  async resource(
    id: ResourceId,
    options: ResourceDownloadOptions = {},
  ): Promise<DownloadResult & { readonly provenancePath: string }> {
    const provider = this.options.registry.get(this.options.providerId);
    const resource = await provider.getResource(id);
    const resolved = await provider.resolveResource(resource);
    const destination =
      options.destination ??
      join(
        this.options.downloadDir,
        safeFilename(resolved.filename, filenameFromUrl(resolved.url, safeFilename(`${id}`))),
      );
    const cacheKey = `download:${resource.providerId}:${resource.id}`;
    let result: DownloadResult;
    if (this.options.offline) {
      const cached = await this.options.cache?.getMetadata<CachedDownload>(cacheKey, "download-v1");
      if (cached === undefined || this.options.cache === undefined)
        throw new OpsiError({
          code: "OFFLINE_CACHE_MISS",
          message: "Offline mode has no cached content for this resource.",
          exitCode: EXIT_CODES.NOT_FOUND,
          context: { resourceId: id },
        });
      const materialized = await this.options.cache.materialize(
        cached.sha256,
        destination,
        options.force ?? false,
      );
      result = {
        path: materialized.path,
        sha256: cached.sha256,
        bytes: cached.bytes,
        finalUrl: cached.finalUrl,
        redirectChain: cached.redirectChain,
        ...(cached.mediaType === undefined ? {} : { mediaType: cached.mediaType }),
      };
    } else {
      result = await this.downloader.download({
        url: resolved.url,
        destination,
        limits: this.options.limits,
        ...(options.force === undefined ? {} : { force: options.force }),
        ...(options.allowInsecureHttp === undefined
          ? {}
          : { allowInsecureHttp: options.allowInsecureHttp }),
        ...(options.allowPrivateNetwork === undefined
          ? {}
          : { allowPrivateNetwork: options.allowPrivateNetwork }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (this.options.cache !== undefined) {
        const object = await this.options.cache.putObject(createReadStream(result.path));
        if (object.sha256 !== result.sha256)
          throw new OpsiError({
            code: "CACHE_CORRUPT",
            message: "Cached download digest mismatch.",
            exitCode: EXIT_CODES.INTEGRITY_FAILURE,
          });
        const cached: CachedDownload = {
          sha256: result.sha256,
          bytes: result.bytes,
          finalUrl: redactUrl(result.finalUrl),
          redirectChain: result.redirectChain.map(redactUrl),
          ...(result.mediaType === undefined ? {} : { mediaType: result.mediaType }),
        };
        await this.options.cache.putMetadata(cacheKey, "download-v1", cached, result.sha256);
      }
    }
    const provenancePath = await this.provenance.write(result.path, {
      sourceUrl: resolved.url,
      finalUrl: result.finalUrl,
      redirectChain: result.redirectChain,
      retrievedAt: new Date().toISOString(),
      sha256: result.sha256,
      bytes: result.bytes,
      ...(result.mediaType === undefined ? {} : { mediaType: result.mediaType }),
      overrideFlags: {
        allowPrivateNetwork: options.allowPrivateNetwork ?? false,
        allowInsecureHttp: options.allowInsecureHttp ?? false,
      },
      providerId: `${resource.providerId}`,
      datasetId: `${resource.datasetId}`,
      resourceId: `${resource.id}`,
    });
    return { ...result, provenancePath };
  }
  async headers(
    id: ResourceId,
    options: Omit<ResourceDownloadOptions, "destination" | "force"> = {},
  ): Promise<ProbeResult> {
    if (this.options.offline)
      throw new OpsiError({
        code: "OFFLINE_CACHE_MISS",
        message: "Resource headers are unavailable in offline mode.",
        exitCode: EXIT_CODES.NOT_FOUND,
      });
    const provider = this.options.registry.get(this.options.providerId);
    const resolved = await provider.resolveResource(await provider.getResource(id));
    return this.downloader.probe({
      url: resolved.url,
      limits: this.options.limits,
      ...(options.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
      ...(options.allowPrivateNetwork === undefined
        ? {}
        : { allowPrivateNetwork: options.allowPrivateNetwork }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }
}
