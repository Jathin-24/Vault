import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { badRequest, handleRouteError } from "@/lib/http/apiError";

export const runtime = "nodejs";

/**
 * GET /api/admin/documents — metadata for EVERY document in the system
 * (including deleted ones), with owners and grant summaries.
 * who may call: platform admin ONLY.
 *
 * Metadata only: this endpoint never returns file bytes. Reaching content
 * requires the break-glass download path, which logs admin_override.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const sp = request.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim().slice(0, 120);
    const status = sp.get("status") ?? "all";
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);

    if (!["active", "deleted", "all"].includes(status)) return badRequest("Invalid status.");

    let query = supabase
      .from("documents")
      .select(
        `
        id, title, category, status, current_version, created_at, updated_at, deleted_at,
        owner:profiles!documents_owner_id_fkey ( id, email, full_name ),
        document_grants ( id, grantee_email, permission, revoked_at )
        `,
        { count: "exact" }
      );

    if (q) query = query.ilike("title", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
    if (status !== "all") query = query.eq("status", status);

    const { data, error, count } = await query
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return NextResponse.json({
      documents: (data ?? []).map((row: Record<string, unknown>) => {
        const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
        const grants = (row.document_grants as Array<Record<string, unknown>>) ?? [];
        return {
          ...row,
          owner,
          document_grants: undefined,
          activeGrants: grants.filter((g) => g.revoked_at === null).length,
          revokedGrants: grants.filter((g) => g.revoked_at !== null).length,
        };
      }),
      total: count ?? 0,
      offset,
      limit,
    });
  } catch (err) {
    return handleRouteError(err, "GET /api/admin/documents");
  }
}
