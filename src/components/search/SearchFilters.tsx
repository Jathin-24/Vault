"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { CATEGORIES } from "@/lib/constants";

interface Props {
  initial: {
    q: string;
    owner: string;
    category: string;
    from: string;
    to: string;
    status: string;
    folderId: string;
  };
}

/** Search by name, owner, category and date — GETs /dashboard with params. */
export default function SearchFilters({ initial }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(initial.q);
  const [owner, setOwner] = useState(initial.owner);
  const [category, setCategory] = useState(initial.category);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [status, setStatus] = useState(initial.status);

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (owner.trim()) sp.set("owner", owner.trim());
    if (category) sp.set("category", category);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (status !== "active") sp.set("status", status);
    if (initial.folderId) sp.set("folderId", initial.folderId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function clear() {
    setQ(""); setOwner(""); setCategory(""); setFrom(""); setTo(""); setStatus("active");
    router.push(pathname);
  }

  const input =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500";

  return (
    <form onSubmit={apply} className="grid gap-2 md:grid-cols-6">
      <div className="md:col-span-2">
        <input
          aria-label="Search name and description"
          placeholder="Search name or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={input}
        />
      </div>
      <div>
        <input
          aria-label="Filter by owner"
          placeholder="Owner email…"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className={input}
        />
      </div>
      <div>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={input}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <input
          type="date"
          aria-label="From date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={input}
        />
        <input
          type="date"
          aria-label="To date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={input}
        />
      </div>
      <div className="flex gap-2">
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={input}
        >
          <option value="active">Active</option>
          <option value="deleted">Deleted</option>
          <option value="all">All</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
        >
          Search
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded-md border border-zinc-700 px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          ✕
        </button>
      </div>
    </form>
  );
}
