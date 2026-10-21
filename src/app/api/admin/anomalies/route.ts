import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { handleRouteError } from "@/lib/http/apiError";

export const runtime = "nodejs";

/**
 * GET /api/admin/anomalies — what is worth noticing, from the audit trail.
 * who may call: platform admin ONLY (tv_admin_anomalies enforces it again).
 *
 * Rules (24h window): denied_storm, login_failures, mass_download,
 * grant_spam, admin_override. Deliberately explainable rules rather than a
 * black box — the admin can see exactly why something was flagged.
 */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const { data, error } = await supabase.rpc("tv_admin_anomalies");
    if (error) throw error;

    return NextResponse.json({ anomalies: data ?? [] });
  } catch (err) {
    return handleRouteError(err, "GET /api/admin/anomalies");
  }
}
