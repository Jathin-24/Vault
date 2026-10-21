import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { escapeIlike, parseDateOnly } from "@/lib/http/querySafety";
import { badRequest, handleRouteError } from "@/lib/http/apiError";
import { CATEGORIES } from "@/lib/constants";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/documents — list + search (name, owner, category, date, status, folder)
 * who may call: any authenticated, active user.
 *
 * The query runs on the USER's client: Postgres RLS strips anything the
 * caller was not granted before the response is built. There is no
 * application-level "filter" step to forget — search cannot leak documents,
 * folders, counts or existence of anything else.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase } = ctx;

    const sp = request.nextUrl.searchParams;
    const q = (sp.get("q") ?? "").trim().slice(0, 120);
    const owner = (sp.get("owner") ?? "").trim().toLowerCase().slice(0, 254);
    const category = (sp.get("category") ?? "").trim().toLowerCase().slice(0, 40);
    const folderId = (sp.get("folderId") ?? "").trim();
    const status = sp.get("status") ?? "active";
    const from = parseDateOnly(sp.get("from"));
    const to = parseDateOnly(sp.get("to"));
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 25) || 25, 1), 100);
    const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);

    if (/\p{Cc}/u.test(q)) return badRequest("Invalid search term.");
    if (sp.get("from") && !from) return badRequest("Invalid 'from' date.");
    if (sp.get("to") && !to) return badRequest("Invalid 'to' date.");
    if (!["active", "deleted", "all"].includes(status)) {
      return badRequest("Invalid status.");
    }
    if (folderId && !UUID_RE.test(folderId)) return badRequest("Invalid folder.");
    if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return badRequest("Invalid category.");
    }
    if (from && to && from > to) return badRequest("'from' is after 'to'.");

    let query = supabase
      .from("documents")
      .select(
        `
        id, title, description, category, status, folder_id, current_version,
        created_at, updated_at, deleted_at,
        owner:profiles!documents_owner_id_fkey!inner ( id, email, full_name )
        `,
        { count: "exact" }
      );

    if (owner) query = query.ilike("owner.email", `%${escapeIlike(owner)}%`);
    if (q) {
      query = query.or(
        `title.ilike.%${escapeIlike(q)}%,description.ilike.%${escapeIlike(q)}%`
      );
    }
    if (category) query = query.eq("category", category);
    if (folderId) query = query.eq("folder_id", folderId);
    if (status !== "all") query = query.eq("status", status);
    if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

    const offset = (page - 1) * limit;
    const { data, error, count } = await query
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({
      documents: (data ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        owner: Array.isArray(row.owner) ? row.owner[0] : row.owner,
      })),
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    return handleRouteError(err, "GET /api/documents");
  }
}

/**
 * POST /api/documents — create an (empty) document record before uploading.
 * who may call: any authenticated, active user.
 *
 * Ownership is pinned server-side (owner_id = session user, also re-checked by
 * RLS WITH CHECK). Folder must belong to the caller.
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
