"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Grant {
  id: string;
  grantee_email: string;
  permission: "read" | "edit";
  created_at: string;
  revoked_at: string | null;
}

interface Suggestion {
  id: string;
  suggested_email: string;
  full_name: string;
  reason: string;
  score: number;
}

/**
 * Google-Sheets-style sharing: paste an email, choose read/edit, remove
 * anyone at any time. Includes the AI-assist panel — suggestions ONLY; the
 * machine never grants anything, and both the suggestion and your decision
 * are written to the audit trail.
 */
export default function ShareDialog({
  documentId,
  canManage,
}: {
  documentId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"people" | "suggest">("people");
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"read" | "edit">("read");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);

  async function loadGrants() {
    const res = await fetch(`/api/documents/${documentId}/grants`);
    const data = await res.json().catch(() => ({}));
    setGrants(res.ok ? data.grants : []);
  }

  async function loadSuggestions() {
    setSuggestions(null);
    const res = await fetch(`/api/documents/${documentId}/suggestions`);
    const data = await res.json().catch(() => ({}));
    setSuggestions(res.ok ? data.suggestions : []);
  }

  async function openDialog() {
    setOpen(true);
    setError(null);
    if (canManage) loadGrants();
  }

  async function addGrant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, permission }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not share.");
      return;
    }
    setEmail("");
    loadGrants();
    router.refresh();
  }

  async function changePermission(grantId: string, next: "read" | "edit") {
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/grants`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId, permission: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not change permission.");
    }
    loadGrants();
    router.refresh();
  }

  async function revoke(grantId: string, who: string) {
    if (!confirm(`Revoke ${who}'s access? It stops working on their very next request.`)) return;
    setError(null);
    const res = await fetch(
      `/api/documents/${documentId}/grants?grantId=${encodeURIComponent(grantId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not revoke.");
    }
    loadGrants();
    router.refresh();
  }

  async function decide(suggestionId: string, decision: "accepted" | "declined") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suggestionId, decision }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not record decision.");
      return;
    }
    loadSuggestions();
    if (decision === "accepted") loadGrants();
    router.refresh();
  }

  const visibleGrants = (grants ?? []).filter((g) =>
    showRevoked ? true : g.revoked_at === null
  );

  return (
    <>
      <button
        onClick={openDialog}
        className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
      >
        🔒 Sharing
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Share document</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded px-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex gap-1 border-b border-zinc-800 text-sm">
              <button
                onClick={() => { setTab("people"); if (canManage) loadGrants(); }}
                className={`px-3 py-2 ${tab === "people" ? "border-b-2 border-emerald-500 text-white" : "text-zinc-400"}`}
              >
                People
              </button>
              {canManage && (
                <button
                  onClick={() => { setTab("suggest"); loadSuggestions(); }}
                  className={`px-3 py-2 ${tab === "suggest" ? "border-b-2 border-emerald-500 text-white" : "text-zinc-400"}`}
                >
                  Suggest people ✨
                </button>
              )}
            </div>

            {tab === "people" && canManage && (
              <form onSubmit={addGrant} className="mb-4 flex gap-2">
                <input
                  type="email"
                  required
                  placeholder="person@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as "read" | "edit")}
                  className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm outline-none focus:border-emerald-500"
                >
                  <option value="read">Can view</option>
                  <option value="edit">Can edit</option>
                </select>
                <button
                  disabled={busy}
                  className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
                >
                  Share
                </button>
              </form>
            )}

            {error && (
              <p className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            {tab === "people" && (
              <div className="space-y-2">
                {grants === null && (
                  <p className="text-sm text-zinc-500">Loading people…</p>
                )}
                {grants !== null && visibleGrants.length === 0 && (
                  <p className="text-sm text-zinc-500">
                    Only you can see this document.
                  </p>
                )}
                {visibleGrants.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm text-zinc-200">
                        {g.grantee_email}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {g.revoked_at
                          ? `revoked ${new Date(g.revoked_at).toLocaleString()}`
                          : `granted ${new Date(g.created_at).toLocaleString()}`}
                      </div>
                    </div>
                    {!g.revoked_at && (
                      <div className="flex items-center gap-2">
                        <select
                          value={g.permission}
                          onChange={(e) =>
                            changePermission(g.id, e.target.value as "read" | "edit")
                          }
                          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs outline-none"
                        >
                          <option value="read">Can view</option>
                          <option value="edit">Can edit</option>
                        </select>
                        <button
                          onClick={() => revoke(g.id, g.grantee_email)}
                          className="rounded border border-red-900/70 px-2 py-1 text-xs text-red-300 hover:bg-red-950/50"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {grants !== null && grants.some((g) => g.revoked_at) && (
                  <label className="flex items-center gap-2 pt-1 text-xs text-zinc-500">
                    <input
                      type="checkbox"
                      checked={showRevoked}
                      onChange={(e) => setShowRevoked(e.target.checked)}
                    />
                    Show revoked grants (history)
                  </label>
                )}
              </div>
            )}

            {tab === "suggest" && (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-zinc-500">
                  Suggestions are computed from people who already collaborate
                  with you. The system never adds anyone on its own — you
                  confirm each one, and your confirmation plus the reason are
                  both recorded in the audit trail.
                </p>
                {suggestions === null && (
                  <p className="text-sm text-zinc-500">Thinking…</p>
                )}
                {suggestions !== null && suggestions.length === 0 && (
                  <p className="text-sm text-zinc-500">
                    No strong candidates — grant access by email instead.
                  </p>
                )}
                {(suggestions ?? []).map((s) => (
                  <div
                    key={s.suggested_email}
                    className="rounded-md border border-zinc-800 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-zinc-200">
                          {s.full_name || s.suggested_email}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          {s.suggested_email} · {s.reason} ·{" "}
                          {(Number(s.score) * 100).toFixed(0)}% match
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          disabled={busy}
                          onClick={() => decide(s.id, "accepted")}
                          className="rounded bg-emerald-500 px-2 py-1 text-xs font-medium text-zinc-950 disabled:opacity-60"
                        >
                          Grant view
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => decide(s.id, "declined")}
                          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400"
                        >
                          Not them
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 border-t border-zinc-800 pt-3 text-[11px] leading-snug text-zinc-600">
              Access is checked on every request — revoking takes effect
              immediately, including for sessions and devices already signed in.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
