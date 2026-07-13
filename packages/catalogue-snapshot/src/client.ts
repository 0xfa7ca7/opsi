import { performance } from "node:perf_hooks";
import { OpsiError } from "@opsi/domain";
import {
  CATALOGUE_MAX_AGE_MS,
  CATALOGUE_MAX_MANIFEST_BYTES,
  CATALOGUE_MAX_SNAPSHOT_BYTES,
  assertSnapshotFresh,
  parseCatalogueManifest,
  parseCatalogueSnapshot,
  type CatalogueDataset,
  type CatalogueManifest,
} from "./contracts.js";
import { StrictHttpsReader } from "./remote.js";
import { snapshotInvalid, snapshotUnavailable } from "./errors.js";
import type { CatalogueSnapshotStore, StoredCatalogueSnapshot } from "./store.js";

const CATALOGUE_REMOTE_OPERATION_TIMEOUT_MS = 8_500;

export interface CatalogueListResult {
  readonly datasets: readonly CatalogueDataset[];
  readonly generatedAt: string;
  readonly source: "snapshot-cache" | "snapshot-remote";
}

export interface CatalogueSnapshotClientOptions {
  readonly store: CatalogueSnapshotStore;
  readonly reader?: Pick<StrictHttpsReader, "read">;
  readonly offline?: boolean;
  readonly now?: () => Date;
}

export interface CatalogueListOptions {
  readonly refresh?: boolean;
}

type CachedSnapshot =
  | { readonly state: "missing" | "invalid" }
  | {
      readonly state: "fresh";
      readonly value: StoredCatalogueSnapshot;
    }
  | {
      readonly state: "stale";
      readonly value: StoredCatalogueSnapshot;
      readonly error: OpsiError;
    };

export class CatalogueSnapshotClient {
  private readonly reader: Pick<StrictHttpsReader, "read">;
  private readonly offline: boolean;
  private readonly now: () => Date;

  constructor(private readonly options: CatalogueSnapshotClientOptions) {
    this.reader = options.reader ?? new StrictHttpsReader();
    this.offline = options.offline ?? false;
    this.now = options.now ?? (() => new Date());
  }

  async list(options: CatalogueListOptions = {}): Promise<CatalogueListResult> {
    const cached = await this.readCache();
    if (cached.state === "fresh" && (this.offline || options.refresh !== true)) {
      return cacheResult(cached.value);
    }
    if (this.offline) {
      if (cached.state === "stale") throw cached.error;
      throw snapshotUnavailable();
    }

    return this.options.store.withLock(async () => {
      const rechecked = await this.readCache();
      if (rechecked.state === "fresh" && options.refresh !== true) {
        return cacheResult(rechecked.value);
      }

      const remoteDeadline = performance.now() + CATALOGUE_REMOTE_OPERATION_TIMEOUT_MS;
      const manifest = await this.readManifest(remoteDeadline);
      const remoteNow = this.now();
      assertSnapshotFresh(manifest.generatedAt, remoteNow);

      if (
        (rechecked.state === "fresh" || rechecked.state === "stale") &&
        rechecked.value.manifest.sha256 === manifest.sha256
      ) {
        const snapshot = parseCatalogueSnapshot(rechecked.value.bytes, manifest);
        assertSnapshotFresh(snapshot.generatedAt, remoteNow);
        await this.options.store.write(
          manifest,
          rechecked.value.bytes,
          snapshotExpiresAt(manifest.generatedAt),
        );
        assertSnapshotFresh(snapshot.generatedAt, this.now());
        return remoteResult(snapshot.datasets, snapshot.generatedAt);
      }

      const bytes = await this.reader.read(
        manifest.snapshotPath,
        CATALOGUE_MAX_SNAPSHOT_BYTES,
        remainingRemoteTimeoutMs(remoteDeadline),
      );
      const snapshot = parseCatalogueSnapshot(bytes, manifest);
      const snapshotNow = this.now();
      assertSnapshotFresh(snapshot.generatedAt, snapshotNow);
      await this.options.store.write(manifest, bytes, snapshotExpiresAt(snapshot.generatedAt));
      assertSnapshotFresh(snapshot.generatedAt, this.now());
      return remoteResult(snapshot.datasets, snapshot.generatedAt);
    });
  }

  private async readCache(): Promise<CachedSnapshot> {
    let value: StoredCatalogueSnapshot | undefined;
    try {
      value = await this.options.store.read();
    } catch {
      return { state: "invalid" };
    }
    if (value === undefined) return { state: "missing" };

    try {
      assertSnapshotFresh(value.snapshot.generatedAt, this.now());
      return { state: "fresh", value };
    } catch (error) {
      if (error instanceof OpsiError && error.code === "CATALOGUE_SNAPSHOT_STALE") {
        return { state: "stale", value, error };
      }
      return { state: "invalid" };
    }
  }

  private async readManifest(remoteDeadline: number): Promise<CatalogueManifest> {
    const bytes = await this.reader.read(
      "v1/latest.json",
      CATALOGUE_MAX_MANIFEST_BYTES,
      remainingRemoteTimeoutMs(remoteDeadline),
    );
    if (bytes.byteLength > CATALOGUE_MAX_MANIFEST_BYTES) throw snapshotInvalid("bytes");

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw snapshotInvalid("manifest");
    }
    return parseCatalogueManifest(value);
  }
}

function cacheResult(value: StoredCatalogueSnapshot): CatalogueListResult {
  return {
    datasets: value.snapshot.datasets,
    generatedAt: value.snapshot.generatedAt,
    source: "snapshot-cache",
  };
}

function remoteResult(
  datasets: readonly CatalogueDataset[],
  generatedAt: string,
): CatalogueListResult {
  return { datasets, generatedAt, source: "snapshot-remote" };
}

function snapshotExpiresAt(generatedAt: string): string {
  return new Date(Date.parse(generatedAt) + CATALOGUE_MAX_AGE_MS).toISOString();
}

function remainingRemoteTimeoutMs(deadline: number): number {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw snapshotUnavailable();
  return remaining;
}
