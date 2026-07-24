import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import type { DataRow } from "@klopsi/data-engine";
import type { QueryCacheMetadata, QueryCacheWarning } from "./query-database-cache.js";
import type { QueryService } from "./queries.js";

export const DEFAULT_PROFILE_TOP = 5;
export const MAX_PROFILE_TOP = 20;
export const MAX_PROFILE_COLUMNS = 256;

export interface ProfileTopValue {
  readonly value: string | number | boolean;
  readonly count: number;
  readonly rate: number;
}

export interface FieldProfile {
  readonly name: string;
  readonly type: string;
  readonly rowCount: number;
  readonly nullCount: number;
  readonly nullRate: number;
  readonly distinctCount: number;
  readonly min: string | number | boolean | null;
  readonly max: string | number | boolean | null;
  readonly mean: string | number | null;
  readonly topValues: readonly ProfileTopValue[];
}

export interface ProfileServiceOptions {
  readonly top?: number;
  readonly timeoutMs?: number;
  readonly memoryLimit?: string;
  readonly threads?: number;
  readonly sheet?: string;
  readonly entry?: string;
  readonly recordPath?: string;
  readonly allowInsecureHttp?: boolean;
  readonly allowPrivateNetwork?: boolean;
  readonly signal?: AbortSignal;
}

export interface ProfileServiceResult {
  readonly fields: readonly FieldProfile[];
  readonly source: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly top: number;
  readonly durationMs: number;
  readonly cache: QueryCacheMetadata;
  readonly warnings: readonly QueryCacheWarning[];
}

function profileError(message: string, context?: Readonly<Record<string, unknown>>): KlopsiError {
  return new KlopsiError({
    code: "PROFILE_RESULT_INVALID",
    message,
    exitCode: EXIT_CODES.QUERY_FAILURE,
    ...(context === undefined ? {} : { context }),
  });
}

function profileSql(top: number): string {
  return `WITH
summary AS (
  SELECT summarized.*, row_number() OVER () AS column_order
  FROM (SUMMARIZE data) AS summarized
),
long_values AS (
  SELECT column_name, value
  FROM (
    UNPIVOT (
      SELECT COLUMNS(*)::VARCHAR
      FROM data
    )
    ON COLUMNS(*)
    INTO NAME column_name VALUE value
  )
),
frequencies AS (
  SELECT column_name, value, count(*) AS frequency
  FROM long_values
  GROUP BY ALL
),
column_counts AS (
  SELECT
    column_name,
    sum(frequency) AS non_null_count,
    count(*) AS distinct_count
  FROM frequencies
  GROUP BY column_name
),
ranked AS (
  SELECT
    frequencies.*,
    row_number() OVER (
      PARTITION BY column_name
      ORDER BY frequency DESC, value ASC
    ) AS value_rank
  FROM frequencies
  JOIN summary USING (column_name)
  WHERE column_type = 'VARCHAR'
     OR column_type = 'BOOLEAN'
     OR column_type LIKE 'ENUM%'
),
top_values AS (
  SELECT
    column_name,
    list(
      struct_pack(value := value, count := frequency)
      ORDER BY value_rank
    ) FILTER (WHERE value_rank <= ${top}) AS values
  FROM ranked
  GROUP BY column_name
)
SELECT
  summary.column_name,
  summary.column_type,
  summary.min AS minimum,
  summary.max AS maximum,
  summary.avg AS average,
  summary.count AS row_count,
  coalesce(column_counts.non_null_count, 0) AS non_null_count,
  coalesce(column_counts.distinct_count, 0) AS distinct_count,
  coalesce(top_values.values, []) AS top_values
FROM summary
LEFT JOIN column_counts USING (column_name)
LEFT JOIN top_values USING (column_name)
ORDER BY summary.column_order`;
}

function nonnegativeInteger(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw profileError(`The profile worker returned an invalid ${field}.`, { field });
  return parsed;
}

function scalar(value: unknown, type: string): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    throw profileError("The profile worker returned an invalid summary value.");
  if (typeof value !== "string") return value;
  if (type === "BOOLEAN") {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }
  if (!/^(?:U?(?:TINY|SMALL|BIG|HUGE)?INT|FLOAT|DOUBLE|DECIMAL)/u.test(type)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  if (/^(?:U?(?:TINY|SMALL|BIG|HUGE)?INT)/u.test(type) && !Number.isSafeInteger(parsed))
    return value;
  return parsed;
}

