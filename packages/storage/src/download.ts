import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EXIT_CODES, OpsiError, type FailureExitCode } from "@opsi/domain";
import { request, type Dispatcher } from "undici";
import { CacheLock } from "./cache-lock.js";
import { isPublicAddress } from "./ip-policy.js";
import { SafeDispatcherFactory } from "./safe-dispatcher.js";

export interface DownloadLimits {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects?: number;
  readonly headersTimeoutMs?: number;
  readonly bodyTimeoutMs?: number;
}
export interface DownloadInput {
  readonly url: string;
  readonly destination: string;
  readonly limits: DownloadLimits;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}
export interface DownloadResult {
  readonly path: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
  readonly bytes: number;
  readonly mediaType?: string;
  readonly sha256: string;
}
export interface ProbeResult {
  readonly finalUrl: string;
  readonly redirectChain: readonly string[];
  readonly status: number;
  readonly headers: Readonly<Record<string, string | readonly string[]>>;
}
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);
function failure(
  code: string,
  message: string,
  exitCode: FailureExitCode = EXIT_CODES.PROVIDER_FAILURE,
  cause?: unknown,
): OpsiError {
  return new OpsiError({ code, message, exitCode, ...(cause === undefined ? {} : { cause }) });
}
function policyError(error: unknown): OpsiError | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== undefined && current !== null && !seen.has(current)) {
    if (current instanceof OpsiError && current.code === "NETWORK_ADDRESS_FORBIDDEN")
      return current;
    seen.add(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return undefined;
}
function validateUrl(
  raw: string,
  allowInsecureHttp: boolean,
  allowPrivateNetwork: boolean,
  previous?: URL,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw failure(
      "INVALID_DOWNLOAD_URL",
      "The download URL is invalid.",
      EXIT_CODES.INVALID_INPUT,
      error,
    );
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "")
    throw failure(
      "INVALID_DOWNLOAD_URL",
      "Download URLs may not contain credentials or fragments.",
      EXIT_CODES.INVALID_INPUT,
    );
  if (previous?.protocol === "https:" && url.protocol === "http:" && !allowInsecureHttp)
    throw failure(
      "HTTPS_DOWNGRADE_FORBIDDEN",
      "HTTPS redirects may not downgrade to HTTP.",
      EXIT_CODES.INVALID_INPUT,
    );
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowInsecureHttp))
    throw failure(
      "INSECURE_DOWNLOAD_URL",
      "Only HTTPS download URLs are permitted.",
      EXIT_CODES.INVALID_INPUT,
    );
  if (
    !allowPrivateNetwork &&
    /^[\d.]+$|:/u.test(url.hostname) &&
    !isPublicAddress(url.hostname.replace(/^\[|\]$/gu, ""))
  )
    throw failure(
      "NETWORK_ADDRESS_FORBIDDEN",
      "The destination uses a private or special-purpose address.",
      EXIT_CODES.INVALID_INPUT,
    );
  return url;
}
function headersRecord(
  headers: Record<string, string | string[] | undefined>,
): Readonly<Record<string, string | readonly string[]>> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string | string[]] => entry[1] !== undefined,
    ),
  );
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
    // Opening directories is not supported on every Node platform.
  }
}

