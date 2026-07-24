import { describe, expect, it } from "vitest";
import { diffEvents, renderDiffHuman } from "../src/diff-presentation.js";

const result = {
  before: "/tmp/before.csv",
  after: "/tmp/after.csv",
  key: ["id"],
  summary: {
    beforeRows: 2,
    afterRows: 2,
    added: 1,
    removed: 1,
    changed: 1,
    unchanged: 0,
    schemaChanges: 1,
  },
  schema: [{ column: "value", change: "type-changed", beforeType: "BIGINT", afterType: "VARCHAR" }],
  samples: {
    added: [{ key: { id: 3 }, after: { id: 3, value: "new" } }],
    removed: [{ key: { id: 2 }, before: { id: 2, value: 2 } }],
    changed: [
      {
        key: { id: 1 },
        before: { id: 1, value: 1 },
        after: { id: 1, value: "1" },
        changedColumns: ["value"],
      },
    ],
  },
  sampleLimit: 10,
  truncated: { added: false, removed: false, changed: false },
  durationMs: 12,
  warnings: [],
} as const;

describe("diff presentation", () => {
  it("renders a readable summary, schema section, and labelled samples", () => {
    const text = renderDiffHuman(result);
    expect(text).toContain("Experimental dataset diff");
    expect(text).toContain("1 added");
    expect(text).toContain("Schema changes");
    expect(text).toContain("Changed samples");
    expect(text).not.toContain("\u001b");
  });

  it("flattens structured streaming formats into deterministic events", () => {
    expect(diffEvents(result).map((event) => event.kind)).toEqual([
      "summary",
      "schema",
      "added",
      "removed",
      "changed",
    ]);
  });
});
