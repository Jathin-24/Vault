/**
 * AUDIT INTEGRITY UNDER DIRECT SQL — "what stops tampering?"
 *
 * The honest answer is structural, and this test proves it by ATTACKING the
 * database directly (no API, no app code in the way):
 *
 *   1. UPDATE/DELETE on audit_events → refused by an append-only trigger,
 *      even for the migration role (which is as powerful as it gets).
 *   2. A forged INSERT that bypasses tv_log_event() is *possible* for a
 *      superuser (documented accepted risk: prevention is impossible at that
 *      level) — but the hash chain DETECTS it: verification reports the first
 *      broken row. Detection, not prevention, is the claim, and this test
 *      holds the claim to its word.
 *
 * Everything runs inside a transaction that is always rolled back: the test
 * database's real chain is never poisoned.
 *
 * Needs DATABASE_URL (the same direct connection `npm run db:migrate` uses).
 * Skipped with a warning when it is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { DATABASE_URL } from "../helpers/env";

interface VerifyResult {
  ok: boolean;
  events?: number;
  broken_at?: number;
  reason?: string;
}

describe.skipIf(!DATABASE_URL)("audit chain integrity under direct SQL", () => {
  let pg: Client;

  beforeAll(async () => {
    pg = new Client({ connectionString: DATABASE_URL });
    await pg.connect();

    // tv_verify_audit_chain() demands an admin identity. On a raw SQL
    // connection there is no JWT — so we impersonate the seeded admin the
    // same way PostgREST would (auth.uid() reads these settings). This is
    // exactly the threat model being tested: maximum database privilege.
    const admins = await pg.query(
      "select id from profiles where platform_role = 'admin' and is_active limit 1"
    );
    const adminId = (admins.rows[0] as { id: string } | undefined)?.id;
    if (!adminId) {
      throw new Error("No active admin profile found — run `npm run db:seed` first.");
    }
    await pg.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: adminId, role: "authenticated" }),
    ]);
    await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [adminId]);
  }, 30_000);

  afterAll(async () => {
    if (pg) await pg.end().catch(() => undefined);
  });

  async function verify(): Promise<VerifyResult> {
    const res = await pg.query("select tv_verify_audit_chain() as result");
    return (res.rows[0] as { result: VerifyResult }).result;
  }

  it("chain verifies clean before we touch anything", async () => {
    const result = await verify();
    expect(result.ok).toBe(true);
    expect(result.events ?? 0).toBeGreaterThan(0);
  });

  it("UPDATE on audit_events is refused — even by the most privileged role", async () => {
    await expect(
      pg.query("update audit_events set outcome = 'success' where id = (select min(id) from audit_events)")
    ).rejects.toThrow(/append-only/i);
  });

  it("DELETE on audit_events is refused — refusals cannot be erased", async () => {
    await expect(
      pg.query("delete from audit_events where id = (select min(id) from audit_events)")
    ).rejects.toThrow(/append-only/i);
  });

  it("a forged row is DETECTED by chain verification (and rolled back)", async () => {
    try {
      await pg.query("begin");

      // Forge an event exactly as a superuser with direct SQL access could:
      // plausible columns, but hashes that were never produced by
      // tv_log_event().
      await pg.query(`
        insert into audit_events
          (created_at, actor_email, actor_role, event_type, route, outcome,
           metadata, metadata_sha256, prev_hash, event_hash)
        select
          now(), 'forged@evil.test', 'system', 'document.download',
          '/api/documents/:id/download', 'success',
          '{}'::jsonb,
          repeat('0', 64), repeat('0', 64), repeat('f', 64)
      `);

      const result = await verify();
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/mismatch/i);
    } finally {
      await pg.query("rollback");
    }

    // And the rollback left the real chain untouched.
    const after = await verify();
    expect(after.ok).toBe(true);
  });
});
