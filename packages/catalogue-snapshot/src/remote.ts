import { constants } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { Downloader } from "@opsi/storage";

export const DEFAULT_CATALOGUE_BASE_URL = "https://0xfa7ca7.github.io/opsi/";

export interface StrictHttpsReaderOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly downloader?: Downloader;
  /** Allows controlled local HTTP fixtures. Do not use in production construction. */
  readonly testOnlyDownloaderOptions?: {
    readonly allowInsecureHttp?: boolean;
    readonly allowPrivateNetwork?: boolean;
  };
}

const CATALOGUE_VALIDATION_CODES = new Set([
  "CATALOGUE_SNAPSHOT_INVALID",
  "CATALOGUE_SNAPSHOT_INTEGRITY",
  "CATALOGUE_SNAPSHOT_STALE",
]);
const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/u;

export class StrictHttpsReader {
  private readonly base: URL;
  private readonly timeoutMs: number;
  private readonly downloader: Downloader;
  private readonly testOnlyDownloaderOptions: NonNullable<
    StrictHttpsReaderOptions["testOnlyDownloaderOptions"]
  >;

  constructor(options: StrictHttpsReaderOptions = {}) {
    this.testOnlyDownloaderOptions = options.testOnlyDownloaderOptions ?? {};
    this.base = catalogueBaseUrl(
      options.baseUrl ?? DEFAULT_CATALOGUE_BASE_URL,
      this.testOnlyDownloaderOptions.allowInsecureHttp ?? false,
    );
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new OpsiError({
        code: "INVALID_CATALOGUE_TIMEOUT",
        message: "The catalogue timeout must be a positive integer.",
        exitCode: EXIT_CODES.INVALID_INPUT,
      });
    }
    this.downloader = options.downloader ?? new Downloader();
  }

  async read(relativePath: string, maxBytes: number): Promise<Uint8Array> {
    const url = resolveRelativePath(this.base, relativePath);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw invalidPath("maxBytes");

    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "opsi-catalogue-remote-"));
      const result = await this.downloader.download({
        url: url.toString(),
        destination: join(directory, "payload"),
        allowedOrigins: [this.base.origin],
        limits: { maxBytes, timeoutMs: this.timeoutMs },
        ...(this.testOnlyDownloaderOptions.allowInsecureHttp === undefined
          ? {}
          : { allowInsecureHttp: this.testOnlyDownloaderOptions.allowInsecureHttp }),
        ...(this.testOnlyDownloaderOptions.allowPrivateNetwork === undefined
          ? {}
          : { allowPrivateNetwork: this.testOnlyDownloaderOptions.allowPrivateNetwork }),
      });

      const handle = await open(result.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const details = await handle.stat();
        if (!details.isFile()) throw new Error("Downloaded catalogue payload is not a file.");
        return new Uint8Array(await handle.readFile());
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isCatalogueValidationError(error)) throw error;
      throw unavailable();
    } finally {
      if (directory !== undefined) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

function catalogueBaseUrl(raw: string, allowInsecureHttp: boolean): URL {
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw invalidBaseUrl();
  }
  if (
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    (base.protocol !== "https:" && !(allowInsecureHttp && base.protocol === "http:"))
  ) {
    throw invalidBaseUrl();
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

function resolveRelativePath(base: URL, relativePath: string): URL {
  if (
    relativePath.length === 0 ||
    URL_SCHEME.test(relativePath) ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("?") ||
    relativePath.includes("#")
  ) {
    throw invalidPath("relativePath");
  }

  try {
    for (const rawSegment of relativePath.split("/")) {
      const segment = decodeURIComponent(rawSegment);
      if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
        throw invalidPath("relativePath");
      }
    }
  } catch (error) {
    if (error instanceof OpsiError) throw error;
    throw invalidPath("relativePath");
  }

  let resolved: URL;
  try {
    resolved = new URL(relativePath, base);
  } catch {
    throw invalidPath("relativePath");
  }
  if (
    resolved.origin !== base.origin ||
    resolved.username !== "" ||
    resolved.password !== "" ||
    resolved.search !== "" ||
    resolved.hash !== "" ||
    !resolved.pathname.startsWith(base.pathname) ||
    resolved.pathname === base.pathname
  ) {
    throw invalidPath("relativePath");
  }
  return resolved;
}

function isCatalogueValidationError(error: unknown): error is OpsiError {
  return error instanceof OpsiError && CATALOGUE_VALIDATION_CODES.has(error.code);
}

function unavailable(): OpsiError {
  return new OpsiError({
    code: "CATALOGUE_SNAPSHOT_UNAVAILABLE",
    message: "The catalogue snapshot is unavailable.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
  });
}

function invalidBaseUrl(): OpsiError {
  return new OpsiError({
    code: "INVALID_CATALOGUE_BASE_URL",
    message: "The catalogue base URL is invalid.",
    exitCode: EXIT_CODES.INVALID_INPUT,
  });
}

function invalidPath(field: string): OpsiError {
  return new OpsiError({
    code: "CATALOGUE_SNAPSHOT_INVALID",
    message: "Catalogue snapshot validation failed.",
    exitCode: EXIT_CODES.PROVIDER_FAILURE,
    context: { field },
  });
}
