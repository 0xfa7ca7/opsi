import { EXIT_CODES, KlopsiError } from "@klopsi/domain";

export const CHART_RENDERER_VERSION = "1";
export type ChartType = "bar" | "line";

export interface ChartPoint {
  readonly label: string;
  readonly value: number;
}

export interface ChartRenderInput {
  readonly type: ChartType;
  readonly title: string;
  readonly x: string;
  readonly y: string;
  readonly points: readonly ChartPoint[];
  readonly limit: number;
  readonly truncated: boolean;
}

const WIDTH = 960;
const HEIGHT = 480;
const PLOT = { left: 84, right: 28, top: 34, bottom: 104 } as const;
const TICK_INTERVALS = 4;

function chartError(
  code: "CHART_EMPTY" | "CHART_NON_NUMERIC_Y",
  message: string,
  context?: Readonly<Record<string, unknown>>,
): KlopsiError {
  return new KlopsiError({
    code,
    message,
    exitCode: EXIT_CODES.INVALID_INPUT,
    ...(context === undefined ? {} : { context }),
  });
}

function numeric(value: unknown, row: number, column: string): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim() !== ""
          ? Number(value)
          : Number.NaN;
  if (!Number.isFinite(normalized))
    throw chartError(
      "CHART_NON_NUMERIC_Y",
      `Column '${column}' contains a non-numeric value at selected row ${row}.`,
      { column, row },
    );
  return Object.is(normalized, -0) ? 0 : normalized;
}

function label(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  )
    return String(value);
  return JSON.stringify(value) ?? String(value);
}

