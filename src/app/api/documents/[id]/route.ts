import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { badRequest, handleRouteError, notFound } from "@/lib/http/apiError";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/:id
 * who may call: owner, active grantees (read/edit), platform admin (metadata).
 *
 * If the caller has no access the response is 404 — identical to an ID that
 * never existed. Attackers cannot enumerate real document IDs.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const { data: doc, error } = await supabase
      .from("documents")
      .select(
        `
        id, title, description, category, folder_id, status, current_version,
        created_at, updated_at, deleted_at,
        owner:profiles!documents_owner_id_fkey ( id, email, full_name ),
        document_versions (
          id, version_no, original_filename, size_bytes, mime_type,
          content_hash, created_at, uploaded_by
        )
        `
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!doc) return notFound();

    const owner = Array.isArray(doc.owner) ? doc.owner[0] : doc.owner;

    // Determine the caller's relationship to this document (grants RLS lets a
    // grantee read their own grant rows).
    let myPermission: string = "admin"; // visible without owner/grant => admin
    if (owner?.id === user.id) {
      myPermission = "owner";
    } else {
      const [byId, byEmail] = await Promise.all([
        supabase
          .from("document_grants")
          .select("permission")
          .eq("document_id", id)
          .eq("grantee_user_id", user.id)
          .is("revoked_at", null)
          .maybeSingle(),
        supabase
          .from("document_grants")
          .select("permission")
          .eq("document_id", id)
          .eq("grantee_email", (user.email ?? "").toLowerCase())
          .is("revoked_at", null)
          .maybeSingle(),
      ]);
      const grant = byId.data ?? byEmail.data;
      if (grant) myPermission = grant.permission;
    }

    const versions = (doc.document_versions ?? [])
      .slice()
      .sort((a: { version_no: number }, b: { version_no: number }) => b.version_no - a.version_no);

    return NextResponse.json({
      document: { ...doc, owner, versions, myPermission },
    });
  } catch (err) {
    return handleRouteError(err, "GET /api/documents/:id");
  }
}

/**
 * PATCH /api/documents/:id — edit metadata (title, description, category, folder)
 * who may call: owner, grantee with 'edit', NOT platform admin (admins do not
 * get to alter other people's documents — see README roles table).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const body = await request.json().catch(() => null);

    const patch: Record<string, unknown> = {};
    if (body?.title !== undefined) {
      const title = String(body.title).trim();
      if (title.length < 1 || title.length > 200 || /\p{Cc}/u.test(title)) {
        return badRequest("Title must be 1–200 characters with no control characters.");
      }
      patch.title = title;
    }
    if (body?.description !== undefined) {
      const description = String(body.description).trim();
      if (description.length > 2000) return badRequest("Description too long.");
      patch.description = description;
    }
    if (body?.category !== undefined) {
      const category = String(body.category).trim().toLowerCase();
      if (!/^[a-z0-9-]{1,40}$/.test(category)) return badRequest("Invalid category.");
      patch.category = category;
    }
    if (body?.folderId !== undefined) {
      const folderId = body.folderId === null ? null : String(body.folderId);
      if (folderId !== null) {
        if (!UUID_RE.test(folderId)) return badRequest("Invalid folder.");
        const { data: folder } = await supabase
          .from("folders")
          .select("id")
          .eq("id", folderId)
          .maybeSingle();
        if (!folder) return badRequest("Folder not found.");
      }
      patch.folder_id = folderId;
    }
    if (Object.keys(patch).length === 0) return badRequest("Nothing to update.");

    const { data: updated, error } = await supabase
      .from("documents")
      .update(patch)
      .eq("id", id)
      .select("id, title, description, category, folder_id, updated_at");

    // RLS can refuse the write by REJECTING the statement (42501) rather than
    // by matching zero rows — map that to the same visibility logic below
    // instead of leaking a 500.
    if (error && error.code !== "42501") throw error;
    if (!updated || updated.length === 0) {
      // RLS blocked the write. Distinguish only what the caller already knows:
      // if they can SEE the document, they're read-only (403); if not, the
      // document doesn't exist as far as they're concerned (404).
      const { data: visible } = await supabase
        .from("documents")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (visible) {
        return NextResponse.json({ error: "Not permitted." }, { status: 403 });
      }
      return notFound();
    }

    return NextResponse.json({ document: updated[0] });
  } catch (err) {
    return handleRouteError(err, "PATCH /api/documents/:id");
  }
}

/**
 * DELETE /api/documents/:id — SOFT delete (retention window, restorable).
 * who may call: owner only. Editors get 403 (they can see it), everyone else
 * 404 (they cannot learn it exists). The DB guard trigger independently
 * refuses status changes by non-owners — the route check and the trigger are
 * two separate lines, both of which must fail for a leak.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const { data: doc } = await supabase
      .from("documents")
      .select("id, owner_id, status, title")
      .eq("id", id)
      .maybeSingle();

    if (!doc) return notFound();
    if (doc.owner_id !== user.id) {
      return NextResponse.json({ error: "Only the owner can delete this document." }, { status: 403 });
    }
    if (doc.status === "deleted") {
      return NextResponse.json({ error: "Already deleted." }, { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from("documents")
      .update({ status: "deleted", deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq("id", id)
      .select("id, status");

    if (error) throw error;
    if (!updated?.length) return notFound();

    return NextResponse.json({ ok: true, document: updated[0] });
  } catch (err) {
    return handleRouteError(err, "DELETE /api/documents/:id");
  }
}
