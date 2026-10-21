import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import {
  badRequest,
  handleRouteError,
  notFound,
  tooManyRequests,
} from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { DOCUMENT_PERMISSIONS } from "@/lib/constants";
import { isPlausibleEmail } from "@/lib/auth/passwordPolicy";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id/grants — who can see this document
 * who may call: document owner (and platform admin, read-only view).
 * Grantees themselves do NOT get the list: it would disclose who else has
 * access and their email addresses.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const { data: doc } = await supabase
      .from("documents")
      .select("id, owner_id, title")
      .eq("id", id)
      .maybeSingle();
    if (!doc) return notFound();

    const { data: profile } = await supabase
      .from("profiles")
      .select("platform_role")
      .eq("id", user.id)
      .maybeSingle();

    const isOwner = doc.owner_id === user.id;
    const isAdmin = profile?.platform_role === "admin";
    if (!isOwner && !isAdmin) return notFound();

    const { data: grants, error } = await supabase
      .from("document_grants")
      .select("id, grantee_email, permission, created_at, revoked_at, granted_by")
      .eq("document_id", id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ grants: grants ?? [], isOwner });
  } catch (err) {
    return handleRouteError(err, "GET /api/documents/:id/grants");
  }
}

/**
 * POST /api/documents/:id/grants — share with a named email (read | edit)
 * who may call: document owner ONLY. Editors cannot re-share (escalation
 * path), admins cannot grant (break-glass is audited instead).
 *
 * Google-Sheets-style: paste an email, choose a level. If the person has no
 * account yet, the grant activates automatically the moment that VERIFIED
 * email signs up (JWT email match in every policy).
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
    const email = String(body?.email ?? "").trim().toLowerCase();
    const permission = String(body?.permission ?? "");

    if (!isPlausibleEmail(email)) return badRequest("Enter a valid email address.");
    if (!DOCUMENT_PERMISSIONS.includes(permission as (typeof DOCUMENT_PERMISSIONS)[number])) {
      return badRequest("Permission must be 'read' or 'edit'.");
    }
    if (email === (user.email ?? "").toLowerCase()) {
      return badRequest("You already own this document.");
    }

    const { data: doc } = await supabase
      .from("documents")
      .select("id, owner_id, title")
      .eq("id", id)
      .maybeSingle();
    if (!doc) return notFound();
    if (doc.owner_id !== user.id) {
      return NextResponse.json(
        { error: "Only the document owner can manage sharing." },
        { status: 403 }
      );
    }

    const rateOk = await getAdminSupabase().rpc("tv_rate_limit_take", {
      p_key: `grant:${user.id}`,
      p_max: 60,
      p_window_seconds: 300,
    });
    if (rateOk.data === false) return tooManyRequests("Too many sharing changes. Slow down.");

    const { data: grant, error } = await supabase
      .from("document_grants")
      .insert({
        document_id: id,
        grantee_email: email,
        permission,
        granted_by: user.id,
        // grantee_user_id resolved best-effort (profiles readable by active
        // users); matching at access time is email-based regardless.
        grantee_user_id: null,
      })
      .select("id, grantee_email, permission, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That person already has an active grant on this document." },
          { status: 409 }
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "Only the document owner can manage sharing." },
          { status: 403 }
        );
      }
      throw error;
    }

    return NextResponse.json({ grant }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, "POST /api/documents/:id/grants");
  }
}

/**
 * DELETE /api/documents/:id/grants?grantId=… — revoke IMMEDIATELY.
 * who may call: document owner only.
 *
 * "Immediately" means: revoked_at is set now, and every subsequent request
 * re-reads this table (RLS on metadata, tv_authorize_document_access on the
 * download). Anything the grantee fetched BEFORE revocation stays theirs in
 * their browser (they saw it while allowed); nothing new is reachable, and
 * there is no token/URL issued earlier that still works.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const grantId = request.nextUrl.searchParams.get("grantId");
    if (!grantId || !UUID_RE.test(grantId)) return badRequest("Missing grantId.");

    const { data: doc } = await supabase
      .from("documents")
      .select("id, owner_id")
      .eq("id", id)
      .maybeSingle();
    if (!doc) return notFound();
    if (doc.owner_id !== user.id) {
      return NextResponse.json(
        { error: "Only the document owner can manage sharing." },
        { status: 403 }
      );
    }

    const { data: updated, error } = await supabase
      .from("document_grants")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: user.id,
      })
      .eq("id", grantId)
      .eq("document_id", id)
      .is("revoked_at", null)
      .select("id, grantee_email");

    if (error) throw error;
    if (!updated?.length) return notFound(); // already revoked, or not yours

    return NextResponse.json({ ok: true, revoked: updated[0] });
  } catch (err) {
    return handleRouteError(err, "DELETE /api/documents/:id/grants");
  }
}
