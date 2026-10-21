/**
 * Shared fixtures. Every test file creates its OWN documents (fresh, unique
 * titles) instead of relying on seeded rows — so tests are re-runnable and
 * never depend on each other's leftovers.
 */
import { createHash, randomUUID } from "node:crypto";
import type { TestClient, TestResponse } from "./http";

export function uniqueName(prefix: string): string {
  return `${prefix} ${new Date().toISOString().slice(11, 19)}-${randomUUID().slice(0, 8)}`;
}

export interface CreatedDocument {
  id: string;
  title: string;
}

export async function createDocument(
  client: TestClient,
  title: string
): Promise<CreatedDocument> {
  const res = await client.post("/api/documents", { title, category: "general" });
  if (res.status !== 201) {
    throw new Error(`createDocument failed: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  return { id: res.json<{ document: { id: string } }>().document.id, title };
}

/** A valid text file (passes sniffing: UTF-8, no NULs). */
export function textFile(marker: string): Uint8Array {
  return new TextEncoder().encode(
    `TrustVault integration test payload\nmarker: ${marker}\n`
  );
}

export interface UploadedVersion {
  id: string;
  version_no: number;
  original_filename: string;
  size_bytes: number;
}

export async function uploadVersion(
  client: TestClient,
  docId: string,
  filename: string,
  content: Uint8Array,
  mime: string
): Promise<TestResponse> {
  return client.upload(docId, filename, content, mime);
}

export async function uploadOk(
  client: TestClient,
  docId: string,
  filename: string,
  content: Uint8Array,
  mime = "text/plain"
): Promise<UploadedVersion> {
  const res = await uploadVersion(client, docId, filename, content, mime);
  if (res.status !== 201) {
    throw new Error(`uploadOk failed: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  return res.json<{ version: UploadedVersion }>().version;
}

export interface GrantRow {
  id: string;
  grantee_email: string;
  permission: "read" | "edit";
  revoked_at: string | null;
}

export async function share(
  owner: TestClient,
  docId: string,
  email: string,
  permission: "read" | "edit"
): Promise<GrantRow> {
  const res = await owner.post(`/api/documents/${docId}/grants`, { email, permission });
  if (res.status !== 201) {
    throw new Error(`share failed: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  return res.json<{ grant: GrantRow }>().grant;
}

export async function listGrants(owner: TestClient, docId: string): Promise<GrantRow[]> {
  const res = await owner.get(`/api/documents/${docId}/grants`);
  if (res.status !== 200) {
    throw new Error(`listGrants failed: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  return res.json<{ grants: GrantRow[] }>().grants;
}

export async function revokeGrant(
  owner: TestClient,
  docId: string,
  grantId: string
): Promise<TestResponse> {
  return owner.del(`/api/documents/${docId}/grants?grantId=${grantId}`);
}

export function download(
  client: TestClient,
  docId: string,
  options: { version?: number } = {}
): Promise<TestResponse> {
  const query = options.version === undefined ? "" : `?version=${options.version}`;
  return client.get(`/api/documents/${docId}/download${query}`);
}

export function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Best-effort cleanup: soft-delete the document (restorable, audited). */
export async function deleteDocument(client: TestClient, docId: string): Promise<void> {
  await client.del(`/api/documents/${docId}`);
}
