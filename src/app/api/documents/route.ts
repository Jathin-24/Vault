import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { badRequest, handleRouteError } from "@/lib/http/apiError";
import {
  parseDocumentSearchParams,
  runDocumentSearch,
} from "@/lib/documents/documentSearch";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/documents — list + search (name, owner, category, date, status, folder)
 * who may call: any authenticated, active user.
 *
 * Query runs on the USER's client; Postgres RLS strips anything not granted
 * before the response exists — search cannot leak other people's documents,
 * their titles, or even their existence (and counts are counts of what YOU
 * can see).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;

    const parsed = parseDocumentSearchParams(request.nextUrl.searchParams);
    if (!parsed.ok) return badRequest(parsed.error);

    const result = await runDocumentSearch(ctx.supabase, parsed.filters);
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err, "GET /api/documents");
  }
}

/**
 * POST /api/documents — create an (empty) document record before uploading.
 * who may call: any authenticated, active user.
 *
 * Ownership is pinned server-side (owner_id = session user; RLS WITH CHECK
 * re-verifies). Folder must belong to the caller. The document.create audit
 * event is written by a table trigger — even direct SQL creates would be logged.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    const body = await request.json().catch(() => null);
    const title = String(body?.title ?? "").trim();
    const description = String(body?.description ?? "").trim().slice(0, 2000);
    const category = String(body?.category ?? "general").trim().toLowerCase();
    const folderId = body?.folderId ? String(body.folderId) : null;

    if (title.length < 1 || title.length > 200 || /\p{Cc}/u.test(title)) {
      return badRequest("Title must be 1–200 characters with no control characters.");
    }
    if (!/^[a-z0-9-]{1,40}$/.test(category)) {
      return badRequest("Invalid category.");
    }

    if (folderId) {
      if (!UUID_RE.test(folderId)) return badRequest("Invalid folder.");
      const { data: folder } = await supabase
        .from("folders")
        .select("id")
        .eq("id", folderId)
        .maybeSingle();
      if (!folder) return badRequest("Folder not found.");
    }

    const { data, error } = await supabase
      .from("documents")
      .insert({
        owner_id: user.id,
        title,
        description,
        category,
        folder_id: folderId,
      })
      .select("id, title, description, category, folder_id, status, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ document: data }, { status: 201 });
  } catch (err) {
    return handleRouteError(err, "POST /api/documents");
  }
}
