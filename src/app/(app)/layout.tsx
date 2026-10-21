import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import LogoutButton from "@/components/layout/LogoutButton";

// Every page in this group renders per-request (session + RLS-scoped data):
// nothing here is ever static or cacheable across users.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, platform_role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) redirect("/login");

  if (!profile.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <div className="max-w-md rounded-xl border border-amber-800/60 bg-amber-950/30 p-6 text-center">
          <h1 className="text-lg font-semibold text-amber-200">
            Account deactivated
          </h1>
          <p className="mt-2 text-sm text-amber-300/80">
            This account has been deactivated. Deactivated users lose every
            grant immediately — including documents they could open a moment
            ago.
          </p>
          <div className="mt-4 flex justify-center">
            <LogoutButton />
          </div>
        </div>
      </main>
    );
  }

  const isAdmin = profile.platform_role === "admin";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900 bg-zinc-950/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-sm font-bold text-zinc-950">
                TV
              </span>
              <span className="font-semibold tracking-tight">TrustVault</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-900 hover:text-white"
              >
                Documents
              </Link>
              <Link
                href="/audit"
                className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-900 hover:text-white"
              >
                My activity
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-zinc-900 hover:text-white"
                >
                  Admin console
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm sm:block">
              <div className="font-medium text-zinc-200">
                {profile.full_name || profile.email}
              </div>
              <div className="text-xs text-zinc-500">
                {profile.email}
                {isAdmin && (
                  <span className="ml-1 rounded bg-emerald-900/60 px-1.5 py-0.5 text-emerald-300">
                    admin
                  </span>
                )}
              </div>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
