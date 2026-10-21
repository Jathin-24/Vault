import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-bold text-zinc-950">
            TV
          </span>
          <span className="text-lg font-semibold tracking-tight">TrustVault</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-emerald-500 px-3 py-2 font-medium text-zinc-950 hover:bg-emerald-400"
          >
            Create account
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
          Confidential documents, closed doors
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          The wrong person can never read the file.
          <span className="block text-emerald-400">
            And you can prove who did.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-zinc-400">
          Salary letters, contracts, drawings, audit papers. TrustVault grants
          access per document, to named people, by email — never by folder —
          and records every read and every refusal in a hash-chained audit
          trail nobody can quietly edit.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-emerald-500 px-5 py-3 font-medium text-zinc-950 hover:bg-emerald-400"
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-700 px-5 py-3 font-medium text-zinc-200 hover:bg-zinc-900"
          >
            Sign in to the demo
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-24 md:grid-cols-3">
        {[
          {
            title: "The database decides, every time",
            body: "Row Level Security in Postgres plus a per-request authorisation function. There is no route that can forget the check, and no hidden-button security. Missing access looks exactly like a document that never existed.",
          },
          {
            title: "Evidence, not vibes",
            body: "Uploads, downloads, permission changes, deletions and refusals land in an append-only table with a SHA-256 hash chain. Edit or delete a row and verification stops at that event. The admin can read all of it and change none of it.",
          },
          {
            title: "Revocation bites immediately",
            body: "No signed URLs, no bearer links. Bytes flow through the server, which re-reads the grant table before streaming a single one. Revoke access and the next request — from any device, any session — is refused and logged.",
          },
        ].map((f) => (
          <article
            key={f.title}
            className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6"
          >
            <h2 className="mb-3 text-lg font-semibold text-white">{f.title}</h2>
            <p className="text-sm leading-relaxed text-zinc-400">{f.body}</p>
          </article>
        ))}
      </section>

      <footer className="border-t border-zinc-900 py-8 text-center text-xs text-zinc-500">
        TrustVault — built for the hackathon challenge. Roles: administrator,
        document owner, viewer/editor. See README for the permission model.
      </footer>
    </main>
  );
}
