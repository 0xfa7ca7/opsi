import { extname, resolve } from "node:path";
import { boundedFileSample, normalizeInput, utf8Text } from "./sample.js";
import type {
  DataInput,
  DetectionConfidence,
  DetectedInputFormat,
  FormatDetection,
  SupportedDataFormat,
} from "./types.js";

const EXTENSIONS: Readonly<Record<string, DetectedInputFormat>> = {
  ".csv": "csv",
  ".tsv": "tsv",
  ".json": "json",
  ".jsonl": "ndjson",
  ".ndjson": "ndjson",
  ".xlsx": "xlsx",
  ".parquet": "parquet",
  ".zip": "zip",
};

const MEDIA_TYPES: Readonly<Record<string, SupportedDataFormat>> = {
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "application/json": "json",
  "application/x-ndjson": "ndjson",
  "application/ndjson": "ndjson",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.apache.parquet": "parquet",
  "application/parquet": "parquet",
};

function result(
  path: string,
  format: DetectedInputFormat,
  confidence: DetectionConfidence,
  mediaType: string | undefined,
  extension: string,
): FormatDetection {
  return {
    path,
    format,
    confidence,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(extension.length === 0 ? {} : { extension }),
  };
}

function signature(head: Buffer, tail: Buffer): DetectedInputFormat | undefined {
  if (head.subarray(0, 4).equals(Buffer.from("PAR1"))) return "parquet";
  const zipHeader = head.subarray(0, 4);
  if (
    zipHeader.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    zipHeader.equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    zipHeader.equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
  ) {
    const zipIndex = Buffer.concat([head, tail]).toString("latin1");
    return zipIndex.includes("xl/workbook.xml") && zipIndex.includes("[Content_Types].xml")
      ? "xlsx"
      : "zip";
  }
  return undefined;
}

function structuredContent(
  text: string,
  structuredFallback?: Extract<SupportedDataFormat, "json" | "ndjson">,
): SupportedDataFormat | undefined {
  const trimmed = text.replace(/^\uFEFF/u, "").trim();
  if (trimmed.length === 0) return undefined;
  const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length > 1) {
    try {
      if (
        lines.every((line) => {
          const value = JSON.parse(line) as unknown;
          return typeof value === "object" && value !== null;
        })
      )
        return "ndjson";
    } catch {
      // Delimited text is checked below.
    }
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // A bounded sample of a larger JSON value may be incomplete.
      if (trimmed.startsWith("[")) return "json";
      return structuredFallback;
    }
  }
  const firstLines = lines.slice(0, 5);
  const tabs = firstLines.map((line) => line.split("\t").length - 1);
  const commas = firstLines.map((line) => line.split(",").length - 1);
  const consistent = (counts: readonly number[]): boolean =>
    counts.length > 0 && (counts[0] ?? 0) > 0 && counts.every((count) => count === counts[0]);
  if (consistent(tabs) && !consistent(commas)) return "tsv";
  if (consistent(commas)) return "csv";
  return undefined;
}

export async function detectFormat(input: DataInput): Promise<FormatDetection> {
  const source = normalizeInput(input);
  const path = resolve(source.path);
  const extension = extname(path).toLowerCase();
  const { head, tail } = await boundedFileSample(path);
  const bySignature = signature(head, tail);
  if (bySignature !== undefined)
    return result(path, bySignature, "signature", source.mediaType, extension);

  const mediaType = source.mediaType?.split(";", 1)[0]?.trim().toLowerCase();
  const byMediaType = mediaType === undefined ? undefined : MEDIA_TYPES[mediaType];
  if (byMediaType !== undefined)
    return result(path, byMediaType, "media-type", source.mediaType, extension);

  const text = utf8Text(head);
  const extensionFormat = EXTENSIONS[extension];
  const structuredFallback =
    extensionFormat === "json" || extensionFormat === "ndjson" ? extensionFormat : undefined;
  const byContent = text === undefined ? undefined : structuredContent(text, structuredFallback);
  if (byContent !== undefined)
    return result(path, byContent, "content", source.mediaType, extension);

  return result(
    path,
    EXTENSIONS[extension] ?? "unknown",
    extension in EXTENSIONS ? "extension" : "unknown",
    source.mediaType,
    extension,
  );
}
