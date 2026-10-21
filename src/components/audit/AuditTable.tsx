"use client";

import { Fragment, useState } from "react";

export interface AuditEventRow {
  id: number;
  created_at: string;
  actor_email: string | null;
  actor_role: string;
  event_type: string;
  document_id: string | null;
  target_email: string | null;
  route: string | null;
  outcome: "success" | "denied" | "error";
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
}

const OUTCOME_STYLE: Record<string, string> = {
  success: "bg-zinc-800 text-zinc-300",
  denied: "bg-red-950/70 text-red-300 border border-red-900/60",
  error: "bg-amber-950/60 text-amber-300 border border-amber-900/60",
};

/**
 * Audit trail table. Rows are read-only everywhere in the product — this
 * component has no mutation affordances because none exist server-side.
 * Click a row to expand route, IP, user agent and the event's metadata.
 */
export default function AuditTable({
  events,
  showActor = false,
}: {
  events: AuditEventRow[];
  showActor?: boolean;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
        Nothing recorded yet. Reads, refusals, uploads and permission changes
        will appear here.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <div className="table-scroll overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Event</th>
              {showActor && <th className="px-4 py-3 font-medium">Actor</th>}
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40">
            {events.map((e) => (
              <Fragment key={e.id}>
                <tr
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="cursor-pointer hover:bg-zinc-900/60"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-400">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-200">
                    {e.event_type}
                  </td>
                  {showActor && (
                    <td className="max-w-[14rem] truncate px-4 py-2.5 text-zinc-400">
                      {e.actor_email ?? "system"}
                    </td>
                  )}
                  <td className="max-w-[14rem] truncate px-4 py-2.5 text-zinc-400">
                    {e.target_email ??
                      (e.document_id ? `doc ${e.document_id.slice(0, 8)}…` : "—")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${OUTCOME_STYLE[e.outcome] ?? ""}`}
                    >
                      {e.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-zinc-600">
                    {expanded === e.id ? "▾" : "▸"}
                  </td>
                </tr>
                {expanded === e.id && (
                  <tr className="bg-zinc-900/70">
                    <td colSpan={showActor ? 6 : 5} className="px-4 py-3">
                      <div className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                        <div>
                          <span className="text-zinc-500">route: </span>
                          <span className="font-mono">{e.route ?? "—"}</span>
                        </div>
                        <div>
                          <span className="text-zinc-500">ip: </span>
                          <span className="font-mono">{e.ip ?? "—"}</span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-zinc-500">user-agent: </span>
                          <span className="font-mono break-all">{e.user_agent ?? "—"}</span>
                        </div>
                        <div className="sm:col-span-2">
                          <span className="text-zinc-500">metadata: </span>
                          <pre className="mt-1 overflow-x-auto rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-300">
                            {JSON.stringify(e.metadata, null, 2)}
                          </pre>
                        </div>
                        <div className="sm:col-span-2 text-zinc-600">
                          event #{e.id}
                          {e.document_id && <> · document {e.document_id}</>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
