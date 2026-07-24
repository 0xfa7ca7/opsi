import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { CacheLock } from "./cache-lock.js";
import { ContentCache, type MetadataRecord } from "./cache.js";

const SCHEMA_VERSION = "derived-duckdb-stage-v1";
const KEY_PREFIX = "derived:duckdb-stage:";
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SHA256 = /^[a-f\d]{64}$/u;

const formatSchema = z.enum(["csv", "tsv", "json", "ndjson", "xlsx", "parquet", "pcaxis"]);
const valueSchema = z.strictObject({
  kind: z.literal("duckdb-stage"),
  sourceSha256: z.string().regex(SHA256),
  format: formatSchema,
  sheet: z.string().min(1).optional(),
  stagingVersion: z.string().min(1),
  duckdbVersion: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
});

export interface DerivedArtifactIdentity {
  readonly kind: "duckdb-stage";
  readonly sourceSha256: string;
  readonly format: z.infer<typeof formatSchema>;
  readonly sheet?: string;
  readonly stagingVersion: string;
  readonly duckdbVersion: string;
}

export interface DerivedArtifactPolicy {
  readonly enabled: boolean;
  readonly maxBytes: number;
  readonly ttlMs: number;
}

export interface DerivedArtifactEntry extends DerivedArtifactIdentity {
  readonly key: string;
  readonly objectSha256: string;
  readonly bytes: number;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly expiresAt: string;
}

export interface DerivedArtifactHit {
  readonly path: string;
  readonly entry: DerivedArtifactEntry;
  readonly touched: boolean;
}

export interface DerivedArtifactPublication {
  readonly retained: boolean;
  readonly entry?: DerivedArtifactEntry;
}

export interface DerivedArtifactInfo {
  readonly objects: number;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly ttlMs: number;
}

export interface DerivedArtifactPruneResult {
  readonly expiredRemoved: number;
  readonly lruRemoved: number;
  readonly objectsRemoved: number;
}

export interface DerivedArtifactVerification {
  readonly entries: readonly DerivedArtifactEntry[];
  readonly errors: readonly string[];
}

interface DerivedArtifactValue extends DerivedArtifactIdentity {
  readonly bytes: number;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

function canonicalIdentity(identity: DerivedArtifactIdentity): string {
  return JSON.stringify([
    identity.kind,
    identity.sourceSha256,
    identity.format,
    identity.sheet ?? null,
    identity.stagingVersion,
    identity.duckdbVersion,
  ]);
}

function entryFromRecord(record: MetadataRecord): DerivedArtifactEntry {
  const value = valueSchema.parse(record.value) as DerivedArtifactValue;
  if (record.objectSha256 === undefined || record.expiresAt === undefined)
    throw new Error("Derived artifact metadata requires an object and expiration.");
  return {
    ...value,
    key: record.key,
    objectSha256: record.objectSha256,
    expiresAt: record.expiresAt,
  };
}

export class DerivedArtifactCache {
  constructor(
    private readonly cache: ContentCache,
    readonly policy: DerivedArtifactPolicy,
    private readonly options: { readonly now?: () => Date } = {},
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  key(identity: DerivedArtifactIdentity): string {
    const digest = createHash("sha256").update(canonicalIdentity(identity), "utf8").digest("hex");
    return `${KEY_PREFIX}${digest}`;
  }

  async withBuildLock<T>(
    identity: DerivedArtifactIdentity,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lock = await CacheLock.acquire((await this.cache.layout()).locks, this.key(identity));
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }

  private async record(identity: DerivedArtifactIdentity): Promise<MetadataRecord | undefined> {
    const record = await this.cache.getMetadataRecord(this.key(identity), SCHEMA_VERSION, true);
    if (record === undefined) return undefined;
    entryFromRecord(record);
    return record;
  }

  async materialize(
    identity: DerivedArtifactIdentity,
    destination: string,
  ): Promise<DerivedArtifactHit | undefined> {
    if (!this.policy.enabled || this.policy.maxBytes === 0) return undefined;
    const record = await this.record(identity);
    if (record === undefined || Date.parse(record.expiresAt ?? "") <= this.now().getTime())
      return undefined;
    let entry = entryFromRecord(record);
    const object = await this.cache.materializeLink(entry.objectSha256, destination);
    const now = this.now();
    const touched = now.getTime() - Date.parse(entry.lastUsedAt) >= TOUCH_INTERVAL_MS;
    if (touched) {
      const value: DerivedArtifactValue = {
        kind: entry.kind,
        sourceSha256: entry.sourceSha256,
        format: entry.format,
        ...(entry.sheet === undefined ? {} : { sheet: entry.sheet }),
        stagingVersion: entry.stagingVersion,
        duckdbVersion: entry.duckdbVersion,
        bytes: entry.bytes,
        createdAt: entry.createdAt,
        lastUsedAt: now.toISOString(),
      };
      const expiresAt = new Date(now.getTime() + this.policy.ttlMs).toISOString();
      await this.cache.putMetadataWithExpiresAt(
        entry.key,
        SCHEMA_VERSION,
        value,
        entry.objectSha256,
        expiresAt,
      );
      entry = { ...entry, lastUsedAt: value.lastUsedAt, expiresAt };
    }
    return { path: object.path, entry, touched };
  }

  async publish(
    identity: DerivedArtifactIdentity,
    databasePath: string,
  ): Promise<DerivedArtifactPublication> {
    if (!this.policy.enabled || this.policy.maxBytes === 0) return { retained: false };
    const details = await stat(databasePath);
    if (!details.isFile() || details.size > this.policy.maxBytes) return { retained: false };
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.policy.ttlMs).toISOString();
    const object = await this.cache.putObjectWithMetadataExpiresAt(
      this.key(identity),
      SCHEMA_VERSION,
      createReadStream(databasePath),
      (stored): DerivedArtifactValue => ({
        ...identity,
        bytes: stored.bytes,
        createdAt: now.toISOString(),
        lastUsedAt: now.toISOString(),
      }),
      expiresAt,
    );
    const entry: DerivedArtifactEntry = {
      ...identity,
      key: this.key(identity),
      objectSha256: object.sha256,
      bytes: object.bytes,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt,
    };
    await this.prune();
    return { retained: true, entry };
  }

