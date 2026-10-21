import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER ONLY — never import from client components.
 *
 * Its uses are deliberately narrow:
 *   1. streaming object bytes AFTER tv_authorize_document_access() approved,
 *   2. writing/reading audit rows through SECURITY DEFINER RPCs,
 *   3. admin bootstrap (seed script, signup user creation),
 *   4. deleting storage objects on purge.
 * It is never used to answer "does this user have access?" — that decision
 * belongs to tv_authorize_document_access() + RLS with the user's identity.
 */
let adminClient: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL missing (.env.local)"
    );
  }

  adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}
