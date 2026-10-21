import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import DocumentActions from "@/components/documents/DocumentActions";
import ShareDialog from "@/components/documents/ShareDialog";
import AuditTable, { type AuditEventRow } from "@/components/audit/AuditTable";

export const metadata = { title: "Document — TrustVault" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: doc } = await supabase
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

  if (!doc) notFound();

  const owner = Array.isArray(doc.owner) ? doc.owner[0] : doc.owner;

  let myPermission: string = "admin";
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

  // Activity on this document, scoped by RLS (owner sees all; others their own).
  const { data: events } = await supabase
    .from("audit_events")
    .select(
      "id, created_at, actor_email, actor_role, event_type, document_id, target_email, route, outcome, ip, user_agent, metadata"
    )
    .eq("document_id", id)
    .order("id", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            ← Documents
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold text-white">
            {doc.title}
            {doc.status === "deleted" && (
              <span className="rounded bg-red-950/70 px-2 py-0.5 text-xs font-normal text-red-300">
                deleted
              </span>
            )}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs">
              {doc.category}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                myPermission === "owner"
                  ? "bg-emerald-900/50 text-emerald-300"
                  : myPermission === "admin"
                    ? "bg-amber-900/50 text-amber-300"
                    : "bg-sky-900/50 text-sky-300"
              }`}
            >
              your access: {myPermission}
            </span>
            <span>
              owned by {owner?.full_name || owner?.email}
            </span>
            <span className="text-zinc-600">
              updated {new Date(doc.updated_at).toLocaleString()}
            </span>
          </div>
        </div>
        <ShareDialog documentId={doc.id} canManage={myPermission === "owner"} />
      </div>

      {doc.description && (
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          {doc.description}
        </p>
      )}

      <DocumentActions
        document={{
          id: doc.id,
          title: doc.title,
          description: doc.description,
          category: doc.category,
          status: doc.status,
          myPermission,
        }}
        versions={versions}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Version history
        </h2>
        {versions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 p-6 text-sm text-zinc-500">
            No file uploaded yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Version</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">SHA-256</th>
                  <th className="px-4 py-3 font-medium">Uploaded</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40">
                {versions.map((v) => (
                  <tr key={v.id} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">
                      v{v.version_no}
                      {v.version_no === doc.current_version && (
                        <span className="ml-2 rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          current
                        </span>
                      )}
                    </td>
                    <td className="max-w-[18rem] truncate px-4 py-2.5 text-zinc-200">
                      {v.original_filename}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">
                      {formatBytes(v.size_bytes)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600">
                      {v.content_hash.slice(0, 12)}…
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">
                      {new Date(v.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/documents/${doc.id}/download?version=${v.version_no}`}
                        className="text-xs text-emerald-400 hover:underline"
                        download
                      >
                        download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Activity on this document
        </h2>
        <AuditTable events={(events ?? []) as unknown as AuditEventRow[]} showActor />
      </section>
    </div>
  );
}
