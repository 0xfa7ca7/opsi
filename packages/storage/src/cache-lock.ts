import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { canonicalCacheKey } from "./cache-layout.js";

interface Owner {
  token: string;
  pid: number;
  hostname: string;
  processStartedAt: number;
  processStartIdentity: string;
  createdAt: number;
  heartbeatAt: number;
}
export interface CacheLockOptions {
  readonly staleMs?: number;
  readonly waitMs?: number;
  readonly heartbeatMs?: number;
  readonly signal?: AbortSignal;
  readonly beforePublish?: () => Promise<void>;
  readonly processStartIdentity?: (pid: number) => Promise<string | undefined>;
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

const execFileAsync = promisify(execFile);
async function osProcessStartIdentity(pid: number): Promise<string | undefined> {
  try {
    if (process.platform === "linux") {
      const value = await readFile(`/proc/${pid}/stat`, "utf8");
      return value.slice(value.lastIndexOf(")") + 2).split(" ")[19];
    }
    if (process.platform === "darwin")
      return (
        (await execFileAsync("/bin/ps", ["-o", "lstart=", "-p", String(pid)])).stdout.trim() ||
        undefined
      );
    if (process.platform === "win32")
      return (
        (
          await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-Command",
            `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
          ])
        ).stdout.trim() || undefined
      );
  } catch {
    return undefined;
  }
  return undefined;
}
async function localOwnerIsAlive(
  owner: Owner | undefined,
  resolver: (pid: number) => Promise<string | undefined>,
): Promise<boolean> {
  if (owner === undefined || owner.hostname !== hostname()) return false;
  if ((await resolver(owner.pid)) !== owner.processStartIdentity) return false;
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
    const processStartedAt = Date.now() - Math.floor(process.uptime() * 1_000);
    const identityResolver = options.processStartIdentity ?? osProcessStartIdentity;
    const processStartIdentity = await identityResolver(process.pid);
    if (processStartIdentity === undefined)
      throw new OpsiError({
        code: "PROCESS_IDENTITY_UNAVAILABLE",
        message: "Unable to determine process start identity for cache locking.",
        exitCode: EXIT_CODES.INTERNAL,
      });
    while (true) {
      options.signal?.throwIfAborted();
      const now = Date.now();
      const owner: Owner = {
        token: randomUUID(),
        pid: process.pid,
        hostname: hostname(),
        processStartedAt,
        processStartIdentity,
        createdAt: now,
        heartbeatAt: now,
      };
      const candidate = `${path}.pending-${owner.token}`;
      try {
        await mkdir(candidate, { mode: 0o700 });
        await writeFile(join(candidate, "owner.json"), JSON.stringify(owner), {
          mode: 0o600,
          flag: "wx",
        });
        await options.beforePublish?.();
        await rename(candidate, path);
        return new CacheLock(path, owner, heartbeatMs);
      } catch (error) {
        await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
      }
      let existing: Owner | undefined;
      try {
        existing = JSON.parse(await readFile(join(path, "owner.json"), "utf8")) as Owner;
      } catch {
        /* partial owner is recoverable after staleness */
      }
      const timestamp = existing?.heartbeatAt ?? existing?.createdAt ?? 0;
      if (
        Date.now() - timestamp > staleMs &&
        !(await localOwnerIsAlive(existing, identityResolver))
      ) {
        const tombstone = `${path}.stale-${existing?.token ?? "unknown"}-${randomUUID()}`;
        try {
          await rename(path, tombstone);
          const quarantined = JSON.parse(
            await readFile(join(tombstone, "owner.json"), "utf8"),
          ) as Owner;
          if (
            quarantined.token !== existing?.token ||
            quarantined.processStartedAt !== existing?.processStartedAt ||
            quarantined.processStartIdentity !== existing?.processStartIdentity ||
            quarantined.heartbeatAt !== existing?.heartbeatAt
          ) {
            await rename(tombstone, path).catch(() => undefined);
            continue;
          }
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
