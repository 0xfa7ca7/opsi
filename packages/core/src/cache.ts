import type { ContentCache } from "@opsi/storage";
export class CacheService {
  constructor(private readonly cache: ContentCache) {}
  info() {
    return this.cache.info();
  }
  list() {
    return this.cache.list();
  }
  clear() {
    return this.cache.clear();
  }
  prune() {
    return this.cache.prune();
  }
  verify() {
    return this.cache.verify();
  }
}
