/**
 * REVOCATION — "effective immediately on anything previously issued."
 *
 * The point of this suite: there is no token, cookie or URL that outlives a
 * grant. Vera downloads the file successfully, the owner revokes — and with
 * the SAME browser session (no re-login, no new cookie), the very next
 * request is refused. Every access decision reads document_grants at request
 * time; nothing is cached, nothing was issued in advance.
 *
 * The second half proves refusals are EVIDENCE: the post-revocation refusal
 * appears in the audit trail as access_denied, attributed to the right person
 * on the right document.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HTTP_ENABLED } from "../helpers/env";
import { asAccount, DEMO_ACCOUNTS } from "../helpers/accounts";
import type { TestClient } from "../helpers/http";
import {
  createDocument,
  deleteDocument,
  download,
  listGrants,
  revokeGrant,
  share,
  uniqueName,
  uploadOk,
  uploadVersion,
  type CreatedDocument,
} from "../helpers/fixtures";

describe.skipIf(!HTTP_ENABLED)("revocation is immediate", () => {
  let owner: TestClient;
  let viewer: TestClient;
  let editor: TestClient;
  let admin: TestClient;
  let doc: CreatedDocument;
  let grantId: string;

  beforeAll(async () => {
    owner = await asAccount("owner");
    viewer = await asAccount("viewer");
    editor = await asAccount("editor");
    admin = await asAccount("admin");

    doc = await createDocument(owner, uniqueName("Revocation"));
    await uploadOk(owner, doc.id, "revocation.txt", Buffer.from("grant me access"));
    const grant = await share(owner, doc.id, DEMO_ACCOUNTS.viewer, "read");
    grantId = grant.id;
  }, 60_000);

  afterAll(async () => {
    if (doc && owner) await deleteDocument(owner, doc.id);
  });

  it("the grant works while it is active (control)", async () => {
    const meta = await viewer.get(`/api/documents/${doc.id}`);
    expect(meta.status).toBe(200);

    const dl = await download(viewer, doc.id);
    expect(dl.status).toBe(200);
    expect(new TextDecoder().decode(dl.bytes)).toContain("grant me access");
  });

  it("revocation takes effect on the VERY NEXT request, same session", async () => {
    const revoke = await revokeGrant(owner, doc.id, grantId);
    expect(revoke.status).toBe(200);

    // No re-login: these use the exact same cookie jar as the control above.
    const meta = await viewer.get(`/api/documents/${doc.id}`);
    const dl = await download(viewer, doc.id);
    const list = await viewer.get("/api/documents");

    expect(meta.status).toBe(404);
    expect(dl.status).toBe(404);
    expect(dl.headers.get("content-disposition")).toBeNull(); // no file, just the 404 JSON
    expect(new TextDecoder().decode(dl.bytes)).not.toContain("grant me access");
    expect(
      list.json<{ documents: { id: string }[] }>().documents.some((d) => d.id === doc.id)
    ).toBe(false);
  });

  it("the refusal is recorded as evidence (access_denied, right actor, right doc)", async () => {
    const res = await admin.get(
      `/api/admin/audit?eventType=access_denied&documentId=${doc.id}`
    );
    expect(res.status).toBe(200);
    const events = res.json<{
      events: { actor_email: string; event_type: string; route: string | null }[];
    }>().events;

    // The document was fresh for this run, so any access_denied for it IS the
    // post-revocation refusal above.
    expect(
      events.some(
        (e) =>
          e.actor_email === DEMO_ACCOUNTS.viewer &&
          e.route === "/api/documents/:id/download"
      )
    ).toBe(true);
  });

  it("re-sharing restores access for the same session (revocation is per-grant)", async () => {
    await share(owner, doc.id, DEMO_ACCOUNTS.viewer, "read");
    const meta = await viewer.get(`/api/documents/${doc.id}`);
    expect(meta.status).toBe(200);
  });

  it("a revoked grantee cannot resurrect their own access", async () => {
    const grants = await listGrants(owner, doc.id);
    const active = grants.find(
      (g) => g.grantee_email === DEMO_ACCOUNTS.viewer && g.revoked_at === null
    );
    expect(active).toBeDefined();

    const patch = await viewer.patch(`/api/documents/${doc.id}/grants`, {
      grantId: active?.id,
      permission: "edit",
    });
    const revoke = await viewer.del(`/api/documents/${doc.id}/grants?grantId=${active?.id}`);
    const create = await viewer.post(`/api/documents/${doc.id}/grants`, {
      email: DEMO_ACCOUNTS.outsider,
      permission: "read",
    });

    expect(patch.status).toBe(403); // owner-only management
    expect(revoke.status).toBe(403);
    expect(create.status).toBe(403);
  });

  it("downgrading edit→read strips the write immediately, keeps the read", async () => {
    const doc2 = await createDocument(owner, uniqueName("Downgrade"));
    try {
      await uploadOk(owner, doc2.id, "v1.txt", Buffer.from("v1"));
      const grant = await share(owner, doc2.id, DEMO_ACCOUNTS.editor, "edit");

      const uploadAsEditor = await uploadOk(editor, doc2.id, "v2.txt", Buffer.from("v2"));
      expect(uploadAsEditor.version_no).toBe(2);

      const downgrade = await owner.patch(`/api/documents/${doc2.id}/grants`, {
        grantId: grant.id,
        permission: "read",
      });
      expect(downgrade.status).toBe(200);

      // Same session, immediately:
      const refused = await uploadVersion(editor, doc2.id, "v3.txt", Buffer.from("v3"), "text/plain");
      const stillReads = await download(editor, doc2.id);

      expect(refused.status).toBe(403); // edit is gone
      expect(stillReads.status).toBe(200); // read remains
    } finally {
      await deleteDocument(owner, doc2.id);
    }
  }, 60_000);
});
