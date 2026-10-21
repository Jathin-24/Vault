"use client";

import { useEffect, useState } from "react";
import AdminAuditFeed from "@/components/admin/AdminAuditFeed";
import AdminDocumentsTable from "@/components/admin/AdminDocumentsTable";
import UsersTable from "@/components/admin/UsersTable";

type Tab = "audit" | "documents" | "users";

/** Console tabs: each panel fetches its own admin API (admin-only server-side). */
export default function AdminTabs({ selfId }: { selfId?: string }) {
  const [tab, setTab] = useState<Tab>("audit");
  // Keys force a remount so panels refetch when switched back.
  const [nonce, setNonce] = useState(0);
  useEffect(() => setNonce((n) => n + 1), [tab]);

  const tabStyle = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg ${
      tab === t
        ? "bg-zinc-900 text-white border-b-2 border-emerald-500"
        : "text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div>
      <div className="flex gap-1 border-b border-zinc-800">
        <button className={tabStyle("audit")} onClick={() => setTab("audit")}>
          Audit trail
        </button>
        <button className={tabStyle("documents")} onClick={() => setTab("documents")}>
          All documents
        </button>
        <button className={tabStyle("users")} onClick={() => setTab("users")}>
          People
        </button>
      </div>
      <div className="pt-4">
        {tab === "audit" && <AdminAuditFeed key={`audit-${nonce}`} />}
        {tab === "documents" && <AdminDocumentsTable key={`docs-${nonce}`} />}
        {tab === "users" && <UsersTable key={`users-${nonce}`} selfId={selfId} />}
      </div>
    </div>
  );
}
