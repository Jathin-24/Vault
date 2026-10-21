"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

const EVENT_TYPES = [
  "",
  "auth.login",
  "auth.login_failed",
  "document.create",
  "document.read",
  "document.upload",
  "document.edit",
  "document.update",
  "document.delete",
  "document.restore",
  "document.purge",
  "access_denied",
  "grant.create",
  "grant.revoke",
  "grant.permission_changed",
  "suggestion.accepted",
  "suggestion.declined",
  "admin_override",
];

/** Filters for /audit — GET navigation, server re-queries with RLS applied. */
export default function AuditFilters({
  initial,
}: {
  initial: { eventType: string; outcome: string; from: string; to: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [eventType, setEventType] = useState(initial.eventType);
  const [outcome, setOutcome] = useState(initial.outcome);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const input =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500";

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const sp = new URLSearchParams();
    if (eventType) sp.set("eventType", eventType);
    if (outcome) sp.set("outcome", outcome);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    router.push(`${pathname}${sp.toString() ? `?${sp}` : ""}`);
  }

  return (
    <form onSubmit={apply} className="grid gap-2 md:grid-cols-5">
      <select
        aria-label="Event type"
        value={eventType}
        onChange={(e) => setEventType(e.target.value)}
        className={input}
      >
        {EVENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t || "All events"}
          </option>
        ))}
      </select>
      <select
        aria-label="Outcome"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        className={input}
      >
        <option value="">Any outcome</option>
        <option value="success">success</option>
        <option value="denied">denied</option>
        <option value="error">error</option>
      </select>
      <input
        type="date"
        aria-label="From"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className={input}
      />
      <input
        type="date"
        aria-label="To"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className={input}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => apply()}
          className="rounded-md border border-zinc-700 px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          Reset
        </button>
      </div>
    </form>
  );
}
