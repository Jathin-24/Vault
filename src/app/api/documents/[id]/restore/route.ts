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
 * POST /api/documents/:id/restore — undo a soft delete within retention.
 * who may call: document owner only (guard trigger independently refuses
 * status changes by anyone else, including admins).
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
      .select("id, owner_id, status")
      .eq("id", id)
      .maybeSingle();
    if (!doc) return notFound();
    if (doc.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the owner can restore." }, { status: 403 });
    }
    if (doc.status !== "deleted") return badRequest("Document is not deleted.");

    const { data: updated, error } = await supabase
      .from("documents")
      .update({ status: "active", deleted_at: null, deleted_by: null })
      .eq("id", id)
      .select("id, status");
    if (error) throw error;
    if (!updated?.length) return notFound();

    return NextResponse.json({ ok: true, document: updated[0] });
  } catch (err) {
    return handleRouteError(err, "POST /api/documents/:id/restore");
  }
}
