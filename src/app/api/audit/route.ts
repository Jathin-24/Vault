import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { badRequest, handleRouteError } from "@/lib/http/apiError";
import { parseDateOnly } from "@/lib/http/querySafety";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/audit — the caller's own trail (actions they took + events on
 * documents they own), newest first.
 * who may call: any authenticated, active user.
 *
 * RLS scopes this: admins see everything (their own route), owners see their
 * documents' events, everyone sees their own actions. No one sees the rest,
 * and no one — any role — can write here through the API.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const sp = request.nextUrl.searchParams;
    const eventType = (sp.get("eventType") ?? "").trim().slice(0, 80);
    const outcome = (sp.get("outcome") ?? "").trim();
    const documentId = (sp.get("documentId") ?? "").trim();
    const from = parseDateOnly(sp.get("from"));
    const to = parseDateOnly(sp.get("to"));
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);

    if (eventType && !/^[a-z_.]{1,80}$/i.test(eventType)) {
      return badRequest("Invalid event type filter.");
    }
    if (outcome && !["success", "denied", "error"].includes(outcome)) {
      return badRequest("Invalid outcome filter.");
    }
    if (documentId && !UUID_RE.test(documentId)) return badRequest("Invalid document id.");
    if (sp.get("from") && !from) return badRequest("Invalid 'from' date.");
    if (sp.get("to") && !to) return badRequest("Invalid 'to' date.");

    let query = supabase
      .from("audit_events")
      .select(
        "id, created_at, actor_email, actor_role, event_type, document_id, target_email, route, outcome, ip, metadata",
        { count: "exact" }
      );

    if (eventType) query = query.eq("event_type", eventType);
    if (outcome) query = query.eq("outcome", outcome);
    if (documentId) query = query.eq("document_id", documentId);
    if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

    const { data, error, count } = await query
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return NextResponse.json({ events: data ?? [], total: count ?? 0, offset, limit });
  } catch (err) {
    return handleRouteError(err, "GET /api/audit");
  }
}
