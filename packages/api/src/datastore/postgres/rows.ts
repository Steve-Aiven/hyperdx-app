/** Drops null/undefined entries so absent columns read like unset Mongo fields. */
export function definedOnly<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value != null),
  ) as { [K in keyof T]?: NonNullable<T[K]> };
}

/** jsonb round-trips Dates as ISO strings; revive them on read. */
export function reviveDate(value: unknown): Date | undefined {
  if (value == null) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

/** Builds `col = $n` fragments for a partial update, skipping undefined. */
export function buildSet(
  columns: Record<string, unknown>,
  startIndex = 1,
): { clause: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) {
      continue;
    }
    values.push(value);
    parts.push(`${column} = $${startIndex + values.length - 1}`);
  }
  return { clause: parts.join(', '), values };
}

/** node-pg turns JS arrays into PG arrays, so jsonb params must be stringified. */
export function json(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}
