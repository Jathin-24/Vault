import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { logServerEvent } from "@/lib/audit/logServerEvent";
import { handleRouteError, notFound } from "@/lib/http/apiError";
import { getClientIp, getUserAgent } from "@/lib/http/requestContext";
import { contentDispositionAttachment } from "@/lib/documents/sanitizeFilename";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id/download[?version=n]
 * who may call: owner, active 'read'/'edit' grantees; platform admin only via
 * audited break-glass (tv_admin_read_document logs admin_override).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THIS IS THE AUTHORISATION LINE FOR FILE CONTENT. Order matters:
 *   1. authenticate (session JWT verified with Supabase Auth),
 *   2. tv_authorize_document_access() — evaluated in Postgres against
 *      document_grants AT THIS MOMENT, and it WRITES the audit event
 *      (allowed OR denied) BEFORE anything else happens,
 *   3. only then are bytes fetched with the service role and streamed.
 * There is no signed URL, no bearer link, no cached decision: revoke a grant
 * and step 2 fails on the very next request. If the RPC throws, we fail
 * CLOSED (500, no bytes).
 * ══════════════════════════════════════════════════════════════════════════
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const ip = getClientIp(request);
    const ua = getUserAgent(request);

    // ── 1. The decision (fail closed) ──────────────────────────────────────
    const { data: decision, error: decisionError } = await supabase.rpc(
      "tv_authorize_document_access",
      {
        p_document_id: id,
        p_action: "read",
        p_route: "/api/documents/:id/download",
        p_ip: ip,
        p_user_agent: ua,
      }
    );
    if (decisionError) {
      // No record of who read it ⇒ nobody reads it.
      throw new Error(`authorization failed closed: ${decisionError.message}`);
    }

    let allowed = decision?.allowed === true;
    let viaAdmin = false;

    // ── 1b. Admin break-glass (separately audited) ─────────────────────────
    if (!allowed) {
      const { data: adminDecision, error: adminError } = await supabase.rpc(
        "tv_admin_read_document",
        { p_document_id: id }
      );
      if (!adminError && adminDecision?.allowed === true) {
        allowed = true;
        viaAdmin = true;
      } else if (adminError && !/admin only|not found/i.test(adminError.message)) {
        throw adminError;
      }
    }

    if (!allowed) {
      // reason 'not_found' and 'no_grant' both stay 404 — existence is hidden.
      return notFound();
    }

    // ── 2. Which bytes? (user client → RLS re-checks read access) ─────────
    const requestedVersion = request.nextUrl.searchParams.get("version");
    let versionQuery = supabase
      .from("document_versions")
      .select("id, version_no, original_filename, storage_path, mime_type, size_bytes")
      .eq("document_id", id);

    if (requestedVersion !== null) {
      const v = Number(requestedVersion);
      if (!Number.isInteger(v) || v < 1) return notFound();
      versionQuery = versionQuery.eq("version_no", v);
    } else {
      const { data: doc } = await supabase
        .from("documents")
        .select("current_version")
        .eq("id", id)
        .maybeSingle();
      if (!doc || doc.current_version == null) {
        await logServerEvent({
          eventType: "download_failed",
          documentId: id,
          route: "/api/documents/:id/download",
          outcome: "error",
          metadata: { reason: "no_versions" },
          ip,
          userAgent: ua,
          actorUserId: user.id,
        }).catch(() => undefined);
        return notFound();
      }
      versionQuery = versionQuery.eq("version_no", doc.current_version);
    }

    const { data: version, error: versionError } = await versionQuery.maybeSingle();
    if (versionError) throw versionError;
    if (!version) return notFound();

    // ── 3. Bytes: service role, object key from an RLS-verified row ───────
    const admin = getAdminSupabase();
    const { data: blob, error: storageError } = await admin.storage
      .from("documents")
      .download(version.storage_path);

    if (storageError || !blob) {
      await logServerEvent({
        eventType: "download_failed",
        documentId: id,
        route: "/api/documents/:id/download",
        outcome: "error",
        metadata: {
          reason: "object_missing",
          version_no: version.version_no,
          via_admin: viaAdmin,
        },
        ip,
        userAgent: ua,
        actorUserId: user.id,
      }).catch(() => undefined);
      return notFound();
    }

    const headers = new Headers({
      "Content-Type": version.mime_type,
      "Content-Length": String(version.size_bytes),
      "Content-Disposition": contentDispositionAttachment(version.original_filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      // Belt & braces: even if a browser ignored attachment, it cannot
      // execute anything from this response.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-TrustVault-Access": viaAdmin ? "admin-override" : "granted",
    });

    return new Response(blob.stream(), { status: 200, headers });
  } catch (err) {
    return handleRouteError(err, "GET /api/documents/:id/download");
  }
}
