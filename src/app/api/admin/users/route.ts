import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { badRequest, handleRouteError } from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/users — directory (id, email, name, role, active flag).
 * who may call: platform admin ONLY.
 */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, platform_role, is_active, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;

    return NextResponse.json({ users: data ?? [] });
  } catch (err) {
    return handleRouteError(err, "GET /api/admin/users");
  }
}

/**
 * PATCH /api/admin/users — change role / deactivate (the leaver switch)
 * who may call: platform admin ONLY. Enforced again inside the RPCs, which
 * also write the audit event. Deactivation cuts all access on next request
 * because every authorisation decision checks profiles.is_active.
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }
    const ctx = await requireAdmin();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const body = await request.json().catch(() => null);
    const userId = String(body?.userId ?? "");
    if (!UUID_RE.test(userId)) return badRequest("Invalid userId.");

    if (body?.platformRole !== undefined) {
      const role = String(body.platformRole);
      if (role !== "user" && role !== "admin") return badRequest("Invalid role.");
      const { error } = await supabase.rpc("tv_set_platform_role", {
        p_user_id: userId,
        p_role: role,
      });
      if (error) throw error;
    }

    if (body?.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") return badRequest("Invalid isActive.");
      const { error } = await supabase.rpc("tv_set_user_active", {
        p_user_id: userId,
        p_active: body.isActive,
      });
      if (error) throw error;
    }

    const { data: profile, error: readError } = await supabase
      .from("profiles")
      .select("id, email, full_name, platform_role, is_active")
      .eq("id", userId)
      .single();
    if (readError) throw readError;

    return NextResponse.json({ user: profile });
  } catch (err) {
    return handleRouteError(err, "PATCH /api/admin/users");
  }
}
