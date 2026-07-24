import { describe, expect, it, vi } from "vitest";
import { DiffService } from "../src/diffs.js";

describe("DiffService", () => {
  it("keeps both resolved input leases alive and forwards side-specific selections", async () => {
    const active = new Set<string>();
    const resolutions: Array<{ input: string; options: unknown }> = [];
    const data = {
      async withResolvedInput<T>(
        input: string,
        options: unknown,
        operation: (source: { path: string }) => Promise<T>,
      ): Promise<T> {
        resolutions.push({ input, options });
        active.add(input);
        try {
          return await operation({ path: `/resolved/${input}.csv` });
        } finally {
          active.delete(input);
        }
      },
    };
    const compare = vi.fn(async () => {
      expect(active).toEqual(new Set(["old", "new"]));
      return {
        key: ["id"],
        summary: {
          beforeRows: 1,
          afterRows: 1,
          added: 0,
          removed: 0,
          changed: 0,
          unchanged: 1,
          schemaChanges: 0,
        },
        schema: [],
        samples: { added: [], removed: [], changed: [] },
        sampleLimit: 10,
        truncated: { added: false, removed: false, changed: false },
        warnings: [],
      };
    });
    const service = new DiffService(data as never, { compare } as never);

    const result = await service.compare("old", "new", {
      key: ["id"],
      sampleLimit: 10,
      beforeSheet: "Sheet 1",
      afterRecordPath: "/rows/row",
      allowPrivateNetwork: true,
    });

    expect(resolutions).toEqual([
      {
        input: "old",
        options: { allowPrivateNetwork: true },
      },
      {
        input: "new",
        options: { recordPath: "/rows/row", allowPrivateNetwork: true },
      },
    ]);
    expect(compare).toHaveBeenCalledWith({
      before: { path: "/resolved/old.csv" },
      after: { path: "/resolved/new.csv" },
      key: ["id"],
      sampleLimit: 10,
      beforeSheet: "Sheet 1",
      afterRecordPath: "/rows/row",
    });
    expect(result).toMatchObject({
      before: "/resolved/old.csv",
      after: "/resolved/new.csv",
      key: ["id"],
      durationMs: expect.any(Number),
    });
  });
});
