"use client";

import { useEffect, useState } from "react";
import AuditTable, { type AuditEventRow } from "@/components/audit/AuditTable";

/** Full-system audit feed with filters + pagination (admin API only). */
export default function AdminAuditFeed() {
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [eventType, setEventType] = useState("");
  const [actor, setActor] = useState("");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  async function load() {
    setError(null);
    const sp = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (eventType) sp.set("eventType", eventType);
    if (actor) sp.set("actor", actor);
    if (outcome) sp.set("outcome", outcome);
    const res = await fetch(`/api/admin/audit?${sp}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to load audit feed.");
      setEvents([]);
      return;
    }
    setEvents(data.events);
    setTotal(data.total);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const input =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500";

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-4">
        <input
          placeholder="Event type e.g. access_denied"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className={input}
        />
        <input
          placeholder="Actor contains…"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className={input}
        />
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className={input}
        >
          <option value="">Any outcome</option>
          <option value="success">success</option>
          <option value="denied">denied</option>
          <option value="error">error</option>
        </select>
        <button
          onClick={() => { setOffset(0); load(); }}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
        >
          Apply
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {events === null && <p className="text-sm text-zinc-500">Loading…</p>}
      {events !== null && (
        <AuditTable events={events} showActor />
      )}

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {total} events · showing {events?.length ?? 0} from {offset + 1}
        </span>
        <div className="flex gap-2">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40"
          >
            ← Newer
          </button>
          <button
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40"
          >
            Older →
          </button>
        </div>
      </div>
    </div>
  );
}
