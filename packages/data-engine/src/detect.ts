import { extname, resolve } from "node:path";
import { boundedFileSample, normalizeInput } from "./sample.js";
import { decodeTextSample, sniffDelimitedDialect } from "./text-decoding.js";
import type { DelimitedDialect, TextEncoding } from "./text-decoding.js";
import type {
  DataInput,
  DetectionConfidence,
  DetectedInputFormat,
  FormatDetection,
  SupportedDataFormat,
  SupportedInputFormat,
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
  ".xml": "xml",
};

const MEDIA_TYPES: Readonly<Record<string, SupportedInputFormat>> = {
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "application/json": "json",
  "application/x-ndjson": "ndjson",
  "application/ndjson": "ndjson",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.apache.parquet": "parquet",
  "application/parquet": "parquet",
  "application/xml": "xml",
  "text/xml": "xml",
};

function result(
  path: string,
  format: DetectedInputFormat,
  confidence: DetectionConfidence,
  mediaType: string | undefined,
  extension: string,
  text?: { readonly encoding: TextEncoding; readonly delimiter?: DelimitedDialect },
): FormatDetection {
  return {
    path,
    format,
    confidence,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(extension.length === 0 ? {} : { extension }),
    ...(text?.encoding === undefined ? {} : { encoding: text.encoding }),
    ...(text?.delimiter === undefined ? {} : { delimiter: text.delimiter }),
  };
}

function signature(head: Buffer, tail: Buffer): DetectedInputFormat | undefined {
  const finalBytes = tail.length >= 4 ? tail.subarray(-4) : head.subarray(-4);
  if (head.subarray(0, 4).equals(Buffer.from("PAR1")) && finalBytes.equals(Buffer.from("PAR1")))
    return "parquet";
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
): SupportedInputFormat | undefined {
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
  if (trimmed.startsWith("<")) return "xml";
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

  const decoded = decodeTextSample(head);
  const text = decoded?.text;
  const extensionFormat = EXTENSIONS[extension];
  const structuredFallback =
    extensionFormat === "json" || extensionFormat === "ndjson" ? extensionFormat : undefined;
  const structured = text === undefined ? undefined : structuredContent(text, structuredFallback);
  const structuredData = structured === "json" || structured === "ndjson" ? structured : undefined;
  const dialect = structuredData === undefined && text !== undefined ? sniffDelimitedDialect(text) : undefined;
  const dialectFormat = dialect === undefined ? undefined : dialect === "\t" ? "tsv" : "csv";
  const mediaType = source.mediaType?.split(";", 1)[0]?.trim().toLowerCase();
  const byMediaType = mediaType === undefined ? undefined : MEDIA_TYPES[mediaType];
  if (byMediaType !== undefined) {
    const correctedDelimited =
      (byMediaType === "csv" || byMediaType === "tsv") && dialectFormat !== undefined
        ? dialectFormat
        : undefined;
    if (correctedDelimited !== undefined && correctedDelimited !== byMediaType)
      return result(path, correctedDelimited, "content", source.mediaType, extension, {
        encoding: decoded?.encoding ?? "utf-8",
        ...(dialect === undefined ? {} : { delimiter: dialect }),
      });
    return result(path, byMediaType, "media-type", source.mediaType, extension, {
      encoding: decoded?.encoding ?? "utf-8",
      ...(dialect === undefined ? {} : { delimiter: dialect }),
    });
  }

  const byContent = structuredData ?? dialectFormat ?? structured;
  if (byContent !== undefined)
    return result(path, byContent, "content", source.mediaType, extension, {
      encoding: decoded?.encoding ?? "utf-8",
      ...(dialect === undefined ? {} : { delimiter: dialect }),
    });

  const declared = source.declaredFormat?.trim().toLowerCase().replace(/^\./u, "");
  const byDeclared =
    declared === "jsonl"
      ? "ndjson"
      : (["csv", "tsv", "json", "ndjson", "xlsx", "parquet", "xml"] as const).find(
          (format) => format === declared,
        );
  if (byDeclared !== undefined)
    return result(path, byDeclared, "declared-format", source.mediaType, extension);

  return result(
    path,
    EXTENSIONS[extension] ?? "unknown",
    extension in EXTENSIONS ? "extension" : "unknown",
    source.mediaType,
    extension,
  );
}
