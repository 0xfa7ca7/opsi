import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/profiles.js";
import type { QueryService, QueryServiceResult } from "../src/queries.js";

function queryResult(
  rows: QueryServiceResult["rows"],
  overrides: Partial<QueryServiceResult> = {},
): QueryServiceResult {
  return {
    columns: [
      "column_name",
      "column_type",
      "minimum",
      "maximum",
      "average",
      "row_count",
      "non_null_count",
      "distinct_count",
      "top_values",
    ],
    rows,
    returnedCount: rows.length,
    truncated: false,
    sql: "generated",
    source: "/tmp/data.csv",
    durationMs: 12,
    cache: { status: "hit", kind: "duckdb-stage" },
    warnings: [],
    ...overrides,
  };
}

function setup(result: QueryServiceResult) {
  const execute = vi.fn(async () => result);
  const service = new ProfileService({ execute } as unknown as QueryService);
  return { execute, service };
}

describe("ProfileService", () => {
  it("maps exact counts, rates, numeric summaries, and categorical top values", async () => {
    const { execute, service } = setup(
      queryResult([
        {
          column_name: "amount",
          column_type: "BIGINT",
          minimum: "1",
          maximum: "9007199254740993",
          average: "2.5",
          row_count: "4",
          non_null_count: "3",
          distinct_count: "3",
          top_values: [],
        },
        {
          column_name: "city",
          column_type: "VARCHAR",
          minimum: "Celje",
          maximum: "Žalec",
          average: null,
          row_count: "4",
          non_null_count: "3",
          distinct_count: "2",
          top_values: [
            { value: "Ljubljana", count: "2" },
            { value: "Celje", count: "1" },
          ],
        },
        {
          column_name: "active",
          column_type: "BOOLEAN",
          minimum: "false",
          maximum: "true",
          average: null,
          row_count: "4",
          non_null_count: "4",
          distinct_count: "2",
          top_values: [
            { value: "true", count: "3" },
            { value: "false", count: "1" },
          ],
        },
      ]),
    );

    await expect(service.execute("data.csv")).resolves.toMatchObject({
      source: "/tmp/data.csv",
      rowCount: 4,
      columnCount: 3,
      top: 5,
      fields: [
        {
          name: "amount",
          type: "BIGINT",
          rowCount: 4,
          nullCount: 1,
          nullRate: 0.25,
          distinctCount: 3,
          min: 1,
          max: "9007199254740993",
          mean: 2.5,
          topValues: [],
        },
        {
          name: "city",
          nullCount: 1,
          nullRate: 0.25,
          distinctCount: 2,
          min: "Celje",
          max: "Žalec",
          mean: null,
          topValues: [
            { value: "Ljubljana", count: 2, rate: 0.5 },
            { value: "Celje", count: 1, rate: 0.25 },
          ],
        },
        {
          name: "active",
          min: false,
          max: true,
          topValues: [
            { value: true, count: 3, rate: 0.75 },
            { value: false, count: 1, rate: 0.25 },
          ],
        },
      ],
      cache: { status: "hit", kind: "duckdb-stage" },
    });

    expect(execute).toHaveBeenCalledWith("data.csv", expect.objectContaining({ limit: 256 }));
    const options = execute.mock.calls[0]?.[1] as { sql: string };
    expect(options.sql).toContain("SUMMARIZE data");
    expect(options.sql).toContain("count(*) AS distinct_count");
    expect(options.sql).toContain("frequency DESC, value ASC");
    expect(options.sql).toContain("value_rank <= 5");
    expect(options.sql).toContain("column_type LIKE 'ENUM%'");
  });

  it("passes selectors, network controls, and query bounds to the existing query service", async () => {
    const { execute, service } = setup(queryResult([]));
    const signal = new AbortController().signal;

    await service.execute("archive.zip", {
      top: 2,
      timeoutMs: 123,
      memoryLimit: "256MB",
      threads: 2,
      sheet: "Data",
      entry: "rows.csv",
      recordPath: "/root/row",
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      signal,
    });

    expect(execute).toHaveBeenCalledWith("archive.zip", {
      sql: expect.stringContaining("value_rank <= 2"),
      limit: 256,
      timeoutMs: 123,
      memoryLimit: "256MB",
      threads: 2,
      sheet: "Data",
      entry: "rows.csv",
      recordPath: "/root/row",
      allowInsecureHttp: true,
      allowPrivateNetwork: true,
      signal,
    });
  });

  it.each([0, 21, 1.5, Number.NaN])("rejects top limit %s", async (top) => {
    const { execute, service } = setup(queryResult([]));

    await expect(service.execute("data.csv", { top })).rejects.toMatchObject({
      code: "PROFILE_TOP_LIMIT",
      exitCode: 2,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a profile wider than the column bound instead of returning partial data", async () => {
    const { service } = setup(queryResult([], { truncated: true }));

    await expect(service.execute("data.csv")).rejects.toMatchObject({
      code: "PROFILE_COLUMN_LIMIT",
      exitCode: 7,
      context: { maximum: 256 },
    });
  });

  it.each([
    { rows: [{ column_name: "city" }] },
    {
      rows: [
        {
          column_name: "city",
          column_type: "VARCHAR",
          minimum: null,
          maximum: null,
          average: null,
          row_count: "wrong",
          non_null_count: "0",
          distinct_count: "0",
          top_values: [],
        },
      ],
    },
    {
      rows: [
        {
          column_name: "city",
          column_type: "VARCHAR",
          minimum: null,
          maximum: null,
          average: null,
          row_count: "1",
          non_null_count: "2",
          distinct_count: "1",
          top_values: [],
        },
      ],
    },
    {
      rows: [
        {
          column_name: "city",
          column_type: "VARCHAR",
          minimum: "Ljubljana",
          maximum: "Ljubljana",
          average: null,
          row_count: "1",
          non_null_count: "1",
          distinct_count: "1",
          top_values: [{ value: "Ljubljana", count: "2" }],
        },
      ],
    },
  ])("rejects malformed worker profile rows %#", async ({ rows }) => {
    const { service } = setup(queryResult(rows));

    await expect(service.execute("data.csv")).rejects.toMatchObject({
      code: "PROFILE_RESULT_INVALID",
      exitCode: 7,
    });
  });

  it("returns a coherent zero-row profile", async () => {
    const { service } = setup(
      queryResult([
        {
          column_name: "city",
          column_type: "VARCHAR",
          minimum: null,
          maximum: null,
          average: null,
          row_count: "0",
          non_null_count: "0",
          distinct_count: "0",
          top_values: [],
        },
      ]),
    );

    await expect(service.execute("empty.csv")).resolves.toMatchObject({
      rowCount: 0,
      fields: [{ nullCount: 0, nullRate: 0, topValues: [] }],
    });
  });
});