  async list(): Promise<readonly DerivedArtifactEntry[]> {
    return (await this.cache.metadataRecords())
      .filter(
        (record) => record.schemaVersion === SCHEMA_VERSION && record.key.startsWith(KEY_PREFIX),
      )
      .map(entryFromRecord)
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async info(): Promise<DerivedArtifactInfo> {
    const entries = await this.list();
    const objects = new Map(entries.map((entry) => [entry.objectSha256, entry.bytes]));
    return {
      objects: objects.size,
      bytes: [...objects.values()].reduce((total, bytes) => total + bytes, 0),
      maxBytes: this.policy.maxBytes,
      ttlMs: this.policy.ttlMs,
    };
  }

  async prune(): Promise<DerivedArtifactPruneResult> {
    const now = this.now().getTime();
    const entries = [...(await this.list())];
    const expired = entries.filter((entry) => Date.parse(entry.expiresAt) <= now);
    for (const entry of expired) await this.cache.deleteMetadata(entry.key);
    const remaining = entries.filter((entry) => !expired.includes(entry));
    const references = new Map<string, number>();
    for (const entry of remaining)
      references.set(entry.objectSha256, (references.get(entry.objectSha256) ?? 0) + 1);
    const bytes = new Map(remaining.map((entry) => [entry.objectSha256, entry.bytes]));
    let total = [...bytes.values()].reduce((sum, value) => sum + value, 0);
    let lruRemoved = 0;
    const removedObjects = expired.map((entry) => entry.objectSha256);
    const lru = remaining.sort(
      (left, right) =>
        left.lastUsedAt.localeCompare(right.lastUsedAt) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.key.localeCompare(right.key),
    );
    for (const entry of lru) {
      if (total <= this.policy.maxBytes) break;
      await this.cache.deleteMetadata(entry.key);
      lruRemoved += 1;
      const count = (references.get(entry.objectSha256) ?? 1) - 1;
      references.set(entry.objectSha256, count);
      if (count === 0) {
        total -= bytes.get(entry.objectSha256) ?? 0;
        bytes.delete(entry.objectSha256);
        removedObjects.push(entry.objectSha256);
      }
    }
    const objectsRemoved = await this.cache.removeObjectsIfUnreferenced(removedObjects);
    return { expiredRemoved: expired.length, lruRemoved, objectsRemoved };
  }

  async verify(): Promise<DerivedArtifactVerification> {
    let entries: readonly DerivedArtifactEntry[];
    try {
      entries = await this.list();
    } catch {
      return { entries: [], errors: ["derived:metadata"] };
    }
    const errors: string[] = [];
    for (const entry of entries) {
      try {
        await this.cache.getObject(entry.objectSha256);
      } catch {
        errors.push(`derived:${entry.key}`);
      }
    }
    return { entries, errors };
  }
}
