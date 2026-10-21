import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/requireUser";
import { badRequest, handleRouteError, notFound } from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Walk up to 10 ancestors; returns true if `maybeAncestorId` is in the chain. */
async function isAncestor(
  supabase: SupabaseClient,
  folderId: string,
  maybeAncestorId: string
): Promise<boolean> {
  let cursor: string | null = maybeAncestorId;
  for (let depth = 0; depth < 10 && cursor; depth++) {
    if (cursor === folderId) return true;
    const { data }: { data: { parent_id: string | null } | null } = await supabase
      .from("folders")
      .select("parent_id")
      .eq("id", cursor)
      .maybeSingle();
    cursor = data?.parent_id ?? null;
  }
  return cursor === folderId;
}

/**
 * PATCH /api/folders/:id — rename / move
 * who may call: folder owner (RLS: admins can see but not edit folders).
 * Moves are cycle-checked so folder trees cannot be made into loops.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const body = await request.json().catch(() => null);
    const patch: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 1 || name.length > 120 || /\p{Cc}/u.test(name)) {
        return badRequest("Folder name must be 1–120 characters.");
      }
      patch.name = name;
    }

    if (body?.parentId !== undefined) {
      const parentId = body.parentId === null ? null : String(body.parentId);
      if (parentId !== null) {
        if (!UUID_RE.test(parentId)) return badRequest("Invalid parent folder.");
        if (parentId === id) return badRequest("A folder cannot be its own parent.");
        const { data: parent } = await supabase
          .from("folders")
          .select("id")
          .eq("id", parentId)
          .maybeSingle();
        if (!parent) return badRequest("Parent folder not found.");
        if (await isAncestor(supabase, id, parentId)) {
          return badRequest("That move would create a loop.");
        }
      }
      patch.parent_id = parentId;
    }

    if (Object.keys(patch).length === 0) return badRequest("Nothing to update.");

    const { data, error } = await supabase
      .from("folders")
      .update(patch)
      .eq("id", id)
      .select("id, name, parent_id");
    if (error) throw error;
    if (!data?.length) return notFound();

    return NextResponse.json({ folder: data[0] });
  } catch (err) {
    return handleRouteError(err, "PATCH /api/folders/:id");
  }
}

/**
 * DELETE /api/folders/:id — remove folder (documents survive; folder_id → null)
 * who may call: folder owner only.
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
    const { supabase } = ctx;

    const { data, error } = await supabase
      .from("folders")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data?.length) return notFound();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, "DELETE /api/folders/:id");
  }
}
