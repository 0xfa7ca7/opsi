const MULTIPLIERS = {
  B: 1n,
  KB: 1_000n,
  MB: 1_000_000n,
  GB: 1_000_000_000n,
  KiB: 1_024n,
  MiB: 1_048_576n,
  GiB: 1_073_741_824n,
} as const;

export function parseStorageBytes(value: string): number | undefined {
  const match = /^(0|[1-9]\d*)(B|KB|MB|GB|KiB|MiB|GiB)$/u.exec(value);
  if (match === null) return undefined;
  const amount = match[1];
  const unit = match[2] as keyof typeof MULTIPLIERS | undefined;
  if (amount === undefined || unit === undefined) return undefined;
  const bytes = BigInt(amount) * MULTIPLIERS[unit];
  return bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : undefined;
}
