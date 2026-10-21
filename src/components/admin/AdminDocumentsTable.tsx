"use client";

import { useEffect, useState } from "react";

interface AdminDoc {
  id: string;
  title: string;
  category: string;
  status: string;
  updated_at: string;
  owner: { email: string; full_name: string } | null;
  activeGrants: number;
  revokedGrants: number;
}

/**
 * Every document in the system (metadata only). The download link is the
 * break-glass path: the server will refuse unless the caller is an admin, and
 * it writes an admin_override audit event either way the attempt goes.
 */
export default function AdminDocumentsTable() {
  const [docs, setDocs] = useState<AdminDoc[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load(search?: string) {
    setError(null);
    const sp = new URLSearchParams({ limit: "100" });
    if (search) sp.set("q", search);
    const res = await fetch(`/api/admin/documents?${sp}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to load documents.");
      setDocs([]);
      return;
    }
    setDocs(data.documents);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          placeholder="Search titles…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(q)}
          className="w-64 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
        />
        <button
          onClick={() => load(q)}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Search
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {docs === null && <p className="text-sm text-zinc-500">Loading…</p>}

      {docs !== null && (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="table-scroll overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Document</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Grants</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40">
                {docs.map((d) => (
                  <tr key={d.id} className="hover:bg-zinc-900/60">
                    <td className="max-w-[16rem] truncate px-4 py-2.5 text-zinc-100">
                      {d.title}
                    </td>
                    <td className="max-w-[14rem] truncate px-4 py-2.5 text-zinc-400">
                      {d.owner?.email}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{d.category}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="text-emerald-400">{d.activeGrants} active</span>
                      <span className="ml-2 text-zinc-600">{d.revokedGrants} revoked</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-400">{d.status}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">
                      {new Date(d.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/documents/${d.id}/download`}
                        download
                        onClick={(e) => {
                          if (
                            !confirm(
                              `Break-glass download of “${d.title}”?\n\nThis will be recorded in the audit trail as admin_override with your account.`
                            )
                          ) {
                            e.preventDefault();
                          }
                        }}
                        className="text-xs text-amber-400 hover:underline"
                      >
                        open (audited)
                      </a>
                    </td>
                  </tr>
                ))}
                {docs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-zinc-500">
                      No documents.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
