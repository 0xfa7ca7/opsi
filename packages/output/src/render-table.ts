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

function truncate(value: string, width: number): string {
  if (stringWidth(value) <= width) return value;
  if (width <= 0) return "";
  const ellipsis = "…";
  const contentWidth = Math.max(0, width - stringWidth(ellipsis));
  let result = "";
  for (const character of value) {
    if (stringWidth(`${result}${character}`) > contentWidth) break;
    result += character;
  }
  return `${result}${ellipsis}`;
}

export interface TableLayout {
  readonly columns: readonly string[];
  readonly widths: readonly number[];
}

export function tableLayoutFor(rows: readonly OutputRow[]): TableLayout {
  const columns = columnsFor(rows);
  const body = rows.map((row) => columns.map((column) => sanitizeTerminalText(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(
      stringWidth(sanitizeTerminalText(column)),
      ...body.map((row) => stringWidth(row[index] ?? "")),
    ),
  );
  return { columns, widths };
}

export function renderTable(
  rows: readonly OutputRow[],
  includeHeader = true,
  layout = tableLayoutFor(rows),
): string {
  if (rows.length === 0) return "";
  const { columns, widths } = layout;
  const body = rows.map((row) =>
    columns.map((column, index) => {
      const value = sanitizeTerminalText(row[column]);
      return index === columns.length - 1 ? value : truncate(value, widths[index] ?? 0);
    }),
  );
  const lines = [
    ...(includeHeader
      ? [
          columns.map((column, index) => {
            const value = sanitizeTerminalText(column);
            return index === columns.length - 1 ? value : truncate(value, widths[index] ?? 0);
          }),
        ]
      : []),
    ...body,
  ].map((row) => row.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  "));
  return `${lines.join("\n")}\n`;
}
