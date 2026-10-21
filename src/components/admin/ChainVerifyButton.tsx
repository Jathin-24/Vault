"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Verification {
  ok: boolean;
  events: number;
  broken_at?: number;
  reason?: string;
  head?: string;
}

/**
 * Recomputes the audit hash chain in the database (tv_verify_audit_chain).
 * Green here means: no row was edited, deleted or reordered since genesis.
 */
export default function ChainVerifyButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "checking" | "done">("idle");
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setState("checking");
    setError(null);
    try {
      const res = await fetch("/api/admin/verify", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Verification failed.");
        setState("idle");
        return;
      }
      setResult(data.verification);
      setState("done");
      router.refresh();
    } catch {
      setError("Network error.");
      setState("idle");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={verify}
        disabled={state === "checking"}
        className="rounded-md border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-60"
      >
        {state === "checking" ? "Verifying…" : "Verify audit chain"}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
      {state === "done" && result && (
        <span
          className={`text-sm ${result.ok ? "text-emerald-400" : "text-red-400"}`}
        >
          {result.ok
            ? `✓ ${result.events} events intact · head ${result.head?.slice(0, 12)}…`
            : `✗ chain broken at event #${result.broken_at} (${result.reason})`}
        </span>
      )}
    </div>
  );
}
