import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { badRequest, handleRouteError } from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim().length >= 1 &&
    name.trim().length <= 120 &&
    !/\p{Cc}/u.test(name)
  );
}

/**
 * GET /api/folders — my folders (with counts of documents I can see)
 * who may call: any authenticated, active user. Folders organise ONLY — they
 * carry no permissions (see 0003_folders.sql).
 */
export async function GET() {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const { data, error } = await supabase
      .from("folders")
      .select("id, name, parent_id, created_at, documents(count)")
      .order("name", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      folders: (data ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        parent_id: f.parent_id,
        created_at: f.created_at,
        documentCount: Array.isArray(f.documents) ? (f.documents[0]?.count ?? 0) : 0,
      })),
    });
  } catch (err) {
    return handleRouteError(err, "GET /api/folders");
  }
}

/**
 * POST /api/folders — create a folder
 * who may call: any authenticated, active user (own folders only).
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const body = await request.json().catch(() => null);
    const name = body?.name;
    const parentId = body?.parentId ?? null;

    if (!validName(name)) return badRequest("Folder name must be 1–120 characters.");
    if (parentId !== null) {
      if (typeof parentId !== "string" || !UUID_RE.test(parentId)) {
        return badRequest("Invalid parent folder.");
      }
      const { data: parent } = await supabase
        .from("folders")
        .select("id")
        .eq("id", parentId)
        .maybeSingle();
      if (!parent) return badRequest("Parent folder not found.");
    }

    const { data, error } = await supabase
      .from("folders")
      .insert({ owner_id: user.id, name: name.trim(), parent_id: parentId })
      .select("id, name, parent_id, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ folder: data }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, "POST /api/folders");
  }
}
