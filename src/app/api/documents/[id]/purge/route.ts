import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { handleRouteError, notFound, badRequest } from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/documents/:id/purge — permanent removal after soft-delete.
 * who may call: owner of the deleted document, or platform admin (retention).
 *
 * Bytes first, rows second: if object deletion fails we abort, and the
 * document stays soft-deleted (still recoverable) rather than becoming a
 * ghost row with live bytes. tv_purge_document logs a snapshot of what was
 * destroyed BEFORE deleting anything.
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

    const { data: doc } = await supabase
      .from("documents")
      .select("id, owner_id, status, title")
      .eq("id", id)
      .maybeSingle();
    if (!doc) return notFound();
    if (doc.status !== "deleted") {
      return badRequest("Only soft-deleted documents can be purged.");
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("platform_role")
      .eq("id", user.id)
      .maybeSingle();
    const isOwner = doc.owner_id === user.id;
    const isAdmin = profile?.platform_role === "admin";
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Not permitted." }, { status: 403 });
    }

    const { data: versions, error: versionsError } = await supabase
      .from("document_versions")
      .select("storage_path")
      .eq("document_id", id);
    if (versionsError) throw versionsError;

    const paths = (versions ?? []).map((v) => v.storage_path);
    if (paths.length > 0) {
      const admin = getAdminSupabase();
      const { error: removeError } = await admin.storage.from("documents").remove(paths);
      if (removeError) {
        throw new Error(`refusing to purge: object deletion failed (${removeError.message})`);
      }
    }

    const { error: purgeError } = await supabase.rpc("tv_purge_document", {
      p_document_id: id,
    });
    if (purgeError) {
      if (/not permitted|not found/i.test(purgeError.message)) {
        return NextResponse.json({ error: purgeError.message }, { status: 403 });
      }
      throw purgeError;
    }

    return NextResponse.json({ ok: true, objectsRemoved: paths.length });
  } catch (err) {
    return handleRouteError(err, "POST /api/documents/:id/purge");
  }
}
