import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { badRequest, handleRouteError } from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";

export const runtime = "nodejs";

/**
 * GET /api/me — the signed-in profile (email, name, role, active flag).
 * who may call: any authenticated user (their own row via RLS).
 */
export async function GET() {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, platform_role, is_active, created_at")
      .eq("id", user.id)
      .single();
    if (error) throw error;

    return NextResponse.json({ profile });
  } catch (err) {
    return handleRouteError(err, "GET /api/me");
  }
}

/**
 * PATCH /api/me — rename self.
 * who may call: any authenticated user. Role/active flags are NOT settable
 * here (no profile UPDATE policy exists; only admin RPCs can change them).
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const body = await request.json().catch(() => null);
    const fullName = String(body?.fullName ?? "").trim();
    if (fullName.length > 120 || /\p{Cc}/u.test(fullName)) {
      return badRequest("Name must be at most 120 characters.");
    }

    const { error } = await supabase.rpc("tv_update_my_profile", {
      p_full_name: fullName,
    });
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, "PATCH /api/me");
  }
}
