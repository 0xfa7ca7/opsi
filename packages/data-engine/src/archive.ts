import { open, rm } from "node:fs/promises";
import { extname } from "node:path";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { unzip, type Reader, type ZipEntry } from "unzipit";

export interface ArchiveLimits {
  readonly maxEntries: number;
  readonly maxPathBytes: number;
  readonly maxSelectedBytes: number;
  readonly maxExpandedBytes: number;
  readonly maxCompressionRatio: number;
}

export interface ArchiveEntry {
  readonly path: string;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly supported: boolean;
}

export interface ArchiveInspection {
  readonly entries: readonly ArchiveEntry[];
  readonly candidates: readonly string[];
  readonly selectedEntry?: string;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 10_000,
  maxPathBytes: 1_024,
  maxSelectedBytes: 512 * 1024 * 1024,
  maxExpandedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
};

const SUPPORTED = new Set([
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".ndjson",
  ".xlsx",
  ".parquet",
  ".xml",
]);
const ARCHIVES = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".gzip"]);

class FileReader implements Reader {
  private readonly handle;
  private length: number | undefined;

  constructor(path: string) {
    this.handle = open(path, "r");
  }

  async getLength(): Promise<number> {
    this.length ??= (await (await this.handle).stat()).size;
    return this.length;
  }

  async read(offset: number, size: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(size);
    const { bytesRead } = await (await this.handle).read(bytes, 0, size, offset);
    return bytes.subarray(0, bytesRead);
  }

  async close(): Promise<void> {
    await (await this.handle).close();
  }
}

function unsafe(entry: ZipEntry, limits: ArchiveLimits): string | undefined {
  const name = entry.name.replaceAll("\\", "/");
  const segments = name.split("/");
  if (
    name.startsWith("/") ||
    /^[A-Za-z]:\//u.test(name) ||
    name.includes("\0") ||
    Buffer.byteLength(name) > limits.maxPathBytes ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  )
    return "path";
  if (entry.encrypted) return "encrypted";
  const unixMode = entry.externalFileAttributes >>> 16;
  if ((unixMode & 0o170000) === 0o120000) return "symlink";
  if (ARCHIVES.has(extname(name).toLowerCase())) return "nested-archive";
  return undefined;
}

function assertEntry(entry: ZipEntry, limits: ArchiveLimits): void {
  const reason = unsafe(entry, limits);
  if (reason !== undefined)
    throw new OpsiError({
      code: "UNSAFE_ARCHIVE_ENTRY",
      message: "The ZIP archive contains an unsafe entry.",
      exitCode: EXIT_CODES.INTEGRITY_FAILURE,
      context: { entry: entry.name, reason },
    });
  const ratio =
    entry.compressedSize === 0
      ? entry.size === 0
        ? 1
        : Infinity
      : entry.size / entry.compressedSize;
  if (
    entry.size > limits.maxSelectedBytes ||
    entry.size > limits.maxExpandedBytes ||
    ratio > limits.maxCompressionRatio
  )
    throw new OpsiError({
      code: "ARCHIVE_LIMIT_EXCEEDED",
      message: "The ZIP archive entry exceeds a configured safety limit.",
      exitCode: EXIT_CODES.INTEGRITY_FAILURE,
      context: {
        entry: entry.name,
        compressedBytes: entry.compressedSize,
        expandedBytes: entry.size,
      },
    });
}

async function withArchive<T>(
  path: string,
  operation: (entries: Readonly<Record<string, ZipEntry>>) => Promise<T>,
): Promise<T> {
  const reader = new FileReader(path);
  try {
    return await operation((await unzip(reader)).entries);
  } catch (error) {
    if (error instanceof OpsiError) throw error;
    throw new OpsiError({
      code: "INVALID_ARCHIVE_DATA",
      message: "The ZIP archive cannot be read.",
      exitCode: EXIT_CODES.INTEGRITY_FAILURE,
      cause: error,
    });
  } finally {
    await reader.close();
  }
}

export async function inspectArchive(
  path: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
  selected?: string,
): Promise<ArchiveInspection> {
  return withArchive(path, async (records) => {
    const values = Object.values(records).filter((entry) => !entry.isDirectory);
    if (values.length > limits.maxEntries)
      throw new OpsiError({
        code: "ARCHIVE_LIMIT_EXCEEDED",
        message: "The ZIP archive contains too many entries.",
        exitCode: EXIT_CODES.INTEGRITY_FAILURE,
        context: { count: values.length, limit: limits.maxEntries },
      });
    for (const entry of values) assertEntry(entry, limits);
    const entries = values
      .map((entry) => ({
        path: entry.name,
        compressedBytes: entry.compressedSize,
        expandedBytes: entry.size,
        supported: SUPPORTED.has(extname(entry.name).toLowerCase()),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const candidates = entries.filter((entry) => entry.supported).map((entry) => entry.path);
    if (candidates.length === 0)
      throw new OpsiError({
        code: "ARCHIVE_NO_SUPPORTED_ENTRY",
        message: "The ZIP archive contains no supported data entry.",
        exitCode: EXIT_CODES.UNSUPPORTED,
      });
    if (selected !== undefined && !candidates.includes(selected))
      throw new OpsiError({
        code: "ARCHIVE_ENTRY_NOT_FOUND",
        message: "The selected ZIP archive entry is not a supported data entry.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { entry: selected, choices: candidates },
      });
    if (selected === undefined && candidates.length > 1)
      throw new OpsiError({
        code: "ARCHIVE_ENTRY_REQUIRED",
        message: "The ZIP archive contains multiple supported data entries.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { choices: candidates },
      });
    return { entries, candidates, selectedEntry: selected ?? (candidates[0] as string) };
  });
}

export async function extractArchiveEntry(
  archivePath: string,
  selected: string,
  output: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<{ readonly path: string; readonly bytes: number }> {
  return withArchive(archivePath, async (records) => {
    const entry = records[selected];
    if (entry === undefined || entry.isDirectory)
      throw new OpsiError({
        code: "ARCHIVE_ENTRY_NOT_FOUND",
        message: "The selected ZIP archive entry does not exist.",
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { entry: selected },
      });
    assertEntry(entry, limits);
    const bytes = Buffer.from(await entry.arrayBuffer());
    if (bytes.length > limits.maxSelectedBytes)
      throw new OpsiError({
        code: "ARCHIVE_LIMIT_EXCEEDED",
        message: "The extracted ZIP entry exceeds the byte limit.",
        exitCode: EXIT_CODES.INTEGRITY_FAILURE,
      });
    const handle = await open(output, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await rm(output, { force: true });
      throw error;
    } finally {
      await handle.close();
    }
    return { path: output, bytes: bytes.length };
  });
}
