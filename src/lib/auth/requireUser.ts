import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export interface AuthedContext {
  /** Verified authenticated user (getUser() checks the JWT server-side). */
  user: User;
  /** RLS-bound client for all data access in this request. */
  supabase: SupabaseClient;
}

/**
 * Gate for API routes. Authentication ONLY — authorisation is enforced by
 * RLS on every query and by tv_authorize_document_access() for content, so a
 * route that forgets a bespoke check still cannot leak rows.
 *
 * Note: supabase.auth.getUser() validates the JWT with Supabase Auth (we do
 * not trust cookie contents alone via getSession()).
 */
export async function requireUser(): Promise<
  AuthedContext | { error: NextResponse }
> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      error: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  return { user, supabase };
}
