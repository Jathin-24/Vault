import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import AuditTable, { type AuditEventRow } from "@/components/audit/AuditTable";
import AuditFilters from "@/components/audit/AuditFilters";

export const metadata = { title: "My activity — TrustVault" };

const EVENT_RE = /^[a-z_.]{1,80}$/i;

export default async function MyAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = await searchParams;
  const pick = (k: string) => {
    const v = raw[k];
    return typeof v === "string" ? v : "";
  };

  const eventType = pick("eventType");
  const outcome = pick("outcome");
  const from = pick("from");
  const to = pick("to");
  const offset = Math.max(Number(pick("offset") ?? 0) || 0, 0);

  let query = supabase
    .from("audit_events")
    .select(
      "id, created_at, actor_email, actor_role, event_type, document_id, target_email, route, outcome, ip, user_agent, metadata",
      { count: "exact" }
    );

  if (eventType && EVENT_RE.test(eventType)) query = query.eq("event_type", eventType);
  if (["success", "denied", "error"].includes(outcome)) query = query.eq("outcome", outcome);
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  const { data: events, count } = await query
    .order("id", { ascending: false })
    .range(offset, offset + 49);

  const total = count ?? 0;

  function pageLink(target: number) {
    const sp = new URLSearchParams();
    if (eventType) sp.set("eventType", eventType);
    if (outcome) sp.set("outcome", outcome);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (target > 0) sp.set("offset", String(target));
    return `/audit${sp.toString() ? `?${sp}` : ""}`;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">My activity</h1>
        <p className="text-sm text-zinc-500">
          Everything you did and everything refused to you, plus events on
          documents you own. Records are append-only — nobody, including
          administrators, can edit them.
        </p>
      </div>

      <AuditFilters
        initial={{ eventType, outcome, from, to }}
      />

      <AuditTable events={(events ?? []) as unknown as AuditEventRow[]} showActor />

      {(offset > 0 || offset + 50 < total) && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            {total} events · showing {offset + 1}–{Math.min(offset + 50, total)}
          </span>
          <div className="flex gap-2">
            {offset > 0 && (
              <a href={pageLink(Math.max(0, offset - 50))} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">
                ← Newer
              </a>
            )}
            {offset + 50 < total && (
              <a href={pageLink(offset + 50)} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800">
                Older →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
