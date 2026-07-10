const UNSAFE_TERMINAL_CHARACTER = new RegExp(
  // eslint-disable-next-line no-control-regex -- controls are deliberately escaped here
  "[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]",
  "gu",
);
const UNSAFE_JSON_CHARACTER = /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

function unicodeEscape(character: string): string {
  return `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
}

export function sanitizeTerminalText(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  return text.replace(UNSAFE_TERMINAL_CHARACTER, unicodeEscape);
}

export function escapeUnsafeJson(json: string): string {
  return json.replace(UNSAFE_JSON_CHARACTER, unicodeEscape);
}
