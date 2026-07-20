export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be";
export type DelimitedDialect = "," | "\t" | ";" | "|";

export function detectTextEncoding(head: Uint8Array): TextEncoding {
  if (head[0] === 0xff && head[1] === 0xfe) return "utf-16le";
  if (head[0] === 0xfe && head[1] === 0xff) return "utf-16be";
  return "utf-8";
}

export function decodeTextSample(bytes: Uint8Array):
  | {
      readonly text: string;
      readonly encoding: TextEncoding;
    }
  | undefined {
  const encoding = detectTextEncoding(bytes);
  try {
    return {
      text: new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ""),
      encoding,
    };
  } catch {
    return undefined;
  }
}

export function sniffDelimitedDialect(text: string): DelimitedDialect | undefined {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (lines.length < 2) return undefined;
  const candidates = ([",", "\t", ";", "|"] as const).filter((delimiter) => {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    return (counts[0] ?? 0) > 0 && counts.every((count) => count === counts[0]);
  });
  return candidates.sort(
    (left, right) => (lines[0]?.split(right).length ?? 0) - (lines[0]?.split(left).length ?? 0),
  )[0];
}
