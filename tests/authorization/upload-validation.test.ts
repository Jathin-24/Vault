/**
 * UPLOAD VALIDATION — "the client is a liar until proven otherwise."
 *
 * Extension, declared MIME type and filename are all attacker-controlled, so
 * the CONTENT decides what a file is. These tests send hostile uploads
 * through the real endpoint and assert the server refuses them — plus a
 * byte-exact round-trip for the honest case (upload → download → sha256
 * matches the content_hash the server recorded).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HTTP_ENABLED } from "../helpers/env";
import { asAccount } from "../helpers/accounts";
import type { TestClient } from "../helpers/http";
import {
  createDocument,
  deleteDocument,
  download,
  sha256Hex,
  uniqueName,
  uploadOk,
  uploadVersion,
  type CreatedDocument,
} from "../helpers/fixtures";
import { anonymous } from "../helpers/http";

const PDF_MAGIC = new TextEncoder().encode("%PDF-1.7\nminimal pdf body\n");
const PNG_MAGIC = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
]);

describe.skipIf(!HTTP_ENABLED)("upload validation", () => {
  let owner: TestClient;
  let doc: CreatedDocument;

  beforeAll(async () => {
    owner = await asAccount("owner");
    doc = await createDocument(owner, uniqueName("Uploads"));
  }, 60_000);

  afterAll(async () => {
    if (doc && owner) await deleteDocument(owner, doc.id);
  });

  it("a valid text file uploads and round-trips byte-for-byte", async () => {
    const content = new TextEncoder().encode("honest payload for round-trip\n");
    const version = await uploadOk(owner, doc.id, "honest.txt", content);
    expect(version.version_no).toBe(1);
    expect(version.size_bytes).toBe(content.byteLength);

    const dl = await download(owner, doc.id, { version: 1 });
    expect(dl.status).toBe(200);
    expect(sha256Hex(dl.bytes)).toBe(sha256Hex(content));
    expect(dl.headers.get("content-type")).toBe("text/plain");
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dl.headers.get("content-disposition")).toContain("attachment");

    // The server-recorded hash agrees (integrity metadata is real).
    const detail = await owner.get(`/api/documents/${doc.id}`);
    const versions = detail.json<{
      document: { versions: { version_no: number; content_hash: string }[] };
    }>().document.versions;
    const recorded = versions.find((v) => v.version_no === 1);
    expect(recorded?.content_hash).toBe(sha256Hex(content));
  });

  it("executable extension is rejected", async () => {
    const res = await uploadVersion(
      owner, doc.id, "payload.exe", new TextEncoder().encode("MZ\x90\x00"), "application/octet-stream"
    );
    expect(res.status).toBe(400);
    expect(res.json<{ details: string[] }>().details.join(" ")).toMatch(/not allowed/i);
  });

  it("HTML is rejected when declared as HTML — even with a .txt name", async () => {
    const res = await uploadVersion(
      owner,
      doc.id,
      "page.txt",
      new TextEncoder().encode("<html><script>alert(1)</script></html>"),
      "text/html"
    );
    expect(res.status).toBe(400);
    expect(res.json<{ details: string[] }>().details.join(" ")).toMatch(/content type/i);
  });

  it("PDF bytes wearing a .png name are rejected — content decides the type", async () => {
    const res = await uploadVersion(owner, doc.id, "cover.png", PDF_MAGIC, "image/png");
    expect(res.status).toBe(400);
    expect(res.json<{ details: string[] }>().details.join(" ")).toMatch(/does not match/i);
  });

  it("an empty file is rejected", async () => {
    const res = await uploadVersion(owner, doc.id, "empty.txt", new Uint8Array(0), "text/plain");
    expect(res.status).toBe(400);
    expect(res.json<{ details: string[] }>().details.join(" ")).toMatch(/empty/i);
  });

  it("a fake .docx (zip without [Content_Types].xml) is rejected", async () => {
    const fakeZip = new Uint8Array(64);
    fakeZip.set([0x50, 0x4b, 0x03, 0x04], 0); // zip magic, nothing real inside
    const res = await uploadVersion(owner, doc.id, "report.docx", fakeZip, "application/octet-stream");
    expect(res.status).toBe(400);
    expect(res.json<{ details: string[] }>().details.join(" ")).toMatch(/does not match/i);
  });

  it("a traversal filename is neutralised before storage", async () => {
    const hostileName = "../../../..\\evil.txt";
    const version = await uploadOk(owner, doc.id, hostileName, new TextEncoder().encode("x"));

    expect(version.original_filename).not.toContain("/");
    expect(version.original_filename).not.toContain("\\");
    expect(version.original_filename).not.toContain("..");
    expect(version.original_filename).toMatch(/evil\.txt$/);

    // And it downloads with a safe Content-Disposition (no CR/LF, no paths).
    const dl = await download(owner, doc.id, { version: version.version_no });
    expect(dl.status).toBe(200);
    const cd = dl.headers.get("content-disposition") ?? "";
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).not.toContain("..");
  });

  it("an oversized upload is refused before anything is stored", async () => {
    const before = await owner.get(`/api/documents/${doc.id}`);
    const beforeVersion = before.json<{ document: { current_version: number } }>()
      .document.current_version;

    // 27 MB of text: over the 25 MB cap (MAX_UPLOAD_BYTES).
    const oversized = new Uint8Array(27 * 1024 * 1024).fill(0x41);
    const res = await uploadVersion(owner, doc.id, "huge.txt", oversized, "text/plain");

    expect([400, 413]).toContain(res.status);

    const after = await owner.get(`/api/documents/${doc.id}`);
    expect(after.json<{ document: { current_version: number } }>().document.current_version).toBe(
      beforeVersion
    ); // nothing half-created
  }, 30_000);

  it("unauthenticated upload is refused", async () => {
    const anon = anonymous(process.env.TEST_BASE_URL ?? "");
    const res = await anon.upload(doc.id, "anon.txt", new TextEncoder().encode("x"), "text/plain");
    expect(res.status).toBe(401);
  });

  it("real PNG bytes with a .png name are accepted (positive control)", async () => {
    const version = await uploadOk(owner, doc.id, "photo.png", PNG_MAGIC, "image/png");
    expect(version.version_no).toBeGreaterThan(1);

    const dl = await download(owner, doc.id, { version: version.version_no });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("image/png");
    expect(sha256Hex(dl.bytes)).toBe(sha256Hex(PNG_MAGIC));
  });
});