function mean(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value !== "string")
    throw profileError("The profile worker returned an invalid average.");
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER ? parsed : value;
}

function fieldProfile(row: DataRow): FieldProfile {
  const name = row.column_name;
  const type = row.column_type;
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    typeof type !== "string" ||
    type.length === 0
  )
    throw profileError("The profile worker returned invalid column metadata.");
  const rowCount = nonnegativeInteger(row.row_count, "row count");
  const nonNullCount = nonnegativeInteger(row.non_null_count, "non-null count");
  const distinctCount = nonnegativeInteger(row.distinct_count, "distinct count");
  if (nonNullCount > rowCount || distinctCount > nonNullCount)
    throw profileError("The profile worker returned inconsistent field counts.", { name });
  if (!Array.isArray(row.top_values))
    throw profileError("The profile worker returned invalid top values.", { name });
  const topValues = row.top_values.map((item): ProfileTopValue => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw profileError("The profile worker returned an invalid top value.", { name });
    const record = item as Readonly<Record<string, unknown>>;
    const count = nonnegativeInteger(record.count, "top-value count");
    if (count > nonNullCount)
      throw profileError("The profile worker returned an inconsistent top-value count.", { name });
    const converted = scalar(record.value, type);
    if (converted === null)
      throw profileError("The profile worker returned a null top value.", { name });
    return {
      value: converted,
      count,
      rate: rowCount === 0 ? 0 : count / rowCount,
    };
  });
  if (topValues.reduce((total, item) => total + item.count, 0) > nonNullCount)
    throw profileError("The profile worker returned inconsistent top-value totals.", { name });
  const nullCount = rowCount - nonNullCount;
  return {
    name,
    type,
    rowCount,
    nullCount,
    nullRate: rowCount === 0 ? 0 : nullCount / rowCount,
    distinctCount,
    min: scalar(row.minimum, type),
    max: scalar(row.maximum, type),
    mean: mean(row.average),
    topValues,
  };
}

export class ProfileService {
  constructor(private readonly query: QueryService) {}

  async execute(input: string, options: ProfileServiceOptions = {}): Promise<ProfileServiceResult> {
    const top = options.top ?? DEFAULT_PROFILE_TOP;
    if (!Number.isSafeInteger(top) || top < 1 || top > MAX_PROFILE_TOP)
      throw new KlopsiError({
        code: "PROFILE_TOP_LIMIT",
        message: `top must be an integer from 1 through ${MAX_PROFILE_TOP}.`,
        exitCode: EXIT_CODES.INVALID_INPUT,
        context: { value: top, maximum: MAX_PROFILE_TOP },
      });
    const result = await this.query.execute(input, {
      sql: profileSql(top),
      limit: MAX_PROFILE_COLUMNS,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.memoryLimit === undefined ? {} : { memoryLimit: options.memoryLimit }),
      ...(options.threads === undefined ? {} : { threads: options.threads }),
      ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
      ...(options.entry === undefined ? {} : { entry: options.entry }),
      ...(options.recordPath === undefined ? {} : { recordPath: options.recordPath }),
      ...(options.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
      ...(options.allowPrivateNetwork === undefined
        ? {}
        : { allowPrivateNetwork: options.allowPrivateNetwork }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (result.truncated)
      throw new KlopsiError({
        code: "PROFILE_COLUMN_LIMIT",
        message: `The input has more than ${MAX_PROFILE_COLUMNS} columns.`,
        exitCode: EXIT_CODES.QUERY_FAILURE,
        context: { maximum: MAX_PROFILE_COLUMNS },
      });
    const fields = result.rows.map(fieldProfile);
    const rowCount = fields[0]?.rowCount ?? 0;
    if (fields.some((field) => field.rowCount !== rowCount))
      throw profileError("The profile worker returned inconsistent row counts.");
    return {
      fields,
      source: result.source,
      rowCount,
      columnCount: fields.length,
      top,
      durationMs: result.durationMs,
      cache: result.cache,
      warnings: result.warnings,
    };
  }
}