async function digestRegularFile(
  path: string,
): Promise<{ sha256: string; bytes: number } | undefined> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const details = await handle.stat();
    if (!details.isFile()) return undefined;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return { sha256: hash.digest("hex"), bytes: details.size };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export class Downloader {
  constructor(private readonly dispatchers = new SafeDispatcherFactory()) {}
  private async response(
    input: DownloadInput,
    method: "GET" | "HEAD",
  ): Promise<{
    response: Awaited<ReturnType<typeof request>>;
    url: URL;
    chain: string[];
    dispatcher: Dispatcher;
  }> {
    const allowHttp = input.allowInsecureHttp ?? false;
    const allowPrivate = input.allowPrivateNetwork ?? false;
    const maxRedirects = input.limits.maxRedirects ?? 5;
    let url = validateUrl(input.url, allowHttp, allowPrivate);
    const chain: string[] = [];
    let headers: Record<string, string> = {
      "accept-encoding": "identity",
      ...(input.headers ?? {}),
    };
    for (let redirect = 0; ; redirect++) {
      chain.push(url.toString());
      const dispatcher = this.dispatchers.create(url, allowPrivate);
      let response;
      try {
        response = await request(url, {
          method,
          dispatcher,
          headers,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          headersTimeout: input.limits.headersTimeoutMs ?? Math.min(input.limits.timeoutMs, 15_000),
          bodyTimeout: input.limits.bodyTimeoutMs ?? Math.min(input.limits.timeoutMs, 30_000),
        });
      } catch (error) {
        await dispatcher.close();
        const forbidden = policyError(error);
        if (forbidden !== undefined) throw forbidden;
        throw failure(
          "DOWNLOAD_FAILED",
          "The download request failed.",
          EXIT_CODES.PROVIDER_FAILURE,
          error,
        );
      }
      const location = response.headers.location;
      const isRedirect =
        response.statusCode >= 300 && response.statusCode < 400 && typeof location === "string";
      if (!isRedirect) return { response, url, chain, dispatcher };
      response.body.on("error", () => undefined);
      response.body.destroy();
      await dispatcher.close();
      if (redirect >= maxRedirects)
        throw failure(
          "TOO_MANY_REDIRECTS",
          "The download exceeded the redirect limit.",
          EXIT_CODES.INVALID_INPUT,
        );
      const next = validateUrl(new URL(location, url).toString(), allowHttp, allowPrivate, url);
      if (next.origin !== url.origin)
        headers = Object.fromEntries(
          Object.entries(headers).filter(([key]) => !SENSITIVE_HEADERS.has(key.toLowerCase())),
        );
      url = next;
    }
  }
  async probe(input: Omit<DownloadInput, "destination">): Promise<ProbeResult> {
    const timeout = AbortSignal.timeout(input.limits.timeoutMs);
    const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
    const { response, url, chain, dispatcher } = await this.response(
      { ...input, destination: "", signal },
      "HEAD",
    );
    try {
      await response.body.dump();
      return {
        finalUrl: url.toString(),
        redirectChain: chain,
        status: response.statusCode,
        headers: headersRecord(response.headers),
      };
    } finally {
      await dispatcher.close();
    }
  }
  async download(input: DownloadInput): Promise<DownloadResult> {
    const destination = resolve(input.destination);
    const directory = dirname(destination);
    const timeout = AbortSignal.timeout(input.limits.timeoutMs);
    const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = await CacheLock.acquire(directory, `download:${destination}`, {
      signal,
    });
    const temp = `${destination}.part-${process.pid}-${randomUUID()}`;
    let dispatcher: Dispatcher | undefined;
    let handle;
    try {
      const fetched = await this.response({ ...input, destination, signal }, "GET");
      dispatcher = fetched.dispatcher;
      const { response, url, chain } = fetched;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.on("error", () => undefined);
        response.body.destroy();
        throw failure("DOWNLOAD_HTTP_ERROR", `The download returned HTTP ${response.statusCode}.`);
      }
      const declared = response.headers["content-length"];
      if (typeof declared === "string" && Number(declared) > input.limits.maxBytes) {
        response.body.on("error", () => undefined);
        response.body.destroy();
        throw failure(
          "DOWNLOAD_TOO_LARGE",
          "The download exceeds the byte limit.",
          EXIT_CODES.INVALID_INPUT,
        );
      }
      handle = await open(temp, "wx", 0o600);
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const raw of response.body) {
        const chunk = Buffer.from(raw);
        bytes += chunk.length;
        if (bytes > input.limits.maxBytes) {
          response.body.destroy();
          throw failure(
            "DOWNLOAD_TOO_LARGE",
            "The download exceeds the byte limit.",
            EXIT_CODES.INVALID_INPUT,
          );
        }
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      const sha256 = hash.digest("hex");
      if (input.force) {
        try {
          const current = await lstat(destination);
          if (!current.isFile() || current.isSymbolicLink())
            throw failure(
              "UNSAFE_DOWNLOAD_DESTINATION",
              "The destination is not a regular file.",
              EXIT_CODES.INVALID_INPUT,
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(temp, destination);
      } else {
        try {
          await link(temp, destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            const existing = await digestRegularFile(destination);
            if (existing?.sha256 === sha256 && existing.bytes === bytes) {
              await unlink(temp);
            } else {
              throw failure(
                "DOWNLOAD_DESTINATION_EXISTS",
                "The destination already exists.",
                EXIT_CODES.INVALID_INPUT,
              );
            }
          } else {
            throw error;
          }
        }
        await unlink(temp).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      await syncDirectory(directory);
      return {
        path: destination,
        finalUrl: url.toString(),
        redirectChain: chain,
        bytes,
        ...(typeof response.headers["content-type"] === "string"
          ? { mediaType: response.headers["content-type"].split(";", 1)[0] }
          : {}),
        sha256,
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true });
      throw error;
    } finally {
      await dispatcher?.close().catch(() => undefined);
      await lock.release();
    }
  }
}
