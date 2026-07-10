import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, open, readFile, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Readable } from "node:stream";
import { EXIT_CODES, OpsiError, type MetadataCache } from "@opsi/domain";
import { CacheLayout, canonicalCacheKey } from "./cache-layout.js";
import { CacheLock } from "./cache-lock.js";

export interface CacheObject {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}
interface MetadataRecord<T = unknown> {
  schemaVersion: string;
  key: string;
  value: T;
  objectSha256?: string;
  createdAt: string;
  expiresAt?: string;
}
const MAX_CACHE_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;
export interface ContentCacheOptions {
  readonly fault?: (
    point: "after-partial-write" | "after-object-rename" | "before-metadata-rename",
  ) => void;
  readonly materializeTempPath?: (destination: string) => string;
  readonly maxObjectBytes?: number;
}
async function fileDigest(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const raw of createReadStream(path)) {
    const chunk = Buffer.from(raw);
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}
function corrupt(message: string, cause?: unknown): OpsiError {
  return new OpsiError({
    code: "CACHE_CORRUPT",
    message,
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    ...(cause === undefined ? {} : { cause }),
  });
}
function parseMetadataRecord<T>(text: string): MetadataRecord<T> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw corrupt("Cached metadata is invalid JSON.", error);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw corrupt("Cached metadata is not an object.");
  const record = value as Partial<MetadataRecord<T>>;
  if (
    typeof record.schemaVersion !== "string" ||
    record.schemaVersion.length === 0 ||
    typeof record.key !== "string" ||
    typeof record.createdAt !== "string" ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    !("value" in record) ||
    (record.expiresAt !== undefined &&
      (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt)))) ||
    (record.objectSha256 !== undefined && !/^[a-f\d]{64}$/u.test(record.objectSha256))
  )
    throw corrupt("Cached metadata does not match its schema.");
  return record as MetadataRecord<T>;
}
async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* unsupported on Windows */
  }
}
async function atomicJson(path: string, value: unknown, fault?: () => void): Promise<void> {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    fault?.();
    await rename(temp, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
export class ContentCache implements MetadataCache {
  private readonly paths: CacheLayout;
  constructor(
    root: string,
    private readonly options: ContentCacheOptions = {},
  ) {
    this.paths = new CacheLayout(root);
  }
  async layout(): Promise<CacheLayout> {
    return this.paths.ensure();
  }
  async putObject(input: Readable | AsyncIterable<Uint8Array | string>): Promise<CacheObject> {
    const layout = await this.layout();
    const temp = `${layout.objects}/.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temp, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const raw of input) {
        const chunk = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
        bytes += chunk.length;
        if (bytes > (this.options.maxObjectBytes ?? MAX_CACHE_OBJECT_BYTES))
          throw new OpsiError({
            code: "CACHE_OBJECT_TOO_LARGE",
            message: "Cache object exceeds the configured byte limit.",
            exitCode: EXIT_CODES.INVALID_INPUT,
          });
        hash.update(chunk);
        await handle.write(chunk);
        this.options.fault?.("after-partial-write");
      }
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temp, { force: true });
      throw error;
    }
    await handle.close();
    const sha256 = hash.digest("hex");
    const completed = await lstat(temp);
    if (
      !completed.isFile() ||
      completed.isSymbolicLink() ||
      completed.size !== bytes ||
      (await fileDigest(temp)).sha256 !== sha256
    ) {
      await rm(temp, { force: true });
      throw corrupt("Completed cache temporary object failed validation.");
    }
    const target = layout.objectPath(sha256);
    let createdTarget = false;
    try {
      await link(temp, target);
      createdTarget = true;
      await syncDirectory(layout.objects);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await rm(temp, { force: true });
        throw error;
      }
    }
    const winner = await lstat(target);
    if (
      !winner.isFile() ||
      winner.isSymbolicLink() ||
      winner.size !== bytes ||
      winner.size > (this.options.maxObjectBytes ?? MAX_CACHE_OBJECT_BYTES)
    ) {
      await rm(temp, { force: true });
      if (createdTarget) await rm(target, { force: true });
      throw corrupt("An existing cache object is not a regular file.");
    }
    if ((await fileDigest(target)).sha256 !== sha256) {
      await rm(temp, { force: true });
      if (createdTarget) await rm(target, { force: true });
      throw corrupt("An existing cache object failed checksum verification.");
    }
    await unlink(temp).catch(() => undefined);
    this.options.fault?.("after-object-rename");
    return { path: target, sha256, bytes };
  }
  async getObject(sha256: string): Promise<CacheObject> {
    if (!/^[a-f\d]{64}$/u.test(sha256)) throw corrupt("Invalid cached object digest.");
    const path = (await this.layout()).objectPath(sha256);
    let details;
    try {
      details = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new OpsiError({
          code: "CACHE_MISS",
          message: "Cached object not found.",
          exitCode: EXIT_CODES.NOT_FOUND,
        });
      throw error;
    }
    if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_CACHE_OBJECT_BYTES)
      throw corrupt("Cached object is not a regular file.");
    const verified = await fileDigest(path);
    if (verified.sha256 !== sha256 || verified.bytes !== details.size)
      throw corrupt("Cached object checksum verification failed.");
    return { path, sha256, bytes: details.size };
  }
  async materialize(
    sha256: string,
    requestedDestination: string,
    force = false,
  ): Promise<CacheObject> {
    const object = await this.getObject(sha256);
    const destination = resolve(requestedDestination);
    const directory = dirname(destination);
    const lock = await CacheLock.acquire(directory, `materialize:${destination}`);
    const temp =
      this.options.materializeTempPath?.(destination) ??
      `${destination}.part-${process.pid}-${randomUUID()}`;
    let tempHandle;
    let ownsTemp = false;
    try {
      tempHandle = await open(temp, "wx", 0o600);
      ownsTemp = true;
      for await (const raw of createReadStream(object.path))
        await tempHandle.write(Buffer.from(raw));
      await tempHandle.sync();
      await tempHandle.close();
      tempHandle = undefined;
      if (force) {
        try {
          const current = await lstat(destination);
          if (!current.isFile() || current.isSymbolicLink())
            throw new OpsiError({
              code: "UNSAFE_DOWNLOAD_DESTINATION",
              message: "The destination is not a regular file.",
              exitCode: EXIT_CODES.INVALID_INPUT,
            });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(temp, destination);
      } else {
        try {
          await link(temp, destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new OpsiError({
              code: "DOWNLOAD_DESTINATION_EXISTS",
              message: "The destination already exists.",
              exitCode: EXIT_CODES.INVALID_INPUT,
            });
          throw error;
        }
        await unlink(temp);
      }
      await syncDirectory(directory);
      return { ...object, path: destination };
    } catch (error) {
      await tempHandle?.close().catch(() => undefined);
      if (ownsTemp) await rm(temp, { force: true });
      throw error;
    } finally {
      await lock.release();
    }
  }
  async putObjectWithMetadata<T>(
    key: string,
    schemaVersion: string,
    input: Readable | AsyncIterable<Uint8Array | string>,
    value: T,
    ttlMs?: number,
  ): Promise<CacheObject> {
    const object = await this.putObject(input);
    await this.putMetadata(key, schemaVersion, value, object.sha256, ttlMs);
    return object;
  }
  async putMetadata<T>(
    key: string,
    schemaVersion: string,
    value: T,
    objectSha256?: string,
    ttlMs?: number,
  ): Promise<void> {
    const layout = await this.layout();
    if (objectSha256 !== undefined) await this.getObject(objectSha256);
    const lock = await CacheLock.acquire(layout.locks, `metadata:${key}`);
    try {
      const now = Date.now();
      const record: MetadataRecord<T> = {
        schemaVersion,
        key,
        value,
        createdAt: new Date(now).toISOString(),
        ...(objectSha256 === undefined ? {} : { objectSha256 }),
        ...(ttlMs === undefined ? {} : { expiresAt: new Date(now + ttlMs).toISOString() }),
      };
      await atomicJson(layout.metadataPath(key), record, () =>
        this.options.fault?.("before-metadata-rename"),
      );
    } finally {
      await lock.release();
    }
  }
  async getMetadata<T>(
    key: string,
    schemaVersion: string,
    includeExpired = false,
  ): Promise<T | undefined> {
    const path = (await this.layout()).metadataPath(key);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const record = parseMetadataRecord<T>(text);
    if (record.schemaVersion !== schemaVersion || record.key !== key)
      throw corrupt("Cached metadata does not match its schema or key.");
    if (
      !includeExpired &&
      record.expiresAt !== undefined &&
      Date.parse(record.expiresAt) <= Date.now()
    )
      return undefined;
    if (record.objectSha256 !== undefined) {
      try {
        await this.getObject(record.objectSha256);
      } catch (error) {
        throw corrupt("Cached metadata refers to a missing or invalid object.", error);
      }
    }
    return record.value;
  }
  get<T>(key: string, schemaVersion: string): Promise<T | undefined> {
    return this.getMetadata<T>(key, schemaVersion);
  }
  set<T>(key: string, schemaVersion: string, value: T, ttlMs: number): Promise<void> {
    return this.putMetadata(key, schemaVersion, value, undefined, ttlMs);
  }
  async delete(key: string): Promise<void> {
    await rm((await this.layout()).metadataPath(key), { force: true });
  }
  async verify(): Promise<{
    readonly objects: number;
    readonly metadata: number;
    readonly errors: readonly string[];
  }> {
    const layout = await this.layout();
    const errors: string[] = [];
    let objects = 0;
    for (const name of await readdir(layout.objects)) {
      if (!/^[a-f\d]{64}$/u.test(name)) continue;
      objects++;
      const path = layout.objectPath(name);
      const details = await lstat(path);
      if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_CACHE_OBJECT_BYTES) {
        errors.push(`object:${name}`);
        continue;
      }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest("hex") !== name) errors.push(`object:${name}`);
    }
    const metadataFiles = (await readdir(layout.metadata)).filter((name) => name.endsWith(".json"));
    for (const name of metadataFiles) {
      try {
        const record = parseMetadataRecord(await readFile(`${layout.metadata}/${name}`, "utf8"));
        if (name !== `${canonicalCacheKey(record.key)}.json`)
          throw corrupt("Cached metadata filename does not match its key.");
        if (record.objectSha256 !== undefined) await this.getObject(record.objectSha256);
      } catch {
        errors.push(`metadata:${name}`);
      }
    }
    const metadata = metadataFiles.length;
    return { objects, metadata, errors };
  }
  async list(): Promise<readonly { readonly file: string; readonly bytes: number }[]> {
    const layout = await this.layout();
    return Promise.all(
      (await readdir(layout.objects))
        .filter((n) => /^[a-f\d]{64}$/u.test(n))
        .map(async (file) => ({ file, bytes: (await stat(layout.objectPath(file))).size })),
    );
  }
  async info(): Promise<{
    readonly root: string;
    readonly objects: number;
    readonly metadata: number;
    readonly bytes: number;
  }> {
    const layout = await this.layout();
    const objects = await this.list();
    return {
      root: layout.root,
      objects: objects.length,
      metadata: (await readdir(layout.metadata)).filter((n) => n.endsWith(".json")).length,
      bytes: objects.reduce((n, object) => n + object.bytes, 0),
    };
  }
  async prune(): Promise<{ readonly removed: number }> {
    const layout = await this.layout();
    let removed = 0;
    for (const name of await readdir(layout.metadata)) {
      const path = `${layout.metadata}/${name}`;
      try {
        const record = JSON.parse(await readFile(path, "utf8")) as MetadataRecord;
        if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= Date.now()) {
          await rm(path, { force: true });
          removed++;
        }
      } catch {
        /* verify reports corruption */
      }
    }
    return { removed };
  }
  async clear(): Promise<void> {
    await rm(this.paths.root, { recursive: true, force: true });
    await this.layout();
  }
}
