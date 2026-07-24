export function sqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
