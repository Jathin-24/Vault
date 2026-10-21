import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

/**
 * Server Supabase client bound to the request's cookies (anon key + user
 * session). Every query made with this client is filtered by Postgres RLS —
 * this is the "server decides" path for metadata reads/writes.
 */
export async function createServerSupabase() {
  // Touch the dynamic API FIRST: during a static-prerender attempt this makes
  // Next.js bail out to dynamic rendering instead of failing the build.
  const cookieStore = await cookies();

  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component: middleware refreshes sessions
          // instead. Safe to ignore here.
        }
      },
    },
  });
}
