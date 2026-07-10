import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { canonicalCacheKey } from "./cache-layout.js";

interface Owner {
  token: string;
  pid: number;
  hostname: string;
  processStartedAt: number;
  createdAt: number;
  heartbeatAt: number;
}
export interface CacheLockOptions {
  readonly staleMs?: number;
  readonly waitMs?: number;
  readonly heartbeatMs?: number;
  readonly signal?: AbortSignal;
}
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function localOwnerIsAlive(owner: Owner | undefined): boolean {
  if (owner === undefined || owner.hostname !== hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class CacheLock {
  private timer?: NodeJS.Timeout;
  private heartbeatPromise: Promise<void> | undefined;
  private released = false;
  private constructor(
    readonly path: string,
    private readonly owner: Owner,
    heartbeatMs: number,
  ) {
    this.timer = setInterval(() => {
      if (this.heartbeatPromise !== undefined) return;
      const run = this.heartbeat();
      this.heartbeatPromise = run;
      void run.finally(() => {
        if (this.heartbeatPromise === run) this.heartbeatPromise = undefined;
      });
    }, heartbeatMs);
    this.timer.unref();
  }
  static async acquire(
    root: string,
    key: string,
    options: CacheLockOptions = {},
  ): Promise<CacheLock> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = join(root, `${canonicalCacheKey(key)}.lock`);
    const staleMs = options.staleMs ?? 60_000;
    const deadline = Date.now() + (options.waitMs ?? 30_000);
    const heartbeatMs = options.heartbeatMs ?? Math.max(250, Math.floor(staleMs / 3));
    while (true) {
      options.signal?.throwIfAborted();
      const now = Date.now();
      const owner: Owner = {
        token: randomUUID(),
        pid: process.pid,
        hostname: hostname(),
        processStartedAt: now - Math.floor(process.uptime() * 1_000),
        createdAt: now,
        heartbeatAt: now,
      };
      try {
        await mkdir(path, { mode: 0o700 });
        await writeFile(join(path, "owner.json"), JSON.stringify(owner), {
          mode: 0o600,
          flag: "wx",
        });
        return new CacheLock(path, owner, heartbeatMs);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          await rm(path, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      }
      let existing: Owner | undefined;
      try {
        existing = JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as Owner;
      } catch {
        /* partial owner is recoverable after staleness */
      }
      const timestamp = existing?.heartbeatAt ?? existing?.createdAt ?? 0;
      if (Date.now() - timestamp > staleMs && !localOwnerIsAlive(existing)) {
        const tombstone = `${path}.stale-${existing?.token ?? "unknown"}-${randomUUID()}`;
        try {
          await rename(path, tombstone);
          await rm(tombstone, { recursive: true, force: true });
          continue;
        } catch {
          /* another process won */
        }
      }
      if (Date.now() >= deadline)
        throw new OpsiError({
          code: "CACHE_LOCK_TIMEOUT",
          message: "Timed out waiting for a cache lock.",
          exitCode: EXIT_CODES.INTERNAL,
          context: { key: canonicalCacheKey(key) },
        });
      await sleep(Math.min(20, Math.max(1, deadline - Date.now())), options.signal);
    }
  }
  private async heartbeat(): Promise<void> {
    if (this.released) return;
    try {
      const current = JSON.parse(await readFile(join(this.path, "owner.json"), "utf8")) as Owner;
      if (current.token !== this.owner.token) {
        if (this.timer) clearInterval(this.timer);
        return;
      }
      this.owner.heartbeatAt = Date.now();
      const temporaryOwner = join(this.path, `.owner-${this.owner.token}-${randomUUID()}.json`);
      try {
        await writeFile(temporaryOwner, JSON.stringify(this.owner), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporaryOwner, join(this.path, "owner.json"));
      } finally {
        await rm(temporaryOwner, { force: true }).catch(() => undefined);
      }
    } catch {
      /* release and competing recovery verify ownership */
    }
  }
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.timer) clearInterval(this.timer);
    await this.heartbeatPromise;
    try {
      const current = JSON.parse(await readFile(join(this.path, "owner.json"), "utf8")) as Owner;
      if (current.token === this.owner.token) await rm(this.path, { recursive: true, force: true });
    } catch {
      /* missing or malformed ownership is never removed */
    }
  }
}
