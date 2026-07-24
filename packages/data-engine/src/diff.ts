import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXIT_CODES,
  KlopsiError,
  type DataDiffRowSample,
  type DataDiffSchemaChange,
  type DataDiffSummary,
  type DataRow,
} from "@klopsi/domain";
import { DuckDbQueryRunner } from "./query.js";
import { sqlIdentifier } from "./sql-identifier.js";
import { stageTabularInput, type StagedColumn, type TabularStage } from "./tabular-stage.js";
import type { DataInput, ValidationIssue } from "./types.js";

export const DEFAULT_DIFF_SAMPLE_LIMIT = 10;
export const MAX_DIFF_SAMPLE_LIMIT = 100;
export const MAX_DIFF_COLUMNS = 256;

export interface DatasetDiffOptions {
  readonly before: DataInput;
  readonly after: DataInput;
  readonly key: readonly string[];
  readonly sampleLimit?: number;
  readonly beforeSheet?: string;
  readonly afterSheet?: string;
  readonly beforeRecordPath?: string;
  readonly afterRecordPath?: string;
  readonly timeoutMs?: number;
  readonly memoryLimit?: string;
  readonly threads?: number;
  readonly signal?: AbortSignal;
}

export interface DatasetDiffEngineResult {
  readonly key: readonly string[];
  readonly summary: DataDiffSummary;
  readonly schema: readonly DataDiffSchemaChange[];
  readonly samples: {
    readonly added: readonly DataDiffRowSample[];
    readonly removed: readonly DataDiffRowSample[];
    readonly changed: readonly DataDiffRowSample[];
  };
  readonly sampleLimit: number;
  readonly truncated: {
    readonly added: boolean;
    readonly removed: boolean;
    readonly changed: boolean;
  };
  readonly warnings: readonly ValidationIssue[];
}

export interface DatasetDiffEngineOptions {
  readonly runner: Pick<DuckDbQueryRunner, "executePrepared">;
  readonly stage?: typeof stageTabularInput;
  readonly makeTemporaryDirectory?: () => Promise<string>;
  readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
}

interface KeyQuality {
  readonly side: "before" | "after";
  readonly totalRows: number;
  readonly nullKeyRows: number;
  readonly duplicateKeyGroups: number;
  readonly duplicateKeyRows: number;
}

type DifferenceKind = "added" | "removed" | "changed" | "unchanged";

function normalizedKeys(key: readonly string[]): readonly string[] {
  const result: string[] = [];
  for (const raw of key) {
    for (const candidate of raw.split(",").map((value) => value.trim())) {
      if (candidate.length > 0 && !result.includes(candidate)) result.push(candidate);
    }
  }
  if (result.length === 0)
    throw new KlopsiError({
      code: "DIFF_KEY_REQUIRED",
      message: "At least one key column is required for a semantic dataset diff.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      suggestion: "Pass --key with a column that uniquely identifies each row.",
    });
  return result;
}

function sampleBound(value: number | undefined): number {
  const limit = value ?? DEFAULT_DIFF_SAMPLE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DIFF_SAMPLE_LIMIT)
    throw new KlopsiError({
      code: "DIFF_LIMIT_INVALID",
      message: `Diff sample limit must be an integer from 1 through ${MAX_DIFF_SAMPLE_LIMIT}.`,
      exitCode: EXIT_CODES.INVALID_INPUT,
      context: { value: limit, maximum: MAX_DIFF_SAMPLE_LIMIT },
    });
  return limit;
}

function safeCount(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new KlopsiError({
      code: "DIFF_COUNT_INVALID",
      message: "DuckDB returned a comparison count outside JavaScript's safe integer range.",
      exitCode: EXIT_CODES.QUERY_FAILURE,
      context: { label },
    });
  return parsed;
}

function columnsByName(columns: readonly StagedColumn[]): ReadonlyMap<string, StagedColumn> {
  return new Map(columns.map((column) => [column.name, column]));
}

