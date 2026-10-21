import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import AdminTabs from "@/components/admin/AdminTabs";
import ChainVerifyButton from "@/components/admin/ChainVerifyButton";

export const metadata = { title: "Admin console — TrustVault" };

interface Summary {
  users: number;
  active_users: number;
  documents_active: number;
  documents_deleted: number;
  grants_active: number;
  grants_revoked: number;
  events_total: number;
  events_24h: number;
  denied_24h: number;
}

interface Anomaly {
  kind: string;
  subject: string;
  event_count: number;
  last_at: string;
}

const ANOMALY_LABEL: Record<string, string> = {
  denied_storm: "Denied access storm",
  login_failures: "Repeated login failures",
  mass_download: "Mass download",
  grant_spam: "Rapid permission grants",
  admin_override: "Administrator break-glass read",
};

export default async function AdminPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("platform_role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  // Viewers/owners don't get an admin page at all (and the APIs would 403).
  if (!profile?.is_active || profile.platform_role !== "admin") redirect("/dashboard");

  const [summaryRes, anomaliesRes] = await Promise.all([
    supabase.rpc("tv_admin_summary"),
    supabase.rpc("tv_admin_anomalies"),
  ]);

  const summary = (summaryRes.data ?? {}) as Summary;
  const anomalies = (anomaliesRes.data ?? []) as Anomaly[];

  const cards: Array<[string, number | string]> = [
    ["People", summary.users ?? 0],
    ["Active users", summary.active_users ?? 0],
    ["Documents", summary.documents_active ?? 0],
    ["Deleted (retention)", summary.documents_deleted ?? 0],
    ["Active grants", summary.grants_active ?? 0],
    ["Revoked grants", summary.grants_revoked ?? 0],
    ["Audit events", summary.events_total ?? 0],
    ["Refusals (24h)", summary.denied_24h ?? 0],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Admin console</h1>
          <p className="text-sm text-zinc-500">
            Full visibility, zero write access to the audit trail. Content
            reads are break-glass and record themselves as{" "}
            <span className="font-mono text-amber-400">admin_override</span>.
          </p>
        </div>
        <ChainVerifyButton />
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {cards.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"
          >
            <div className="text-xl font-semibold text-white">{value}</div>
            <div className="text-xs text-zinc-500">{label}</div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Worth noticing (24h)
        </h2>
        {anomalies.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 p-5 text-sm text-zinc-500">
            Nothing flagged. Thresholds: ≥5 refusals by one actor, ≥5 login
            failures on one email, ≥20 downloads by one actor, ≥10 grants by one
            owner, any break-glass read.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Signal</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Events</th>
                  <th className="px-4 py-3 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70 bg-zinc-950/40">
                {anomalies.map((a, i) => (
                  <tr key={`${a.kind}-${a.subject}-${i}`} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-red-950/60 px-2 py-0.5 text-xs text-red-300">
                        {ANOMALY_LABEL[a.kind] ?? a.kind}
                      </span>
                    </td>
                    <td className="max-w-[20rem] truncate px-4 py-2.5 text-zinc-300">
                      {a.subject}
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{a.event_count}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">
                      {new Date(a.last_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AdminTabs selfId={user.id} />
    </div>
  );
}
