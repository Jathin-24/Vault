"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface VersionRow {
  id: string;
  version_no: number;
  original_filename: string;
  size_bytes: number;
  created_at: string;
  content_hash: string;
}

export interface ActionableDocument {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  myPermission: string;
}

/**
 * Everything an owner/editor can DO to a document. The admin sees a reduced
 * set (break-glass download only) — write actions are not admin capabilities.
 */
export default function DocumentActions({
  document: doc,
  versions,
}: {
  document: ActionableDocument;
  versions: VersionRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: doc.title,
    description: doc.description,
    category: doc.category,
  });
  const [uploading, setUploading] = useState(false);

  const canEdit = doc.myPermission === "owner" || doc.myPermission === "edit";
  const isOwner = doc.myPermission === "owner";
  const isAdmin = doc.myPermission === "admin";
  const isDeleted = doc.status === "deleted";

  async function call(path: string, init: RequestInit, okMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(path, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Request failed.");
        return false;
      }
      if (okMessage) setNotice(okMessage);
      return true;
    } catch {
      setError("Network error.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveMetadata(e: React.FormEvent) {
    e.preventDefault();
    const ok = await call(
      `/api/documents/${doc.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      },
      "Saved."
    );
    if (ok) {
      setEditing(false);
      router.refresh();
    }
  }

  async function uploadNewVersion(file: File) {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/documents/${doc.id}/versions`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Upload failed.");
        if (Array.isArray(data.details)) {
          setError(`${data.error ?? "Upload failed."} ${data.details.join(" ")}`);
        }
        return;
      }
      setNotice(`Version ${data.version.version_no} uploaded.`);
      router.refresh();
    } catch {
      setError("Network error during upload.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteDocument() {
    if (!confirm("Move this document to deleted? It stays restorable for 30 days.")) return;
    const ok = await call(`/api/documents/${doc.id}`, { method: "DELETE" }, "Deleted.");
    if (ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  async function restoreDocument() {
    const ok = await call(
      `/api/documents/${doc.id}/restore`,
      { method: "POST" },
      "Restored."
    );
    if (ok) router.refresh();
  }

  async function purgeDocument() {
    if (!confirm("PERMANENTLY purge this document and all its versions? This cannot be undone.")) return;
    const ok = await call(`/api/documents/${doc.id}/purge`, { method: "POST" }, "Purged.");
    if (ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/documents/${doc.id}/download`}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
          download
        >
          ⬇ Download{versions.length > 0 ? ` (v${versions[0]?.version_no})` : ""}
        </a>

        {canEdit && !isDeleted && (
          <label className="cursor-pointer rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800">
            {uploading ? "Uploading…" : "⬆ Upload new version"}
            <input
              type="file"
              className="hidden"
              disabled={uploading}
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.docx,.xlsx,.pptx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadNewVersion(f);
                e.target.value = "";
              }}
            />
          </label>
        )}

        {canEdit && !isDeleted && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Edit details
          </button>
        )}

        {isOwner && !isDeleted && (
          <button
            onClick={deleteDocument}
            disabled={busy}
            className="rounded-md border border-red-900/70 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50"
          >
            Delete
          </button>
        )}
        {isOwner && isDeleted && (
          <>
            <button
              onClick={restoreDocument}
              disabled={busy}
              className="rounded-md border border-emerald-800 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-950/50"
            >
              Restore
            </button>
            <button
              onClick={purgeDocument}
              disabled={busy}
              className="rounded-md border border-red-900/70 px-4 py-2 text-sm text-red-300 hover:bg-red-950/50"
            >
              Purge forever
            </button>
          </>
        )}
      </div>

      {isAdmin && (
        <p className="rounded-md border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          You are viewing this as a platform administrator. Downloading here is
          a break-glass action: it is recorded in the audit trail as
          <span className="font-mono"> admin_override</span> with your account
          and cannot be hidden.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      {editing && (
        <form
          onSubmit={saveMetadata}
          className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
        >
          <div>
            <label className="mb-1 block text-sm text-zinc-300">Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
              required
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-300">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={2000}
              rows={3}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-300">Category</label>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              maxLength={40}
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
