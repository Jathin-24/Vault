import Link from "next/link";
import SignupForm from "@/components/auth/SignupForm";

export const metadata = { title: "Create account — TrustVault" };

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-bold text-zinc-950">
            TV
          </span>
          <span className="text-lg font-semibold text-zinc-100">TrustVault</span>
        </Link>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-6">
          <h1 className="mb-1 text-xl font-semibold text-white">
            Create your account
          </h1>
          <p className="mb-5 text-sm text-zinc-400">
            Email confirmation is required — grants to an address only activate
            for its verified owner.
          </p>
          <SignupForm />
        </div>
      </div>
    </main>
  );
}
