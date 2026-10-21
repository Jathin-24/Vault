import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeIlike, parseDateOnly } from "@/lib/http/querySafety";
import { CATEGORIES } from "@/lib/constants";

/**
 * Document search, shared by GET /api/documents and the dashboard page so
 * there is exactly ONE implementation of "what a search means".
 *
 * Authorisation is NOT part of this function: the query runs on the caller's
 * Supabase client and Postgres RLS strips ungranted rows before we ever see
 * them. Search therefore cannot leak existence, counts or metadata.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DocumentSearchFilters {
  q: string;
  owner: string;
  category: string;
  folderId: string | null;
  status: "active" | "deleted" | "all";
  from: string | null;
  to: string | null;
  limit: number;
  page: number;
}

export type ParseResult =
  | { ok: true; filters: DocumentSearchFilters }
  | { ok: false; error: string };

export function parseDocumentSearchParams(sp: URLSearchParams): ParseResult {
  const q = (sp.get("q") ?? "").trim().slice(0, 120);
  const owner = (sp.get("owner") ?? "").trim().toLowerCase().slice(0, 254);
  const category = (sp.get("category") ?? "").trim().toLowerCase().slice(0, 40);
  const folderId = (sp.get("folderId") ?? "").trim();
  const status = sp.get("status") ?? "active";
  const from = parseDateOnly(sp.get("from"));
  const to = parseDateOnly(sp.get("to"));
  const limitRaw = Number(sp.get("limit") ?? 25);
  const pageRaw = Number(sp.get("page") ?? 1);

  if (/\p{Cc}/u.test(q)) return { ok: false, error: "Invalid search term." };
  if (sp.get("from") && !from) return { ok: false, error: "Invalid 'from' date." };
  if (sp.get("to") && !to) return { ok: false, error: "Invalid 'to' date." };
  if (!["active", "deleted", "all"].includes(status)) {
    return { ok: false, error: "Invalid status." };
  }
  if (folderId && !UUID_RE.test(folderId)) {
    return { ok: false, error: "Invalid folder." };
  }
  if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return { ok: false, error: "Invalid category." };
  }
  if (from && to && from > to) {
    return { ok: false, error: "'from' is after 'to'." };
  }

  return {
    ok: true,
    filters: {
      q,
      owner,
      category,
      folderId: folderId || null,
      status: status as DocumentSearchFilters["status"],
      from,
      to,
      limit: Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1), 100),
      page: Math.max(Number.isFinite(pageRaw) ? pageRaw : 1, 1),
    },
  };
}

export async function runDocumentSearch(
  supabase: SupabaseClient,
  filters: DocumentSearchFilters
): Promise<{
  documents: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}> {
  const { q, owner, category, folderId, status, from, to, limit, page } = filters;

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

  return {
    documents: (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      owner: Array.isArray(row.owner) ? row.owner[0] : row.owner,
    })),
    total: count ?? 0,
    page,
    limit,
  };
}
