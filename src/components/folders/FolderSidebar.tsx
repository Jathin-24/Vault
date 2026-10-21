"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  documentCount: number;
}

/**
 * Folder sidebar. Folders ORGANISE only — moving a document into a folder
 * never changes who can access it (that is per-document grants, full stop).
 */
export default function FolderSidebar({
  folders,
  activeFolderId,
}: {
  folders: FolderRow[];
  activeFolderId: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go(folderId: string | null) {
    const sp = new URLSearchParams(window.location.search);
    if (folderId) sp.set("folderId", folderId);
    else sp.delete("folderId");
    const qs = sp.toString();
    router.push(`/dashboard${qs ? `?${qs}` : ""}`);
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not create folder.");
      return;
    }
    setName("");
    setCreating(false);
    router.refresh();
  }

  async function deleteFolder(id: string) {
    if (!confirm("Delete this folder? Documents inside are kept (unfiled).")) return;
    const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeFolderId === id) go(null);
      router.refresh();
    }
  }

  return (
    <aside className="flex h-fit flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Folders
        </h2>
        <button
          onClick={() => setCreating((v) => !v)}
          className="rounded px-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          title="New folder"
        >
          +
        </button>
      </div>

      <button
        onClick={() => go(null)}
        className={`rounded-md px-2.5 py-1.5 text-left text-sm ${
          activeFolderId === null
            ? "bg-emerald-900/40 text-emerald-200"
            : "text-zinc-300 hover:bg-zinc-800"
        }`}
      >
        All documents
      </button>

      {folders.map((f) => (
        <div key={f.id} className="group flex items-center justify-between">
          <button
            onClick={() => go(f.id)}
            className={`flex-1 rounded-md px-2.5 py-1.5 text-left text-sm ${
              activeFolderId === f.id
                ? "bg-emerald-900/40 text-emerald-200"
                : "text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            📁 {f.name}
            <span className="ml-1.5 text-xs text-zinc-500">{f.documentCount}</span>
          </button>
          <button
            onClick={() => deleteFolder(f.id)}
            className="hidden rounded px-1.5 text-zinc-600 hover:text-red-400 group-hover:block"
            title="Delete folder"
          >
            ✕
          </button>
        </div>
      ))}

      {creating && (
        <form onSubmit={createFolder} className="mt-1 space-y-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            maxLength={120}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button className="w-full rounded-md bg-emerald-500 py-1.5 text-sm font-medium text-zinc-950">
            Create
          </button>
        </form>
      )}

      <p className="mt-3 border-t border-zinc-800 px-1 pt-2 text-[11px] leading-snug text-zinc-600">
        Folders organise documents. They never grant access — permissions live
        on each document.
      </p>
    </aside>
  );
}