function validateColumnShape(
  before: readonly StagedColumn[],
  after: readonly StagedColumn[],
  key: readonly string[],
): void {
  if (before.length > MAX_DIFF_COLUMNS || after.length > MAX_DIFF_COLUMNS)
    throw new KlopsiError({
      code: "DIFF_COLUMN_LIMIT",
      message: `Dataset diff supports at most ${MAX_DIFF_COLUMNS} columns per input.`,
      exitCode: EXIT_CODES.QUERY_FAILURE,
      context: {
        beforeColumns: before.length,
        afterColumns: after.length,
        maximum: MAX_DIFF_COLUMNS,
      },
    });
  const beforeByName = columnsByName(before);
  const afterByName = columnsByName(after);
  const missingBefore = key.filter((column) => !beforeByName.has(column));
  const missingAfter = key.filter((column) => !afterByName.has(column));
  if (missingBefore.length > 0 || missingAfter.length > 0)
    throw new KlopsiError({
      code: "DIFF_KEY_NOT_FOUND",
      message: "Every diff key column must exist exactly in both inputs.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      context: {
        ...(missingBefore.length === 0 ? {} : { before: missingBefore }),
        ...(missingAfter.length === 0 ? {} : { after: missingAfter }),
      },
    });
}

function validateKeyTypes(
  before: readonly StagedColumn[],
  after: readonly StagedColumn[],
  key: readonly string[],
): void {
  const beforeByName = columnsByName(before);
  const afterByName = columnsByName(after);
  for (const column of key) {
    const beforeType = beforeByName.get(column)?.type;
    const afterType = afterByName.get(column)?.type;
    if (beforeType !== afterType)
      throw new KlopsiError({
        code: "DIFF_KEY_TYPE_MISMATCH",
        message: `Diff key column '${column}' has different inferred types.`,
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { column, beforeType, afterType },
      });
  }
}

function schemaChanges(
  before: readonly StagedColumn[],
  after: readonly StagedColumn[],
): readonly DataDiffSchemaChange[] {
  const afterByName = columnsByName(after);
  const beforeByName = columnsByName(before);
  const changes: DataDiffSchemaChange[] = [];
  for (const column of before) {
    const next = afterByName.get(column.name);
    if (next === undefined)
      changes.push({ column: column.name, change: "removed", beforeType: column.type });
    else if (next.type !== column.type)
      changes.push({
        column: column.name,
        change: "type-changed",
        beforeType: column.type,
        afterType: next.type,
      });
  }
  for (const column of after) {
    if (!beforeByName.has(column.name))
      changes.push({ column: column.name, change: "added", afterType: column.type });
  }
  return changes;
}

function keyQualitySql(
  tableName: "before_data" | "after_data",
  side: string,
  key: readonly string[],
) {
  const table = sqlIdentifier(tableName);
  const keys = key.map(sqlIdentifier);
  const anyNull = keys.map((column) => `${column} IS NULL`).join(" OR ");
  const allPresent = keys.map((column) => `${column} IS NOT NULL`).join(" AND ");
  const groupColumns = keys.join(", ");
  const duplicateGroups = `(
    SELECT count(*) FROM (
      SELECT ${groupColumns}
      FROM ${table}
      WHERE ${allPresent}
      GROUP BY ${groupColumns}
      HAVING count(*) > 1
    ) AS duplicate_groups
  )`;
  const duplicateRows = `(
    SELECT coalesce(sum(group_rows), 0) FROM (
      SELECT count(*) AS group_rows
      FROM ${table}
      WHERE ${allPresent}
      GROUP BY ${groupColumns}
      HAVING count(*) > 1
    ) AS duplicate_rows
  )`;
  return `SELECT '${side}' AS side,
    count(*)::VARCHAR AS total_rows,
    count(*) FILTER (WHERE ${anyNull})::VARCHAR AS null_key_rows,
    ${duplicateGroups}::VARCHAR AS duplicate_key_groups,
    ${duplicateRows}::VARCHAR AS duplicate_key_rows
  FROM ${table}`;
}

