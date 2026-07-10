import { serializeJson } from "./render-json.js";

export type OutputRow = Readonly<Record<string, unknown>>;

function columnsFor(rows: readonly OutputRow[]): readonly string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) columns.add(column);
  }
  return [...columns];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return serializeJson(value);
  return String(value);
}

function quoteCell(value: string, delimiter: "," | "\t"): string {
  return value.includes(delimiter) || /["\r\n]/u.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

export function renderDelimited(rows: readonly OutputRow[], delimiter: "," | "\t"): string {
  if (rows.length === 0) return "";
  const columns = columnsFor(rows);
  const lines = [
    columns.map((column) => quoteCell(column, delimiter)).join(delimiter),
    ...rows.map((row) =>
      columns.map((column) => quoteCell(cellText(row[column]), delimiter)).join(delimiter),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
