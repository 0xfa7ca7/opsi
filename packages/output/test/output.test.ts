import { describe, expect, it, vi } from "vitest";
import {
  ProgressReporter,
  renderDelimited,
  renderJson,
  renderNdjson,
  renderTable,
  sanitizeTerminalText,
} from "../src/index.js";

describe("structured output", () => {
  it("renders a versioned JSON envelope and preserves Unicode", () => {
    expect(renderJson({ data: [{ title: "Črna\u001b[31m" }], meta: {} })).toBe(
      '{"schemaVersion":"1","data":[{"title":"Črna\\u001b[31m"}],"meta":{}}\n',
    );
  });

  it("renders rectangular CSV with deterministic quoting", () => {
    expect(renderDelimited([{ a: "x,y", b: "č" }], ",")).toBe('a,b\n"x,y",č\n');
    expect(renderDelimited([{ a: "x\ny", b: 'a"b' }], "\t")).toBe('a\tb\n"x\ny"\t"a""b"\n');
  });

  it("renders one sanitized record per NDJSON line", () => {
    expect(renderNdjson([{ value: "safe\u202Espoof" }, { value: 2 }])).toBe(
      '{"value":"safe\\u202espoof"}\n{"value":2}\n',
    );
  });
});

describe("terminal output", () => {
  it("escapes terminal and bidi controls before table measurement", () => {
    expect(sanitizeTerminalText("Č\u001b[31m\u009b2J\u202Eok")).toBe(
      "Č\\u001b[31m\\u009b2J\\u202eok",
    );
    expect(renderTable([{ title: "Črna\u001b[31m", count: 2 }])).toBe(
      "title           count\nČrna\\u001b[31m  2    \n",
    );
  });

  it("writes throttled carriage-return progress only to interactive stderr", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const reporter = new ProgressReporter({
      stream: { isTTY: true, write: (chunk) => void writes.push(chunk) },
      intervalMs: 100,
    });

    reporter.update("one");
    reporter.update("two");
    expect(writes).toEqual(["\rone"]);
    vi.advanceTimersByTime(100);
    expect(writes).toEqual(["\rone", "\rtwo"]);

    const silent = new ProgressReporter({
      stream: { isTTY: false, write: () => void writes.push("unexpected") },
    });
    silent.update("hidden");
    const quiet = new ProgressReporter({
      quiet: true,
      stream: { isTTY: true, write: () => void writes.push("unexpected") },
    });
    quiet.update("hidden");
    expect(writes).not.toContain("unexpected");
    vi.useRealTimers();
  });
});
