import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import { CacheLock, ContentCache } from "@klopsi/storage";
import {
  parseCatalogueManifest,
  parseCatalogueSnapshot,
  type CatalogueManifest,
  type CatalogueSnapshot,
} from "./contracts.js";

export const CATALOGUE_SNAPSHOT_CACHE_KEY = "catalogue-snapshot:v1";
export const CATALOGUE_SNAPSHOT_CACHE_SCHEMA = "catalogue-snapshot-cache-v1";

export interface StoredCatalogueSnapshot {
  readonly manifest: CatalogueManifest;
  readonly snapshot: CatalogueSnapshot;
  readonly bytes: Uint8Array;
}

export interface CatalogueSnapshotStore {
  read(): Promise<StoredCatalogueSnapshot | undefined>;
  write(manifest: CatalogueManifest, bytes: Uint8Array, expiresAt: string): Promise<void>;
  withLock<T>(operation: () => Promise<T>): Promise<T>;
}

interface CatalogueSnapshotCacheMetadata {
  readonly manifest: CatalogueManifest;
}

export class ContentCacheCatalogueSnapshotStore implements CatalogueSnapshotStore {
  constructor(private readonly cache: ContentCache) {}

  async read(): Promise<StoredCatalogueSnapshot | undefined> {
    const record = await this.cache.getMetadataRecord<CatalogueSnapshotCacheMetadata>(
      CATALOGUE_SNAPSHOT_CACHE_KEY,
      CATALOGUE_SNAPSHOT_CACHE_SCHEMA,
      true,
    );
    if (record === undefined) return undefined;
    if (record.objectSha256 === undefined) throw corruptCache();

    const value = record.value as Partial<CatalogueSnapshotCacheMetadata>;
    if (
      typeof value !== "object" ||
      value === null ||
      Object.keys(value).length !== 1 ||
      value.manifest === undefined
    ) {
      throw corruptCache();
    }
    const manifest = parseCatalogueManifest(value.manifest);
    if (record.objectSha256 !== manifest.sha256) throw corruptCache();

    const object = await this.cache.getObject(record.objectSha256);
    if (object.bytes !== manifest.bytes) throw corruptCache();
    const handle = await open(object.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Uint8Array;
    try {
      const details = await handle.stat();
      if (!details.isFile() || details.size !== object.bytes) throw corruptCache();
      bytes = new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
    const snapshot = parseCatalogueSnapshot(bytes, manifest);
    return { manifest, snapshot, bytes };
  }

  async write(
    manifestValue: CatalogueManifest,
    bytes: Uint8Array,
    expiresAt: string,
  ): Promise<void> {
    const manifest = parseCatalogueManifest(manifestValue);
    parseCatalogueSnapshot(bytes, manifest);

    const metadata: CatalogueSnapshotCacheMetadata = { manifest };
    try {
      await this.cache.getObject(manifest.sha256);
    } catch (error) {
      if (!(error instanceof KlopsiError)) throw error;
      if (error.code === "CACHE_CORRUPT") {
        const layout = await this.cache.layout();
        await rm(layout.objectPath(manifest.sha256), { recursive: true, force: true });
      } else if (error.code !== "CACHE_MISS") {
        throw error;
      }
    }

    // Even when the object already exists, publish through ContentCache's
    // cache-publication lock so pruning cannot unlink it before metadata lands.
    await this.cache.putObjectWithMetadataExpiresAt(
      CATALOGUE_SNAPSHOT_CACHE_KEY,
      CATALOGUE_SNAPSHOT_CACHE_SCHEMA,
      Readable.from([bytes]),
      metadata,
      expiresAt,
    );
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = await CacheLock.acquire(
      (await this.cache.layout()).locks,
      CATALOGUE_SNAPSHOT_CACHE_KEY,
    );
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }
}

function corruptCache(): KlopsiError {
  return new KlopsiError({
    code: "CACHE_CORRUPT",
    message: "Cached catalogue snapshot metadata is invalid.",
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
  });
}
