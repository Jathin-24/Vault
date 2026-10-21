/**
 * ADMIN + AUDIT READ-ONLY — the super admin sees everything and can change
 * nothing in the evidence.
 *
 * Four claims, each tested from the outside:
 *   1. the admin sees the FULL trail (every actor, refusals included);
 *   2. no one else gets anywhere near the admin surface (403);
 *   3. admin CONTENT access exists only via break-glass, and every use is
 *      itself audited (admin_override);
 *   4. the audit log cannot be modified through the API — and the database
 *      refuses writes to it even when the API is bypassed (append-only
 *      trigger + hash chain, tested directly in audit-integrity.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HTTP_ENABLED } from "../helpers/env";
import { asAccount, DEMO_ACCOUNTS } from "../helpers/accounts";
import type { TestClient } from "../helpers/http";
import {
  createDocument,
  deleteDocument,
  download,
  sha256Hex,
  uniqueName,
  uploadOk,
  type CreatedDocument,
} from "../helpers/fixtures";

describe.skipIf(!HTTP_ENABLED)("admin sees everything, changes nothing", () => {
  let admin: TestClient;
  let owner: TestClient;
  let outsider: TestClient;
  let doc: CreatedDocument;
  let content: Uint8Array;

  beforeAll(async () => {
    admin = await asAccount("admin");
    owner = await asAccount("owner");
    outsider = await asAccount("outsider");

    doc = await createDocument(owner, uniqueName("AdminView"));
    content = Buffer.from("admin visibility test payload");
    await uploadOk(owner, doc.id, "admin.txt", content);
  }, 60_000);

  afterAll(async () => {
    if (doc && owner) await deleteDocument(owner, doc.id);
  });

  // ── 1. full visibility ───────────────────────────────────────────────────

  it("admin sees the full trail, including other people's events on this document", async () => {
    const res = await admin.get(`/api/admin/audit?documentId=${doc.id}`);
    expect(res.status).toBe(200);
    const events = res.json<{
      events: { event_type: string; actor_email: string | null }[];
      total: number;
    }>().events;

    expect(events.some((e) => e.event_type === "document.create")).toBe(true);
    expect(events.some((e) => e.event_type === "document.upload")).toBe(true);
    expect(events.some((e) => e.actor_email === DEMO_ACCOUNTS.owner)).toBe(true);
  });

  it("admin sees metadata of any document (but only metadata)", async () => {
    const res = await admin.get(`/api/documents/${doc.id}`);
    expect(res.status).toBe(200);
    const body = res.json<{ document: { myPermission: string; owner: { email: string } } }>();
    expect(body.document.myPermission).toBe("admin");
    expect(body.document.owner.email).toBe(DEMO_ACCOUNTS.owner);
  });

  // ── 2. nobody else reaches the admin surface ─────────────────────────────

  it("non-admins get 403 on every admin route", async () => {
    for (const account of [owner, outsider]) {
      const audit = await account.get("/api/admin/audit");
      const summary = await account.get("/api/admin/summary");
      const users = await account.get("/api/admin/users");
      const anomalies = await account.get("/api/admin/anomalies");
      const verify = await account.post("/api/admin/verify");
      for (const res of [audit, summary, users, anomalies, verify]) {
        expect(res.status).toBe(403);
      }
    }
  });

  // ── 3. break-glass content access, audited ───────────────────────────────

  it("admin content access requires break-glass and every use is audited", async () => {
    // The plain download path still refuses — the RPC read decision is deny.
    // (The route then escalates to tv_admin_read_document, which logs.)
    const dl = await download(admin, doc.id);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("x-trustvault-access")).toBe("admin-override");
    expect(sha256Hex(dl.bytes)).toBe(sha256Hex(content)); // right bytes

    const audit = await admin.get(
      `/api/admin/audit?eventType=admin_override&documentId=${doc.id}`
    );
    const events = audit.json<{ events: { actor_email: string | null }[] }>().events;
    expect(events.some((e) => e.actor_email === DEMO_ACCOUNTS.admin)).toBe(true);
  });

  it("a non-admin downloading gets 404 and NO override path exists for them", async () => {
    const dl = await download(outsider, doc.id);
    expect(dl.status).toBe(404);
    expect(dl.headers.get("x-trustvault-access")).toBeNull();
  });

  // ── 4. the evidence cannot be touched ────────────────────────────────────

  it("the API offers no way to write the audit log — write verbs do not exist", async () => {
    const post = await admin.post("/api/admin/audit", { event_type: "forged" });
    const patch = await admin.patch("/api/admin/audit", { outcome: "success" });
    const del = await admin.del("/api/admin/audit?eventType=access_denied");

    // Route exports GET only → 405 Method Not Allowed on the others.
    expect(post.status).toBe(405);
    expect(patch.status).toBe(405);
    expect(del.status).toBe(405);
  });

  it("the own-trail endpoint has no write verbs either", async () => {
    const post = await owner.post("/api/audit", { event_type: "self_forged" });
    expect(post.status).toBe(405);
  });

  it("chain verification reports clean via the API (admin)", async () => {
    const res = await admin.post("/api/admin/verify");
    expect(res.status).toBe(200);
    const { verification } = res.json<{ verification: { ok: boolean; events: number } }>();
    expect(verification.ok).toBe(true);
    expect(verification.events).toBeGreaterThan(0);
  });
});
