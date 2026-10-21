import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getServiceRoleKey } from "@/lib/supabase/env";

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

  const url = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();

  adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}
