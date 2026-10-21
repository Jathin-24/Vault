import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { handleRouteError } from "@/lib/http/apiError";

export const runtime = "nodejs";

/**
 * GET /api/admin/summary — console counters (users, documents, grants,
 * events, 24h denials).
 * who may call: platform admin ONLY.
 */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const { data, error } = await supabase.rpc("tv_admin_summary");
    if (error) throw error;

    return NextResponse.json({ summary: data });
  } catch (err) {
    return handleRouteError(err, "GET /api/admin/summary");
  }
}
