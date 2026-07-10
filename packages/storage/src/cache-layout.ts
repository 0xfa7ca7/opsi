import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export function canonicalCacheKey(key: string): string {
  return createHash("sha256").update(key.normalize("NFC"), "utf8").digest("hex");
}

export class CacheLayout {
  readonly objects: string;
  readonly metadata: string;
  readonly locks: string;
  constructor(readonly root: string) {
    this.objects = join(root, "objects");
    this.metadata = join(root, "metadata");
    this.locks = join(root, "locks");
  }
  async ensure(): Promise<this> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await Promise.all(
      [this.objects, this.metadata, this.locks].map((path) =>
        mkdir(path, { recursive: true, mode: 0o700 }),
      ),
    );
    return this;
  }
  objectPath(sha256: string): string {
    return join(this.objects, sha256);
  }
  metadataPath(key: string): string {
    return join(this.metadata, `${canonicalCacheKey(key)}.json`);
  }
}
