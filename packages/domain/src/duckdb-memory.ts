const UNIT_BYTES: Readonly<Record<string, number>> = {
  B: 1,
  KB: 1_000,
  MB: 1_000_000,
  GB: 1_000_000_000,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
};

export const MAX_DUCKDB_MEMORY_BYTES = 1024 ** 3;

export function duckDbMemoryLimitBytes(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|KiB|MiB|GiB)$/iu.exec(value.trim());
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]?.toUpperCase();
  const multiplier = unit === undefined ? undefined : UNIT_BYTES[unit];
  if (!Number.isFinite(amount) || amount <= 0 || multiplier === undefined) return undefined;
  const bytes = amount * multiplier;
  return Number.isSafeInteger(bytes) && bytes <= MAX_DUCKDB_MEMORY_BYTES ? bytes : undefined;
}
