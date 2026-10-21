"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/lib/constants";
import type { FolderRow } from "@/components/folders/FolderSidebar";

/**
 * Upload flow: create the document record, then stream the bytes to
 * /api/documents/:id/versions where the server validates content.
 * Client-side UX only — every rule is enforced server-side again.
 */
export default function UploadDocumentModal({ folders }: { folders: FolderRow[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("general");
  const [folderId, setFolderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function pickFile(f: File | null) {
    setFile(f);
    setDetails([]);
    if (f && !title) setTitle(f.name.replace(/\.[a-z0-9]+$/i, ""));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setDetails([]);
    try {
      const createRes = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category,
          folderId: folderId || null,
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        setError(created.error ?? "Could not create document.");
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      const uploadRes = await fetch(`/api/documents/${created.document.id}/versions`, {
        method: "POST",
        body: fd,
      });
      const uploaded = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) {
        setError(uploaded.error ?? "Upload failed.");
        setDetails(uploaded.details ?? []);
        return;
      }

      setOpen(false);
      setFile(null);
      setTitle("");
      router.push(`/documents/${created.document.id}`);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
      >
        Upload document
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5"
          >
            <h2 className="mb-4 text-lg font-semibold text-white">
              Upload a document
            </h2>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-zinc-300">File</label>
                <input
                  ref={fileRef}
                  type="file"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.docx,.xlsx,.pptx"
                  className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-700"
                />
                <p className="mt-1 text-xs text-zinc-600">
                  pdf, png, jpg, webp, txt, md, csv, docx, xlsx, pptx · max 25 MB
                  · content is verified against its extension server-side.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-300">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                  className={input}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-zinc-300">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={input}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-zinc-300">
                    Folder (organising only)
                  </label>
                  <select
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    className={input}
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                <p>{error}</p>
                {details.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !file}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
