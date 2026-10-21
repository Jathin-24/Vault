/**
 * CROSS-USER ISOLATION — the core security claim, tested against the real
 * running app and the real database.
 *
 * Scenario: Ava (owner) uploads a document and shares it — "edit" with Eddie,
 * "read" with Vera. Otto (outsider) has NO grant. Every assertion here has a
 * mirror-image control: if the test simply refused everything, the positive
 * cases (Eddie can edit, Vera can read) would fail instead. Each negative
 * assertion therefore PROVES the corresponding permission exists and is
 * enforced, not that the endpoint is broken.
 *
 * Kill-switch property: these tests fail if the RLS policies are dropped
 * (Otto's requests would return 200 instead of 404). Dropping the RPC alone
 * is caught too — but by the evidence assertions in revocation.test.ts: no
 * RPC call means no access_denied events, and those tests fail. Two
 * independent layers, two independent tests; both have to stay honest.
 *
 * Status-code rule under test: a stranger gets 404 ("Not found.") — never
 * 403 — so document IDs cannot be enumerated. A known-but-unprivileged
 * grantee gets 403: they already know the document exists.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HTTP_ENABLED } from "../helpers/env";
import { asAccount, DEMO_ACCOUNTS } from "../helpers/accounts";
import { anonymous, type TestClient } from "../helpers/http";
import {
  createDocument,
  deleteDocument,
  download,
  listGrants,
  share,
  uniqueName,
  uploadOk,
  uploadVersion,
  type CreatedDocument,
} from "../helpers/fixtures";

describe.skipIf(!HTTP_ENABLED)("cross-user isolation", () => {
  let owner: TestClient;
  let editor: TestClient;
  let viewer: TestClient;
  let outsider: TestClient;
  let doc: CreatedDocument;
  const marker = `isolation-${Date.now()}`;

  beforeAll(async () => {
    owner = await asAccount("owner");
    editor = await asAccount("editor");
    viewer = await asAccount("viewer");
    outsider = await asAccount("outsider");

    doc = await createDocument(owner, uniqueName("Isolation"));
    await uploadOk(owner, doc.id, "isolation.txt", Buffer.from(`secret ${marker}`));
    await share(owner, doc.id, DEMO_ACCOUNTS.editor, "edit");
    await share(owner, doc.id, DEMO_ACCOUNTS.viewer, "read");
  }, 60_000);

  afterAll(async () => {
    if (doc && owner) await deleteDocument(owner, doc.id);
  });

  // ── metadata ─────────────────────────────────────────────────────────────

  it("outsider gets 404 for metadata — identical to a UUID that never existed", async () => {
    const real = await outsider.get(`/api/documents/${doc.id}`);
    const fake = await outsider.get(
      "/api/documents/00000000-0000-4000-8000-000000000000"
    );

    expect(real.status).toBe(404);
    expect(fake.status).toBe(404);
    // Byte-identical responses: an attacker learns nothing from the difference.
    expect(real.text).toBe(fake.text);
  });

  it("owner CAN see the same document (positive control)", async () => {
    const res = await owner.get(`/api/documents/${doc.id}`);
    expect(res.status).toBe(200);
    expect(res.json<{ document: { id: string; title: string } }>().document.title).toBe(
      doc.title
    );
  });

  // ── content ──────────────────────────────────────────────────────────────

  it("outsider download is refused with zero file bytes", async () => {
    const res = await download(outsider, doc.id);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-disposition")).toBeNull(); // no attachment headers
    expect(new TextDecoder().decode(res.bytes)).not.toContain(marker);
  });

  it("read grantee CAN download, byte-for-byte (positive control)", async () => {
    const res = await download(viewer, doc.id);
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(res.bytes)).toContain(marker);
  });

  // ── writes ───────────────────────────────────────────────────────────────

  it("outsider cannot modify metadata or delete — and the document survives", async () => {
    const patch = await outsider.patch(`/api/documents/${doc.id}`, { title: "hacked" });
    const del = await outsider.del(`/api/documents/${doc.id}`);

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);

    const still = await owner.get(`/api/documents/${doc.id}`);
    expect(still.json<{ document: { title: string; status: string } }>().document.title).toBe(
      doc.title
    );
    expect(still.json<{ document: { status: string } }>().document.status).toBe("active");
  });

  it("read grantee cannot write (403: they know it exists)", async () => {
    const patch = await viewer.patch(`/api/documents/${doc.id}`, { title: "nope" });
    const upload = await uploadVersion(viewer, doc.id, "evil.txt", Buffer.from("x"), "text/plain");

    expect(patch.status).toBe(403);
    expect(upload.status).toBe(403);
  });

  it("edit grantee CAN write but still cannot delete (positive + negative control)", async () => {
    const patch = await editor.patch(`/api/documents/${doc.id}`, {
      description: "edited by editor",
    });
    expect(patch.status).toBe(200);

    const upload = await uploadOk(editor, doc.id, "editor-v2.txt", Buffer.from("v2 content"));
    expect(upload.version_no).toBe(2);

    const del = await editor.del(`/api/documents/${doc.id}`);
    expect(del.status).toBe(403); // owner-only, and the DB guard trigger agrees
  });

  // ── sharing ──────────────────────────────────────────────────────────────

  it("grant holders cannot see the grant list (it would leak other emails)", async () => {
    const asEditor = await editor.get(`/api/documents/${doc.id}/grants`);
    const asViewer = await viewer.get(`/api/documents/${doc.id}/grants`);
    const asOutsider = await outsider.get(`/api/documents/${doc.id}`);

    expect(asEditor.status).toBe(404);
    expect(asViewer.status).toBe(404);
    expect(asOutsider.status).toBe(404);

    // The owner sees it.
    const asOwner = await listGrants(owner, doc.id);
    expect(asOwner.map((g) => g.grantee_email).sort()).toEqual(
      [DEMO_ACCOUNTS.editor, DEMO_ACCOUNTS.viewer].sort()
    );
  });

  it("editors cannot re-share — the privilege-escalation path is closed", async () => {
    const create = await editor.post(`/api/documents/${doc.id}/grants`, {
      email: DEMO_ACCOUNTS.outsider,
      permission: "read",
    });
    expect(create.status).toBe(403);

    const grants = await listGrants(owner, doc.id);
    expect(grants.some((g) => g.grantee_email === DEMO_ACCOUNTS.outsider)).toBe(false);
  });

  it("grant holders cannot change or revoke grants", async () => {
    const grants = await listGrants(owner, doc.id);
    const viewerGrant = grants.find((g) => g.grantee_email === DEMO_ACCOUNTS.viewer);
    expect(viewerGrant).toBeDefined();

    const patch = await editor.patch(`/api/documents/${doc.id}/grants`, {
      grantId: viewerGrant?.id,
      permission: "edit",
    });
    const revoke = await editor.del(
      `/api/documents/${doc.id}/grants?grantId=${viewerGrant?.id}`
    );

    expect(patch.status).toBe(403);
    expect(revoke.status).toBe(403);
  });

  // ── search: no existence leak through the query surface ──────────────────

  it("search cannot find the document for a stranger", async () => {
    const res = await outsider.get(`/api/documents?q=${encodeURIComponent(doc.title)}`);
    expect(res.status).toBe(200);
    const body = res.json<{ documents: { id: string }[]; total: number }>();
    expect(body.documents.some((d) => d.id === doc.id)).toBe(false);
    expect(body.total).toBe(0); // counts are counts of what YOU can see
  });

  it("search DOES find the document for someone allowed to see it (positive control)", async () => {
    // Guards the quoting that keeps hostile input literal: if it ever made
    // ordinary search stop matching, this is the test that turns red.
    const res = await owner.get(`/api/documents?q=${encodeURIComponent(doc.title)}`);
    expect(res.status).toBe(200);
    const body = res.json<{ documents: { id: string }[] }>();
    expect(body.documents.some((d) => d.id === doc.id)).toBe(true);
  });

  it("SQL-ish and wildcard search input is treated as literal text", async () => {
    for (const q of ["' OR '1'='1", "%", "_%", "1; drop table documents;--"]) {
      const res = await outsider.get(`/api/documents?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200); // no 500, no injection: pattern-escaped, RLS-scoped
      const body = res.json<{ documents: { id: string }[] }>();
      expect(body.documents.some((d) => d.id === doc.id)).toBe(false);
    }
  });

  // ── audit scoping ────────────────────────────────────────────────────────

  it("the stranger's trail shows only their own attempts — never other people's activity", async () => {
    const res = await outsider.get(`/api/audit?documentId=${doc.id}`);
    expect(res.status).toBe(200);
    const events = res.json<{ events: { actor_email: string | null; event_type: string }[] }>()
      .events;

    // Seeing your OWN refused attempts is by design (evidence about yourself).
    // What must never appear: anything the OWNER did on this document.
    for (const event of events) {
      expect(event.actor_email).toBe(DEMO_ACCOUNTS.outsider);
      expect(event.event_type).not.toMatch(/^document\.(create|upload|delete|restore)$/);
    }
  });

  it("the owner's trail shows the document's activity (positive control)", async () => {
    const res = await owner.get(`/api/audit?documentId=${doc.id}`);
    expect(res.status).toBe(200);
    const types = res
      .json<{ events: { event_type: string }[] }>()
      .events.map((e) => e.event_type);
    expect(types).toContain("document.create");
    expect(types).toContain("document.upload");
  });

  // ── authentication layer ─────────────────────────────────────────────────

  it("unauthenticated callers get 401 on every document route", async () => {
    const anon = anonymous(process.env.TEST_BASE_URL ?? "");
    const list = await anon.get("/api/documents");
    const detail = await anon.get(`/api/documents/${doc.id}`);
    const dl = await download(anon, doc.id);
    const grants = await anon.get(`/api/documents/${doc.id}/grants`);

    for (const res of [list, detail, dl, grants]) {
      expect(res.status).toBe(401);
    }
  });
});
