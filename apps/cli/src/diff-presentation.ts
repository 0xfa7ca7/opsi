import type { DataDiffResult, DataDiffRowSample } from "@klopsi/domain";
import { renderTable, sanitizeTerminalText } from "@klopsi/output";

function rowText(value: unknown): string {
  return JSON.stringify(value);
}

function samples(title: string, rows: readonly DataDiffRowSample[], truncated: boolean): string {
  if (rows.length === 0) return "";
  const table = rows.map((row) => ({
    key: rowText(row.key),
    ...(row.changedColumns === undefined ? {} : { changed: row.changedColumns.join(", ") }),
    ...(row.before === undefined ? {} : { before: rowText(row.before) }),
    ...(row.after === undefined ? {} : { after: rowText(row.after) }),
  }));
  return `\n${title}${truncated ? " (bounded)" : ""}\n${renderTable(table)}`;
}

export function renderDiffHuman(result: DataDiffResult): string {
  const summary = result.summary;
  const lines = [
    "Experimental dataset diff",
    `Before: ${result.before}`,
    `After:  ${result.after}`,
    `Key:    ${result.key.join(", ")}`,
    "",
    `${summary.added} added, ${summary.removed} removed, ${summary.changed} changed, ${summary.unchanged} unchanged`,
    `${summary.beforeRows} before rows, ${summary.afterRows} after rows, ${summary.schemaChanges} schema changes`,
  ];
  let output = `${sanitizeTerminalText(lines.join("\n"))}\n`;
  if (result.schema.length > 0) {
    output += `\nSchema changes\n${renderTable(
      result.schema.map((change) => ({
        change: change.change,
        column: change.column,
        beforeType: change.beforeType ?? "",
        afterType: change.afterType ?? "",
      })),
    )}`;
  }
  output += samples("Added samples", result.samples.added, result.truncated.added);
  output += samples("Removed samples", result.samples.removed, result.truncated.removed);
  output += samples("Changed samples", result.samples.changed, result.truncated.changed);
  return output;
}

export function diffEvents(result: DataDiffResult): readonly Readonly<Record<string, unknown>>[] {
  return [
    {
      kind: "summary",
      before: result.before,
      after: result.after,
      key: result.key,
      ...result.summary,
      sampleLimit: result.sampleLimit,
      durationMs: result.durationMs,
    },
    ...result.schema.map((change) => ({ kind: "schema", ...change })),
    ...result.samples.added.map((sample) => ({ kind: "added", ...sample })),
    ...result.samples.removed.map((sample) => ({ kind: "removed", ...sample })),
    ...result.samples.changed.map((sample) => ({ kind: "changed", ...sample })),
  ];
}
