import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, type AuthedContext } from "@/lib/auth/requireUser";

export interface AdminContext extends AuthedContext {
  profile: { platform_role: "admin"; is_active: boolean };
}

/**
 * Admin gate. Reads profiles.platform_role through the user's own client
 * (profiles RLS allows self-read), so the claim comes from the database, not
 * from a cookie or a JWT field the client controls.
 *
 * NOTE: being admin grants metadata + audit visibility, NOT content access.
 * Content for admins goes through the audited break-glass path only.
 */
export async function requireAdmin(): Promise<
  AdminContext | { error: NextResponse }
> {
  const base = await requireUser();
  if ("error" in base) return base;

  const { user, supabase } = base;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("platform_role, is_active")
    .eq("id", user.id)
    .single();

  if (error || !profile || profile.platform_role !== "admin" || !profile.is_active) {
    return {
      error: NextResponse.json(
        { error: "Administrator role required." },
        { status: 403 }
      ),
    };
  }

  return {
    user,
    supabase,
    profile: profile as AdminContext["profile"],
  };
}

export type { SupabaseClient };
