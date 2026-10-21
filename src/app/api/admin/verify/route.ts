import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { handleRouteError } from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";

export const runtime = "nodejs";

/**
 * POST /api/admin/verify — recompute the whole audit hash chain inside the
 * database (first inconsistency wins) and report counts.
 * who may call: platform admin ONLY.
 *
 * Independent cross-check: `npm run audit:verify` re-implements the same
 * verification in Node over raw rows (see scripts/verify-audit-chain.mjs).
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }
    const ctx = await requireAdmin();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const { data, error } = await supabase.rpc("tv_verify_audit_chain");
    if (error) throw error;

    return NextResponse.json({ verification: data });
  } catch (err) {
    return handleRouteError(err, "POST /api/admin/verify");
  }
}
