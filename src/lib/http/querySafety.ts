/**
 * Escape user input used inside ilike patterns. Without this a search for
 * "%" or "_" matches everything (and "\"- breaks the pattern). Parameter
 * binding already prevents SQL injection — this prevents PATTERN injection.
 */
export function escapeIlike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Quote a value for PostgREST's `.or()` logic-tree syntax.
 *
 * Without quotes, a search term containing PostgREST-reserved characters
 * (`,`, `(`, `)`, `"`, ...) breaks the filter parser (PGRST100 → 500).
 * Inside double quotes only two escapes exist: `\"` for a quote and `\\`
 * for a backslash — so the value must be passed through AFTER escapeIlike
 * (which itself uses backslashes) to keep the LIKE pattern intact.
 */
export function quoteOrValue(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/**
 * True when a PostgREST failure was caused by the search TERM we sent,
 * not by our code or the database:
 *   - PGRST100: PostgREST could not parse our filter string;
 *   - a CDN/WAF HTML page: the edge blocked a term that LOOKS like an
 *     attack (e.g. `1; drop table documents;--`) before it reached Postgres.
 * Such a search cannot be asked about, so it must match nothing — never 500.
 */
export function isTermCausedSearchError(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error.code === "PGRST100") return true;
  const message = error.message ?? "";
  return /<!DOCTYPE|cloudflare|cf-error/i.test(message);
}

/** Parsed-ISO-safe date for range filters: returns YYYY-MM-DD or null. */
export function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : value;
}
