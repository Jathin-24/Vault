/**
 * Escape user input used inside ilike patterns. Without this a search for
 * "%" or "_" matches everything (and "\"- breaks the pattern). Parameter
 * binding already prevents SQL injection — this prevents PATTERN injection.
 */
export function escapeIlike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Parsed-ISO-safe date for range filters: returns YYYY-MM-DD or null. */
export function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : value;
}
