import { describe, expect, it } from "vitest";
import {
  CHART_RENDERER_VERSION,
  normalizeChartPoints,
  renderChartHtml,
} from "../src/chart/render.js";

describe("chart point normalization", () => {
  it("preserves source order and accepts finite numbers and strict numeric strings", () => {
    expect(
      normalizeChartPoints(
        [
          { category: "b", value: "2.50" },
          { category: "a", value: -1 },
          { category: 3, value: 4n },
        ],
        "category",
        "value",
      ),
    ).toEqual([
      { label: "b", value: 2.5 },
      { label: "a", value: -1 },
      { label: "3", value: 4 },
    ]);
  });

  it.each([null, undefined, "", " ", true, false, {}, [], "NaN", "Infinity"])(
    "rejects non-numeric y value %j",
    (value) => {
      expect(() => normalizeChartPoints([{ category: "x", value }], "category", "value")).toThrow(
        expect.objectContaining({ code: "CHART_NON_NUMERIC_Y", exitCode: 2 }),
      );
    },
  );

  it("rejects an empty result", () => {
    expect(() => normalizeChartPoints([], "category", "value")).toThrow(
      expect.objectContaining({ code: "CHART_EMPTY", exitCode: 2 }),
    );
  });
});

describe("deterministic chart HTML", () => {
  const points = [
    { label: "Ljubljana", value: 10 },
    { label: "Maribor", value: -5 },
    { label: "Koper", value: 7.25 },
  ] as const;

  it("renders identical accessible bar-chart bytes", () => {
    const input = {
      type: "bar" as const,
      title: "City values",
      x: "city",
      y: "value",
      points,
      limit: 100,
      truncated: false,
    };
    const first = renderChartHtml(input);
    const second = renderChartHtml(input);

    expect(CHART_RENDERER_VERSION).toBe("1");
    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(first).toContain('<svg role="img" aria-labelledby="chart-svg-title chart-svg-desc"');
    expect(first).toContain('<title id="chart-svg-title">City values</title>');
    expect(first).toContain('<desc id="chart-svg-desc">');
    expect(first).toContain('class="bar"');
    expect(first).toContain("<caption>Chart data in source order</caption>");
    expect(first).toContain('<th scope="col">city</th>');
    expect(first).toContain('<th scope="col">value</th>');
    expect(first).toContain("<td>Maribor</td>");
    expect(first).toContain("<td>-5</td>");
    expect(first).toContain("3 points");
    expect(first).toContain("source order");
  });

  it("renders line geometry and per-point text alternatives", () => {
    const html = renderChartHtml({
      type: "line",
      title: "Trend",
      x: "period",
      y: "score",
      points,
      limit: 100,
      truncated: false,
    });

    expect(html).toContain('class="series-line"');
    expect(html.match(/class="point"/gu)).toHaveLength(3);
    expect(html).toContain("<title>Ljubljana: 10</title>");
    expect(html).not.toContain('class="bar"');
  });

  it("encodes malicious titles, columns, and labels without executable markup", () => {
    const attack = `</title><script>alert("x")</script><img src=x onerror=alert(1)>`;
    const html = renderChartHtml({
      type: "bar",
      title: attack,
      x: `<x onmouseover="alert(1)">`,
      y: `value&"'`,
      points: [{ label: attack, value: 1 }],
      limit: 100,
      truncated: false,
    });

    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;x onmouseover=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("value&amp;&quot;&#39;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/iu);
  });

  it("is offline, no-JavaScript, and discloses a bounded prefix", () => {
    const html = renderChartHtml({
      type: "line",
      title: "Bounded",
      x: "x",
      y: "y",
      points,
      limit: 3,
      truncated: true,
    });

    expect(html).toContain("first 3 points");
    expect(html).toContain("Additional source rows were not rendered.");
    expect(html).not.toMatch(
      /<script|<link|<img|<iframe|<form|<[^>]*\s(?:src|href)\s*=|url\s*\(/iu,
    );
    expect(html).toContain(
      "default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src &#39;self&#39; data:",
    );
  });

  it("shortens long SVG labels but preserves complete labels in text and table", () => {
    const label = "A very long category label that cannot fit beneath one point";
    const html = renderChartHtml({
      type: "bar",
      title: "Labels",
      x: "category",
      y: "value",
      points: [{ label, value: 2 }],
      limit: 100,
      truncated: false,
    });

    expect(html).toContain("A very long category la…");
    expect(html).toContain(`<td>${label}</td>`);
    expect(html).toContain(`<title>${label}: 2</title>`);
  });

  it("keeps coordinates finite across the complete finite number range", () => {
    const html = renderChartHtml({
      type: "line",
      title: "Extremes",
      x: "x",
      y: "y",
      points: [
        { label: "low", value: -1e308 },
        { label: "zero", value: 0 },
        { label: "high", value: 1e308 },
      ],
      limit: 100,
      truncated: false,
    });

    expect(html).not.toMatch(/(?:x|y|cx|cy|points)="[^"]*(?:NaN|Infinity)/u);
  });
});
