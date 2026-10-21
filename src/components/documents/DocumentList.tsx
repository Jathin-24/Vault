import Link from "next/link";

interface DocumentRow {
  id: string;
  title: string;
  category: string;
  status: string;
  updated_at: string;
  owner: { id: string; email: string; full_name: string } | null;
}

/**
 * Result table. Row visibility was decided by Postgres RLS before this
 * component existed — it renders what the caller is allowed to know about.
 */
export default function DocumentList({
  documents,
  viewerId,
  page,
  total,
  limit,
  queryString,
}: {
  documents: DocumentRow[];
  viewerId: string;
  page: number;
  total: number;
  limit: number;
  /** Current search string (without page), for pagination links. */
  queryString: string;
}) {
  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">
        No documents match. Everything you can see is listed here — anything
        you were not granted does not appear at all, not even its name.
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(total / limit));

  function pageLink(target: number) {
    const sp = new URLSearchParams(queryString);
    sp.set("page", String(target));
    return `/dashboard?${sp.toString()}`;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <div className="table-scroll overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Your access</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40">
            {documents.map((doc) => {
              const isOwner = doc.owner?.id === viewerId;
              return (
                <tr key={doc.id} className="hover:bg-zinc-900/60">
                  <td className="max-w-xs px-4 py-2.5">
                    <Link
                      href={`/documents/${doc.id}`}
                      className="block truncate font-medium text-zinc-100 hover:text-emerald-400"
                      title={doc.title}
                    >
                      {doc.title}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-2.5 text-zinc-400">
                    {doc.owner?.full_name || doc.owner?.email}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                      {doc.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        isOwner
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "bg-sky-900/50 text-sky-300"
                      }`}
                    >
                      {isOwner ? "owner" : "shared"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs ${
                        doc.status === "deleted" ? "text-red-400" : "text-zinc-400"
                      }`}
                    >
                      {doc.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">
                    {new Date(doc.updated_at).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 px-4 py-2 text-xs text-zinc-400">
          <span>
            {total} document{total === 1 ? "" : "s"} visible to you · page {page} of{" "}
            {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800" href={pageLink(page - 1)}>
                ← Prev
              </Link>
            )}
            {page < pages && (
              <Link className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800" href={pageLink(page + 1)}>
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
