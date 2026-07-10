import { escapeUnsafeJson } from "./sanitize.js";

export interface JsonEnvelopeInput {
  readonly data: unknown;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly error?: Readonly<Record<string, unknown>>;
}

export function serializeJson(value: unknown): string {
  return escapeUnsafeJson(JSON.stringify(value));
}

export function renderJson(input: JsonEnvelopeInput): string {
  return `${serializeJson({
    schemaVersion: "1",
    data: input.data,
    meta: input.meta ?? {},
    ...(input.error === undefined ? {} : { error: input.error }),
  })}\n`;
}

export function renderNdjson(records: readonly unknown[]): string {
  return (
    records.map((record) => serializeJson(record)).join("\n") + (records.length === 0 ? "" : "\n")
  );
}
