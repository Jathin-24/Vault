import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { handleRouteError, notFound, badRequest } from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id/suggestions — AI assist: who else might belong here?
 * who may call: document owner only (enforced INSIDE tv_suggest_viewers too).
 *
 * The machine suggests; it never grants. Ranking is a transparent heuristic
 * over existing collaboration (documented in README + THREATS).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const { data, error } = await supabase.rpc("tv_suggest_viewers", {
      p_document_id: id,
    });
    if (error) {
      if (/only the document owner/i.test(error.message)) return notFound();
      throw error;
    }
    return NextResponse.json({ suggestions: data ?? [] });
  } catch (err) {
    return handleRouteError(err, "GET /api/documents/:id/suggestions");
  }
}

/**
 * POST /api/documents/:id/suggestions — owner CONFIRMS or declines a
 * suggestion. who may call: document owner only.
 *
 * body: { suggestionId, decision: 'accepted' | 'declined' }
 * 'accepted' creates the real grant in the same request (RLS owner-checked).
 * Audit: suggestion.accepted/declined event (via RPC) + grant.create event
 * (via table trigger) — the reasoning AND the outcome are in the chain.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const body = await request.json().catch(() => null);
    const suggestionId = String(body?.suggestionId ?? "");
    const decision = String(body?.decision ?? "");
    if (!UUID_RE.test(suggestionId)) return badRequest("Missing suggestionId.");
    if (decision !== "accepted" && decision !== "declined") {
      return badRequest("decision must be 'accepted' or 'declined'.");
    }

    // 1) Record the decision (checks ownership internally, writes audit).
    const { error: decideError } = await supabase.rpc("tv_decide_suggestion", {
      p_suggestion_id: suggestionId,
      p_decision: decision,
    });
    if (decideError) {
      if (/not found/i.test(decideError.message)) return notFound();
      throw decideError;
    }

    if (decision === "declined") {
      return NextResponse.json({ ok: true, decision });
    }

    // 2) Turn the acceptance into an actual grant (RLS owner-only + audit).
    const { data: suggestion } = await supabase
      .from("access_suggestions")
      .select("id, document_id, suggested_email")
      .eq("id", suggestionId)
      .maybeSingle();

    if (!suggestion || suggestion.document_id !== id) return notFound();

    const { data: grant, error } = await supabase
      .from("document_grants")
      .insert({
        document_id: id,
        grantee_email: suggestion.suggested_email,
        permission: "read",
        granted_by: user.id,
      })
      .select("id, grantee_email, permission, created_at")
      .single();

    if (error && error.code !== "23505") {
      if (error.code === "42501") {
        return NextResponse.json({ error: "Not permitted." }, { status: 403 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true, decision, grant: grant ?? null });
  } catch (err) {
    return handleRouteError(err, "POST /api/documents/:id/suggestions");
  }
}
