import { verifyStagedDatabase } from "@klopsi/data-engine";
import type { ContentCache, DerivedArtifactCache } from "@klopsi/storage";
export class CacheService {
  constructor(
    private readonly cache: ContentCache,
    private readonly derived?: DerivedArtifactCache,
  ) {}
  async info() {
    const [raw, derived] = await Promise.all([
      this.cache.info(),
      this.derived?.info() ?? Promise.resolve({ objects: 0, bytes: 0, maxBytes: 0, ttlMs: 0 }),
    ]);
    return { ...raw, derived };
  }
  async list() {
    const [objects, derived] = await Promise.all([
      this.cache.list(),
      this.derived?.list() ?? Promise.resolve([]),
    ]);
    const derivedObjects = new Set(derived.map((entry) => entry.objectSha256));
    return [
      ...objects
        .filter((object) => !derivedObjects.has(object.file))
        .map((object) => ({ ...object, kind: "raw" as const })),
      ...derived.map((entry) => ({
        file: entry.objectSha256,
        bytes: entry.bytes,
        kind: "duckdb-stage" as const,
        key: entry.key,
        format: entry.format,
        ...(entry.sheet === undefined ? {} : { sheet: entry.sheet }),
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        expiresAt: entry.expiresAt,
      })),
    ];
  }
  clear() {
    return this.cache.clear();
  }
  async prune() {
    const derived = await this.derived?.prune();
    const raw = await this.cache.prune();
    return {
      ...raw,
      derivedExpiredRemoved: derived?.expiredRemoved ?? 0,
      derivedLruRemoved: derived?.lruRemoved ?? 0,
      derivedObjectsRemoved: derived?.objectsRemoved ?? 0,
    };
  }
  async verify() {
    const [raw, derived] = await Promise.all([
      this.cache.verify(),
      this.derived?.verify() ?? Promise.resolve({ entries: [], errors: [] }),
    ]);
    const errors = new Set([...raw.errors, ...derived.errors]);
    for (const entry of derived.entries) {
      try {
        const object = await this.cache.getObject(entry.objectSha256);
        await verifyStagedDatabase(object.path);
      } catch {
        errors.add(`derived:${entry.key}`);
      }
    }
    return { ...raw, errors: [...errors].sort() };
  }
}
