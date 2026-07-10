import stringWidth from "string-width";
import type { OutputRow } from "./render-delimited.js";
import { sanitizeTerminalText } from "./sanitize.js";

function columnsFor(rows: readonly OutputRow[]): readonly string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) columns.add(column);
  }
  return [...columns];
}

function pad(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - stringWidth(value)))}`;
}

export function renderTable(rows: readonly OutputRow[]): string {
  if (rows.length === 0) return "";
  const columns = columnsFor(rows);
  const body = rows.map((row) => columns.map((column) => sanitizeTerminalText(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(
      stringWidth(sanitizeTerminalText(column)),
      ...body.map((row) => stringWidth(row[index] ?? "")),
    ),
  );
  const lines = [
    columns.map((column, index) => pad(sanitizeTerminalText(column), widths[index] ?? 0)),
    ...body,
  ].map((row) => row.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  "));
  return `${lines.join("\n")}\n`;
}
