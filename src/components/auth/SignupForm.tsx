"use client";

import { useState } from "react";
import Link from "next/link";
import { checkPasswordStrength } from "@/lib/auth/passwordPolicy";

export default function SignupForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const strength = checkPasswordStrength(password, email);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Signup failed.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
        Check <span className="font-medium">{email}</span> for a confirmation
        link, then sign in. (Demo accounts below are already confirmed.)
        <p className="mt-3">
          <Link href="/login" className="text-emerald-400 hover:underline">
            Go to sign in →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-zinc-300" htmlFor="fullName">
          Full name
        </label>
        <input
          id="fullName"
          type="text"
          required
          maxLength={120}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm text-zinc-300" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm text-zinc-300" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-500"
        />
        <p className="mt-1 text-xs text-zinc-500">
          At least 12 characters, mixing three of: lowercase, uppercase,
          digits, symbols. Must not contain your email.
        </p>
        {password.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs">
            {strength.problems.map((p) => (
              <li key={p} className="text-amber-400">
                • {p}
              </li>
            ))}
            {strength.ok && <li className="text-emerald-400">• Password looks good.</li>}
          </ul>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !strength.ok}
        className="w-full rounded-md bg-emerald-500 px-4 py-2.5 font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {busy ? "Creating…" : "Create account"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        Already registered?{" "}
        <Link href="/login" className="text-emerald-400 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
