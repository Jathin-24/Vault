/**
 * Single source of truth for Supabase environment variables.
 *
 * Supabase renamed the anon key to "publishable key" in newer dashboards, so
 * both env names are accepted here — every other module asks this one for
 * its config instead of reading process.env ad hoc (a mismatch between the
 * browser client and the server client is exactly the class of bug that
 * produces mysterious 401s).
 */

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Copy .env.example to .env.local and fill it in."
    );
  }
  return url;
}

/** Browser-facing key (anon key / publishable key — same value, new name). */
export function getSupabaseAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY (a.k.a. publishable key). " +
        "Copy .env.example to .env.local and fill it in."
    );
  }
  return key;
}

/** SERVER ONLY. Never import this from client components. */
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill it in."
    );
  }
  return key;
}
