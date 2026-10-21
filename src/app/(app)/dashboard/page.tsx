import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  parseDocumentSearchParams,
  runDocumentSearch,
} from "@/lib/documents/documentSearch";
import DocumentList from "@/components/documents/DocumentList";
import SearchFilters from "@/components/search/SearchFilters";
import FolderSidebar, { type FolderRow } from "@/components/folders/FolderSidebar";
import UploadDocumentModal from "@/components/documents/UploadDocumentModal";

export const metadata = { title: "Documents — TrustVault" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") sp.set(k, v);
    else if (Array.isArray(v) && typeof v[0] === "string") sp.set(k, v[0]);
  }

  const parsed = parseDocumentSearchParams(sp);

  const foldersPromise = supabase
    .from("folders")
    .select("id, name, parent_id, created_at, documents(count)")
    .order("name", { ascending: true });

  const [foldersRes, searchRes] = await Promise.all([
    foldersPromise,
    parsed.ok
      ? runDocumentSearch(supabase, parsed.filters)
      : Promise.resolve(null),
  ]);

  const folders: FolderRow[] = (foldersRes.data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    parent_id: f.parent_id,
    documentCount: Array.isArray(f.documents)
      ? (f.documents[0]?.count ?? 0)
      : 0,
  }));

  const filters = parsed.ok
    ? parsed.filters
    : { q: "", owner: "", category: "", from: "", to: "", status: "active", folderId: "" };

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <FolderSidebar folders={folders} activeFolderId={filters.folderId || null} />

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Documents</h1>
            <p className="text-sm text-zinc-500">
              Only documents you own or were granted appear here.
            </p>
          </div>
          <UploadDocumentModal folders={folders} />
        </div>

        <SearchFilters
          initial={{
            q: filters.q,
            owner: filters.owner,
            category: filters.category,
            from: filters.from ?? "",
            to: filters.to ?? "",
            status: filters.status,
            folderId: filters.folderId ?? "",
          }}
        />

        {!parsed.ok && (
          <p className="rounded-md border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
            {parsed.error}
          </p>
        )}

        {searchRes && (
          <DocumentList
            documents={searchRes.documents as never}
            viewerId={user.id}
            page={searchRes.page}
            total={searchRes.total}
            limit={searchRes.limit}
            queryString={sp.toString()}
          />
        )}
      </div>
    </div>
  );
}
