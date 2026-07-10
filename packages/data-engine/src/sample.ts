import { open, stat } from "node:fs/promises";
import type { DataInput, DataSource } from "./types.js";

export const SAMPLE_BYTES = 64 * 1024;

export function normalizeInput(input: DataInput): DataSource {
  return typeof input === "string" ? { path: input } : input;
}

export async function boundedFileSample(
  path: string,
  bytes = SAMPLE_BYTES,
): Promise<{ readonly head: Buffer; readonly tail: Buffer; readonly sizeBytes: number }> {
  const details = await stat(path);
  const handle = await open(path, "r");
  try {
    const headSize = Math.min(bytes, details.size);
    const head = Buffer.alloc(headSize);
    await handle.read(head, 0, headSize, 0);
    const tailSize = Math.min(bytes, Math.max(0, details.size - headSize));
    const tail = Buffer.alloc(tailSize);
    if (tailSize > 0) await handle.read(tail, 0, tailSize, details.size - tailSize);
    return { head, tail, sizeBytes: details.size };
  } finally {
    await handle.close();
  }
}

export function utf8Text(buffer: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return undefined;
  }
}