function qualitySql(key: readonly string[]): string {
  return `${keyQualitySql("before_data", "before", key)}
UNION ALL
${keyQualitySql("after_data", "after", key)}
ORDER BY side`;
}

function comparisonSql(
  key: readonly string[],
  commonValueColumns: readonly string[],
  sampleLimit: number,
): string {
  const firstKey = sqlIdentifier(key[0] as string);
  const join = key
    .map((column) => `before_row.${sqlIdentifier(column)} = after_row.${sqlIdentifier(column)}`)
    .join(" AND ");
  const changed =
    commonValueColumns.length === 0
      ? "false"
      : commonValueColumns
          .map(
            (column) =>
              `to_json(before_row.${sqlIdentifier(column)}) IS DISTINCT FROM to_json(after_row.${sqlIdentifier(column)})`,
          )
          .join(" OR ");
  return `WITH joined AS (
  SELECT
    CASE
      WHEN before_row.${firstKey} IS NULL THEN 'added'
      WHEN after_row.${firstKey} IS NULL THEN 'removed'
      WHEN ${changed} THEN 'changed'
      ELSE 'unchanged'
    END AS kind,
    before_row AS before_record,
    after_row AS after_record,
    ${key
      .map(
        (column, index) =>
          `coalesce(before_row.${sqlIdentifier(column)}, after_row.${sqlIdentifier(column)}) AS diff_key_${index}`,
      )
      .join(",\n    ")}
  FROM ${sqlIdentifier("before_data")} AS before_row
  FULL OUTER JOIN ${sqlIdentifier("after_data")} AS after_row ON ${join}
),
classified AS (
  SELECT *,
    count(*) OVER (PARTITION BY kind)::VARCHAR AS total,
    row_number() OVER (
      PARTITION BY kind
      ORDER BY ${key.map((_column, index) => `diff_key_${index} ASC NULLS FIRST`).join(", ")}
    ) AS sample_index
  FROM joined
),
kinds(kind, kind_order) AS (
  VALUES ('added', 1), ('removed', 2), ('changed', 3), ('unchanged', 4)
),
records AS (
  SELECT
    'count' AS record_type,
    kinds.kind,
    kinds.kind_order,
    0::BIGINT AS sample_index,
    coalesce(max(classified.total), '0') AS total,
    NULL::VARCHAR AS before_json,
    NULL::VARCHAR AS after_json
  FROM kinds
  LEFT JOIN classified ON classified.kind = kinds.kind
  GROUP BY kinds.kind, kinds.kind_order
  UNION ALL
  SELECT
    'sample' AS record_type,
    kind,
    CASE kind WHEN 'added' THEN 1 WHEN 'removed' THEN 2 ELSE 3 END AS kind_order,
    sample_index,
    total,
    to_json(before_record) AS before_json,
    to_json(after_record) AS after_json
  FROM classified
  WHERE kind <> 'unchanged' AND sample_index <= ${sampleLimit}
)
SELECT record_type, kind, total, before_json, after_json
FROM records
ORDER BY record_type, kind_order, sample_index`;
}

function parseRow(value: unknown, label: string): DataRow {
  if (typeof value !== "string")
    throw new KlopsiError({
      code: "DIFF_RESULT_INVALID",
      message: "DuckDB returned an invalid dataset diff sample.",
      exitCode: EXIT_CODES.QUERY_FAILURE,
      context: { label },
    });
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new KlopsiError({
      code: "DIFF_RESULT_INVALID",
      message: "DuckDB returned an invalid dataset diff sample.",
      exitCode: EXIT_CODES.QUERY_FAILURE,
      context: { label },
    });
  return parsed as DataRow;
}

function sampleKey(row: DataRow, key: readonly string[]): DataRow {
  return Object.fromEntries(key.map((column) => [column, row[column] ?? null]));
}

