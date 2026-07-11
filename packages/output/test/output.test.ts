import { describe, expect, it, vi } from "vitest";
import {
  ProgressReporter,
  renderDelimited,
  renderJson,
  renderNdjson,
  renderTable,
  sanitizeTerminalText,
  Renderer,
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

it("projects manifest-selected fields in the requested deterministic order for every renderer", () => {
  const data = [{ id: "d", title: "Dataset", ignored: true }];
  expect(
    new Renderer({ format: "json", stdout: { write() {} }, fields: ["title", "id"] }).render(data),
  ).toBe('{"schemaVersion":"1","data":[{"title":"Dataset","id":"d"}],"meta":{}}\n');
  expect(
    new Renderer({ format: "csv", stdout: { write() {} }, fields: ["title", "id"] }).render(data),
  ).toBe("title,id\nDataset,d\n");
});

describe("incremental renderer pages", () => {
  it("uses command-default fields when global fields are absent", () => {
    const writes: string[] = [];
    const renderer = new Renderer({
      format: "ndjson",
      stdout: { write: (chunk) => void writes.push(chunk) },
    });

    renderer.write([{ id: "d", title: "Dataset", ignored: true }], {}, ["title", "id"]);

    expect(writes).toEqual(['{"title":"Dataset","id":"d"}\n']);
  });

  it("prefers explicit global fields over command-default fields", () => {
    const renderer = new Renderer({
      format: "json",
      stdout: { write() {} },
      fields: ["id"],
    });

    expect(renderer.render([{ id: "d", title: "Dataset" }], {}, ["title"])).toBe(
      '{"schemaVersion":"1","data":[{"id":"d"}],"meta":{}}\n',
    );
  });

  it("prefers explicit global fields over command-default fields for page writes", () => {
    const writes: string[] = [];
    const renderer = new Renderer({
      format: "csv",
      stdout: { write: (chunk) => void writes.push(chunk) },
      fields: ["title", "id"],
    });

    renderer.writePage([{ id: "d", title: "Dataset", ignored: true }], {
      firstPage: true,
      defaultFields: ["id"],
    });

    expect(writes).toEqual(["title,id\nDataset,d\n"]);
  });

  it("writes two NDJSON pages immediately", () => {
    const writes: string[] = [];
    const renderer = new Renderer({
      format: "ndjson",
      stdout: { write: (chunk) => void writes.push(chunk) },
    });

    renderer.writePage([{ id: "one", ignored: true }], {
      firstPage: true,
      defaultFields: ["id"],
    });
    expect(writes).toEqual(['{"id":"one"}\n']);
    renderer.writePage([{ id: "two", ignored: true }], {
      firstPage: false,
      defaultFields: ["id"],
    });

    expect(renderer.format).toBe("ndjson");
    expect(renderer.streamsPages).toBe(true);
    expect(writes).toEqual(['{"id":"one"}\n', '{"id":"two"}\n']);
  });

  it("identifies buffered JSON and rejects page writes", () => {
    const renderer = new Renderer({ format: "json", stdout: { write() {} } });

    expect(renderer.format).toBe("json");
    expect(renderer.streamsPages).toBe(false);
    expect(() => renderer.writePage([], { firstPage: true })).toThrow(
      "JSON output must be written as one buffered document",
    );
  });

  it.each([
    ["csv" as const, "id,title\none,First\n", "two,Second\n"],
    ["tsv" as const, "id\ttitle\none\tFirst\n", "two\tSecond\n"],
  ])("writes one header across two %s pages", (format, firstChunk, secondChunk) => {
    const writes: string[] = [];
    const renderer = new Renderer({
      format,
      stdout: { write: (chunk) => void writes.push(chunk) },
    });
    const defaultFields = ["id", "title"];

    renderer.writePage([{ id: "one", title: "First" }], { firstPage: true, defaultFields });
    renderer.writePage([{ id: "two", title: "Second" }], { firstPage: false, defaultFields });

    expect(writes).toEqual([firstChunk, secondChunk]);
  });

  it("writes one header across two human pages", () => {
    const writes: string[] = [];
    const renderer = new Renderer({
      format: "human",
      stdout: { write: (chunk) => void writes.push(chunk) },
    });
    const defaultFields = ["id", "title"];

    renderer.writePage([{ id: "one", title: "First" }], { firstPage: true, defaultFields });
    renderer.writePage([{ id: "two", title: "Second" }], { firstPage: false, defaultFields });

    expect(writes).toEqual(["id   title\none  First\n", "two  Second\n"]);
  });

  it("keeps streamed human columns aligned when later pages contain wider values", () => {
    const writes: string[] = [];
    const renderer = new Renderer({
      format: "human",
      stdout: { write: (chunk) => void writes.push(chunk) },
    });
    const defaultFields = ["id", "title"];

    renderer.writePage([{ id: "1", title: "Short" }], { firstPage: true, defaultFields });
    renderer.writePage([{ id: "materially-long-id", title: "A materially longer title" }], {
      firstPage: false,
      defaultFields,
    });

    expect(writes.join("")).toBe("id  title\n1   Short\nm…  A materially longer title\n");
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