export function normalizeChartPoints(
  rows: readonly Readonly<Record<string, unknown>>[],
  x: string,
  y: string,
): readonly ChartPoint[] {
  if (rows.length === 0)
    throw chartError("CHART_EMPTY", "The selected input has no rows to chart.");
  return rows.map((row, index) => ({
    label: label(row[x]),
    value: numeric(row[y], index + 1, y),
  }));
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decimal(value: number, places = 6): string {
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value
    .toFixed(places)
    .replace(/(?:\.0+|(\.\d+?)0+)$/u, "$1")
    .replace(/^-0$/u, "0");
}

function visibleLabel(value: string): string {
  const characters = Array.from(value);
  return characters.length <= 24 ? value : `${characters.slice(0, 23).join("")}…`;
}

function yDomain(points: readonly ChartPoint[]): readonly [number, number] {
  const values = points.map((point) => point.value);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  return minimum === maximum ? [0, 1] : [minimum, maximum];
}

function svg(input: ChartRenderInput): string {
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const [minimum, maximum] = yDomain(input.points);
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  const normalizedMinimum = minimum / magnitude;
  const normalizedMaximum = maximum / magnitude;
  const normalizedRange = normalizedMaximum - normalizedMinimum;
  const scaleY = (value: number) =>
    PLOT.top + ((normalizedMaximum - value / magnitude) / normalizedRange) * plotHeight;
  const zeroY = scaleY(0);
  const slot = plotWidth / input.points.length;
  const xAt = (index: number) => PLOT.left + slot * (index + 0.5);

  const grid = Array.from({ length: TICK_INTERVALS + 1 }, (_, index) => {
    const ratio = index / TICK_INTERVALS;
    const value = (normalizedMaximum - normalizedRange * ratio) * magnitude;
    const y = PLOT.top + plotHeight * ratio;
    return [
      `      <line class="grid" x1="${PLOT.left}" y1="${decimal(y)}" x2="${WIDTH - PLOT.right}" y2="${decimal(y)}" aria-hidden="true"/>`,
      `      <text class="tick y-tick" x="${PLOT.left - 12}" y="${decimal(y + 4)}" text-anchor="end">${escapeText(decimal(value))}</text>`,
    ].join("\n");
  }).join("\n");

  const xLabels = input.points
    .map((point, index) => {
      const x = xAt(index);
      return `      <text class="tick x-tick" x="${decimal(x)}" y="${HEIGHT - PLOT.bottom + 24}" text-anchor="end" transform="rotate(-35 ${decimal(x)} ${HEIGHT - PLOT.bottom + 24})">${escapeText(visibleLabel(point.label))}</text>`;
    })
    .join("\n");

  const geometry =
    input.type === "bar"
      ? input.points
          .map((point, index) => {
            const width = slot * 0.68;
            const valueY = scaleY(point.value);
            const y = Math.min(valueY, zeroY);
            const height = Math.abs(zeroY - valueY);
            return [
              `      <rect class="bar" x="${decimal(xAt(index) - width / 2)}" y="${decimal(y)}" width="${decimal(width)}" height="${decimal(height)}">`,
              `        <title>${escapeText(`${point.label}: ${decimal(point.value)}`)}</title>`,
              "      </rect>",
            ].join("\n");
          })
          .join("\n")
      : [
          `      <polyline class="series-line" points="${input.points.map((point, index) => `${decimal(xAt(index))},${decimal(scaleY(point.value))}`).join(" ")}" aria-hidden="true"/>`,
          ...input.points.map((point, index) =>
            [
              `      <circle class="point" cx="${decimal(xAt(index))}" cy="${decimal(scaleY(point.value))}" r="5">`,
              `        <title>${escapeText(`${point.label}: ${decimal(point.value)}`)}</title>`,
              "      </circle>",
            ].join("\n"),
          ),
        ].join("\n");

  const selection = input.truncated
    ? `The first ${input.points.length} points are shown in source order; additional source rows were not rendered.`
    : `All ${input.points.length} points are shown in source order.`;
  const description = `${input.type === "bar" ? "Bar" : "Line"} chart of ${input.y} by ${input.x}. ${selection}`;

  return [
    `    <svg role="img" aria-labelledby="chart-svg-title chart-svg-desc" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    `      <title id="chart-svg-title">${escapeText(input.title)}</title>`,
    `      <desc id="chart-svg-desc">${escapeText(description)}</desc>`,
    grid,
    `      <line class="axis" x1="${PLOT.left}" y1="${decimal(zeroY)}" x2="${WIDTH - PLOT.right}" y2="${decimal(zeroY)}" aria-hidden="true"/>`,
    `      <line class="axis" x1="${PLOT.left}" y1="${PLOT.top}" x2="${PLOT.left}" y2="${HEIGHT - PLOT.bottom}" aria-hidden="true"/>`,
    geometry,
    xLabels,
    `      <text class="axis-label" x="${PLOT.left + plotWidth / 2}" y="${HEIGHT - 14}" text-anchor="middle">${escapeText(input.x)}</text>`,
    `      <text class="axis-label" x="20" y="${PLOT.top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 20 ${decimal(PLOT.top + plotHeight / 2)})">${escapeText(input.y)}</text>`,
    "    </svg>",
  ].join("\n");
}

export function renderChartHtml(input: ChartRenderInput): string {
  if (input.points.length === 0)
    throw chartError("CHART_EMPTY", "The selected input has no rows to chart.");
  const selection = input.truncated
    ? `Showing the first ${input.points.length} points of a larger source, in source order. Additional source rows were not rendered.`
    : `Showing ${input.points.length} points in source order.`;
  const rows = input.points
    .map(
      (point) =>
        `          <tr><td>${escapeText(point.label)}</td><td>${escapeText(decimal(point.value))}</td></tr>`,
    )
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src &#39;self&#39; data:">',
    `  <title>${escapeText(input.title)}</title>`,
    "  <style>",
    "    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; background: #f7f8fa; color: #172033; }",
    "    body { max-width: 1100px; margin: 0 auto; padding: 2rem; }",
    "    h1 { margin-bottom: .35rem; font-size: 1.75rem; }",
    "    .summary { margin-top: 0; color: #4b5568; }",
    "    figure, .data { margin: 1.5rem 0; padding: 1rem; background: #fff; border: 1px solid #d8deea; border-radius: .5rem; }",
    "    svg { display: block; width: 100%; height: auto; }",
    "    .grid { stroke: #dce2ec; stroke-width: 1; }",
    "    .axis { stroke: #596579; stroke-width: 1.5; }",
    "    .bar { fill: #1f6f8b; }",
    "    .series-line { fill: none; stroke: #1f6f8b; stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }",
    "    .point { fill: #fff; stroke: #174e63; stroke-width: 3; }",
    "    .tick { fill: #445066; font-size: 12px; }",
    "    .axis-label { fill: #172033; font-size: 14px; font-weight: 650; }",
    "    table { width: 100%; border-collapse: collapse; }",
    "    caption { text-align: left; font-weight: 700; margin-bottom: .5rem; }",
    "    th, td { padding: .5rem .65rem; border-bottom: 1px solid #d8deea; text-align: left; vertical-align: top; overflow-wrap: anywhere; }",
    "    th { background: #eef2f7; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    `    <h1>${escapeText(input.title)}</h1>`,
    `    <p class="summary">${escapeText(`${input.type === "bar" ? "Bar" : "Line"} chart · ${input.points.length} points · ${selection}`)}</p>`,
    "    <figure>",
    svg(input),
    "    </figure>",
    '    <section class="data" aria-labelledby="chart-data-title">',
    '      <h2 id="chart-data-title">Chart data</h2>',
    "      <table>",
    "        <caption>Chart data in source order</caption>",
    "        <thead>",
    `          <tr><th scope="col">${escapeText(input.x)}</th><th scope="col">${escapeText(input.y)}</th></tr>`,
    "        </thead>",
    "        <tbody>",
    rows,
    "        </tbody>",
    "      </table>",
    "    </section>",
    "  </main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
