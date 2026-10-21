"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  platform_role: "user" | "admin";
  is_active: boolean;
  created_at: string;
}

/**
 * Directory + leaver switch. Deactivation cuts access on the next request
 * (every authorisation decision checks is_active); the audit event for the
 * change is written inside the admin RPC, not here.
 */
export default function UsersTable({ selfId }: { selfId?: string }) {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/users");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to load users.");
      setUsers([]);
      return;
    }
    setUsers(data.users);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(userId: string, body: Record<string, unknown>, confirmMsg: string) {
    if (!confirm(confirmMsg)) return;
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...body }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Change failed.");
    }
    load();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {users === null && <p className="text-sm text-zinc-500">Loading…</p>}

      {users !== null && (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Person</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-900/60">
                  <td className="px-4 py-2.5">
                    <div className="text-zinc-100">{u.full_name || "—"}</div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        u.platform_role === "admin"
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "bg-zinc-800 text-zinc-300"
                      }`}
                    >
                      {u.platform_role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        u.is_active ? "bg-zinc-800 text-zinc-300" : "bg-red-950/70 text-red-300"
                      }`}
                    >
                      {u.is_active ? "active" : "deactivated"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {selfId !== u.id ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() =>
                            patch(
                              u.id,
                              { platformRole: u.platform_role === "admin" ? "user" : "admin" },
                              `Change ${u.email}'s role to ${u.platform_role === "admin" ? "user" : "admin"}?`
                            )
                          }
                          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          {u.platform_role === "admin" ? "Demote" : "Promote"}
                        </button>
                        <button
                          onClick={() =>
                            patch(
                              u.id,
                              { isActive: !u.is_active },
                              u.is_active
                                ? `Deactivate ${u.email}? They lose ALL access immediately, including documents shared with them.`
                                : `Reactivate ${u.email}?`
                            )
                          }
                          className={`rounded border px-2 py-1 text-xs ${
                            u.is_active
                              ? "border-red-900/70 text-red-300 hover:bg-red-950/50"
                              : "border-emerald-800 text-emerald-300 hover:bg-emerald-950/50"
                          }`}
                        >
                          {u.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">you</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