function valueChanged(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export class DatasetDiffEngine {
  constructor(private readonly options: DatasetDiffEngineOptions) {}

  async compare(options: DatasetDiffOptions): Promise<DatasetDiffEngineResult> {
    const key = normalizedKeys(options.key);
    const sampleLimit = sampleBound(options.sampleLimit);
    let directory: string | undefined;
    let stage: TabularStage | undefined;
    let operationError: unknown;
    let result: DatasetDiffEngineResult | undefined;
    try {
      directory = await (this.options.makeTemporaryDirectory?.() ??
        mkdtemp(join(tmpdir(), "klopsi-diff-")));
      const databasePath = join(directory, "diff.duckdb");
      const stageInput = async (
        input: DataInput,
        tableName: "before_data" | "after_data",
        sheet: string | undefined,
        recordPath: string | undefined,
      ): Promise<{
        readonly columns: readonly StagedColumn[];
        readonly warnings: readonly ValidationIssue[];
      }> => {
        stage = await (this.options.stage ?? stageTabularInput)({
          input,
          databasePath,
          tableName,
          xlsxRowsPath: join(directory as string, `${tableName}.ndjson`),
          xlsxSharedStringsByteLimit: 64 * 1024 * 1024,
          preserveDatabaseOnClose: true,
          ...(sheet === undefined ? {} : { sheet }),
          ...(recordPath === undefined ? {} : { recordPath }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        const staged = { columns: stage.columns, warnings: stage.warnings };
        await stage.connection.run("CHECKPOINT");
        await stage.close();
        stage = undefined;
        return staged;
      };
      const beforeStage = await stageInput(
        options.before,
        "before_data",
        options.beforeSheet,
        options.beforeRecordPath,
      );
      const afterStage = await stageInput(
        options.after,
        "after_data",
        options.afterSheet,
        options.afterRecordPath,
      );
      validateColumnShape(beforeStage.columns, afterStage.columns, key);
      const schema = schemaChanges(beforeStage.columns, afterStage.columns);
      const executionOptions = {
        databasePath,
        invocationDirectory: directory,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.memoryLimit === undefined ? {} : { memoryLimit: options.memoryLimit }),
        ...(options.threads === undefined ? {} : { threads: options.threads }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      };
      const qualityResult = await this.options.runner.executePrepared({
        ...executionOptions,
        sql: qualitySql(key),
        rowLimit: 2,
      });
      const quality = qualityResult.rows.map((row): KeyQuality => ({
        side: row.side === "before" ? "before" : "after",
        totalRows: safeCount(row.total_rows, "total_rows"),
        nullKeyRows: safeCount(row.null_key_rows, "null_key_rows"),
        duplicateKeyGroups: safeCount(row.duplicate_key_groups, "duplicate_key_groups"),
        duplicateKeyRows: safeCount(row.duplicate_key_rows, "duplicate_key_rows"),
      }));
      const beforeQuality = quality.find((entry) => entry.side === "before");
      const afterQuality = quality.find((entry) => entry.side === "after");
      if (beforeQuality === undefined || afterQuality === undefined)
        throw new KlopsiError({
          code: "DIFF_RESULT_INVALID",
          message: "DuckDB did not return key diagnostics for both diff inputs.",
          exitCode: EXIT_CODES.QUERY_FAILURE,
        });
      if (beforeQuality.nullKeyRows > 0 || afterQuality.nullKeyRows > 0)
        throw new KlopsiError({
          code: "DIFF_NULL_KEY",
          message: "Diff key columns must not contain null values.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
          context: {
            before: { nullKeyRows: beforeQuality.nullKeyRows },
            after: { nullKeyRows: afterQuality.nullKeyRows },
          },
        });
      if (beforeQuality.duplicateKeyGroups > 0 || afterQuality.duplicateKeyGroups > 0)
        throw new KlopsiError({
          code: "DIFF_DUPLICATE_KEY",
          message: "Diff key columns must uniquely identify every row.",
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
          context: {
            before: {
              duplicateKeyGroups: beforeQuality.duplicateKeyGroups,
              duplicateKeyRows: beforeQuality.duplicateKeyRows,
            },
            after: {
              duplicateKeyGroups: afterQuality.duplicateKeyGroups,
              duplicateKeyRows: afterQuality.duplicateKeyRows,
            },
          },
        });
      validateKeyTypes(beforeStage.columns, afterStage.columns, key);

      const afterByName = columnsByName(afterStage.columns);
      const commonValueColumns = beforeStage.columns
        .map((column) => column.name)
        .filter((column) => afterByName.has(column) && !key.includes(column));
      const comparison = await this.options.runner.executePrepared({
        ...executionOptions,
        sql: comparisonSql(key, commonValueColumns, sampleLimit),
        rowLimit: 4 + sampleLimit * 3,
      });
      const totals = new Map<DifferenceKind, number>();
      const samples: {
        added: DataDiffRowSample[];
        removed: DataDiffRowSample[];
        changed: DataDiffRowSample[];
      } = { added: [], removed: [], changed: [] };
      for (const row of comparison.rows) {
        const kind = row.kind as DifferenceKind;
        if (!["added", "removed", "changed", "unchanged"].includes(kind))
          throw new KlopsiError({
            code: "DIFF_RESULT_INVALID",
            message: "DuckDB returned an unknown dataset diff category.",
            exitCode: EXIT_CODES.QUERY_FAILURE,
          });
        if (row.record_type === "count") {
          totals.set(kind, safeCount(row.total, `${kind}_total`));
          continue;
        }
        if (kind === "unchanged") continue;
        const beforeRow = parseRow(row.before_json, "before_json");
        const afterRow = parseRow(row.after_json, "after_json");
        const sourceRow = kind === "added" ? afterRow : beforeRow;
        if (kind === "added")
          samples.added.push({ key: sampleKey(sourceRow, key), after: afterRow });
        else if (kind === "removed")
          samples.removed.push({ key: sampleKey(sourceRow, key), before: beforeRow });
        else
          samples.changed.push({
            key: sampleKey(sourceRow, key),
            before: beforeRow,
            after: afterRow,
            changedColumns: commonValueColumns.filter((column) =>
              valueChanged(beforeRow[column], afterRow[column]),
            ),
          });
      }
      const added = totals.get("added") ?? 0;
      const removed = totals.get("removed") ?? 0;
      const changed = totals.get("changed") ?? 0;
      const unchanged = totals.get("unchanged") ?? 0;
      result = {
        key,
        summary: {
          beforeRows: beforeQuality.totalRows,
          afterRows: afterQuality.totalRows,
          added,
          removed,
          changed,
          unchanged,
          schemaChanges: schema.length,
        },
        schema,
        samples,
        sampleLimit,
        truncated: {
          added: added > samples.added.length,
          removed: removed > samples.removed.length,
          changed: changed > samples.changed.length,
        },
        warnings: [...beforeStage.warnings, ...afterStage.warnings],
      };
    } catch (error) {
      operationError = error;
    } finally {
      const failures: unknown[] = [];
      if (stage !== undefined) {
        try {
          await stage.close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (directory !== undefined) {
        try {
          await (this.options.removeTemporaryDirectory?.(directory) ??
            rm(directory, { recursive: true, force: true }));
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        operationError = new KlopsiError({
          code: "QUERY_CLEANUP_FAILED",
          message: "Dataset diff resources could not be fully cleaned up.",
          exitCode: EXIT_CODES.QUERY_FAILURE,
          context: { failureCount: failures.length },
          cause: new AggregateError(
            operationError === undefined ? failures : [operationError, ...failures],
            "Dataset diff and cleanup failures",
          ),
        });
    }
    if (operationError !== undefined) throw operationError;
    if (result === undefined)
      throw new KlopsiError({
        code: "DIFF_RESULT_INVALID",
        message: "Dataset diff completed without a result.",
        exitCode: EXIT_CODES.QUERY_FAILURE,
      });
    return result;
  }
}
