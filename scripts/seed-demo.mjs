// Seed demo accounts + sample content for local runs, tests and the demo video.
// Usage:  npm run db:seed     (requires .env.local with SERVICE_ROLE key)
//
// Creates (idempotent — re-running keeps existing rows and resets passwords):
//   admin@trustvault.test      platform admin
//   owner@trustvault.test      owns the sample documents
//   editor@trustvault.test     'edit' grant on the shared document
//   viewer@trustvault.test     'read' grant on the shared document
//   outsider@trustvault.test   NO grant anywhere (the attacker in the tests)
//   leaver@trustvault.test     starts active; a test deactivates them
//
// Password for every demo account: TrustVault!Demo2026  (18 chars, 4 classes)
// These are PUBLIC demo credentials — documented in README, never reuse them.
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)."
  );
  process.exit(1);
}

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "TrustVault!Demo2026";

const USERS = [
  { email: "admin@trustvault.test", name: "Demo Admin", role: "admin" },
  { email: "owner@trustvault.test", name: "Ava Owner", role: "user" },
  { email: "editor@trustvault.test", name: "Eddie Editor", role: "user" },
  { email: "viewer@trustvault.test", name: "Vera Viewer", role: "user" },
  { email: "outsider@trustvault.test", name: "Otto Outsider", role: "user" },
  { email: "leaver@trustvault.test", name: "Lena Leaver", role: "user" },
];

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const log = (msg) => console.log(`  ${msg}`);

// ── accounts ────────────────────────────────────────────────────────────────
async function findUser(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureUsers() {
  const ids = {};
  for (const u of USERS) {
    let user = await findUser(u.email);
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: DEMO_PASSWORD,
        email_confirm: true, // demo accounts skip the inbox; real signups verify
        user_metadata: { full_name: u.name },
      });
      if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
      user = data.user;
      log(`created ${u.email}`);
    } else {
      // Keep demo credentials deterministic even if a previous run changed them.
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        password: DEMO_PASSWORD,
      });
      if (error) throw new Error(`reset password ${u.email}: ${error.message}`);
      log(`exists  ${u.email}`);
    }
    ids[u.email] = user.id;
  }

  const adminId = ids["admin@trustvault.test"];
  const { error: roleError } = await admin
    .from("profiles")
    .update({ platform_role: "admin", is_active: true, full_name: "Demo Admin" })
    .eq("id", adminId);
  if (roleError) throw new Error(`promote admin: ${roleError.message}`);

  const { error: activeError } = await admin
    .from("profiles")
    .update({ is_active: true })
    .in("id", Object.values(ids));
  if (activeError) throw new Error(`activate profiles: ${activeError.message}`);

  return ids;
}

// ── content ─────────────────────────────────────────────────────────────────
async function docIdByTitle(ownerId, title) {
  const { data, error } = await admin
    .from("documents")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("title", title)
    .maybeSingle();
  if (error) throw new Error(`find document: ${error.message}`);
  return data?.id ?? null;
}

async function folderIdByName(ownerId, name) {
  const { data, error } = await admin
    .from("folders")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(`find folder: ${error.message}`);
  if (data) return data.id;

  const { data: created, error: createError } = await admin
    .from("folders")
    .insert({ owner_id: ownerId, name })
    .select("id")
    .single();
  if (createError) throw new Error(`create folder: ${createError.message}`);
  log(`folder  "${name}"`);
  return created.id;
}

/**
 * Insert a document + one version + its object, mirroring exactly what
 * POST /api/documents and POST /api/documents/:id/versions do server-side:
 * server-generated key under the document prefix, sha256 content hash,
 * current_version bumped. Direct-SQL creation still fires the audit trigger.
 */
async function ensureDocument({ ownerId, title, category, folderId, filename, content }) {
  let docId = await docIdByTitle(ownerId, title);
  let created = false;
  if (!docId) {
    const { data, error } = await admin
      .from("documents")
      .insert({
        owner_id: ownerId,
        title,
        category,
        folder_id: folderId ?? null,
        description: `Seeded sample document for the TrustVault demo.`,
      })
      .select("id, current_version")
      .single();
    if (error) throw new Error(`create document "${title}": ${error.message}`);
    docId = data.id;
    created = true;
    log(`doc     "${title}"`);
  }

  const { data: versions } = await admin
    .from("document_versions")
    .select("id, version_no, storage_path")
    .eq("document_id", docId)
    .order("version_no", { ascending: false })
    .limit(1);

  if ((versions ?? []).length === 0) {
    const bytes = Buffer.from(content, "utf8");
    const extension = filename.split(".").pop().toLowerCase();
    const storagePath = `${docId}/v1/${randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(storagePath, bytes, {
        contentType: "text/plain",
        cacheControl: "0",
        upsert: false,
      });
    if (uploadError) throw new Error(`upload "${title}": ${uploadError.message}`);

    const { error: versionError } = await admin.from("document_versions").insert({
      document_id: docId,
      version_no: 1,
      original_filename: filename,
      storage_path: storagePath,
      mime_type: "text/plain",
      extension,
      size_bytes: bytes.length,
      content_hash: createHash("sha256").update(bytes).digest("hex"),
      uploaded_by: ownerId,
    });
    if (versionError) throw new Error(`version row "${title}": ${versionError.message}`);

    const { error: bumpError } = await admin
      .from("documents")
      .update({ current_version: 1 })
      .eq("id", docId);
    if (bumpError) throw new Error(`publish v1 "${title}": ${bumpError.message}`);
    log(`v1      "${title}" (${bytes.length} bytes)`);
  } else if (created) {
    log(`v1      "${title}" already present`);
  }

  return docId;
}

async function ensureGrant({ documentId, granteeEmail, permission, grantedBy }) {
  const { data: existing } = await admin
    .from("document_grants")
    .select("id, permission, revoked_at")
    .eq("document_id", documentId)
    .eq("grantee_email", granteeEmail)
    .is("revoked_at", null)
    .maybeSingle();
  if (existing) {
    if (existing.permission !== permission) {
      const { error } = await admin
        .from("document_grants")
        .update({ permission })
        .eq("id", existing.id);
      if (error) throw new Error(`update grant: ${error.message}`);
      log(`grant   ${granteeEmail} -> ${permission} (updated)`);
    }
    return existing.id;
  }

  const { data, error } = await admin
    .from("document_grants")
    .insert({
      document_id: documentId,
      grantee_email: granteeEmail,
      permission,
      granted_by: grantedBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(`grant ${granteeEmail}: ${error.message}`);
  log(`grant   ${granteeEmail} -> ${permission}`);
  return data.id;
}

// ── denied attempts (evidence the demo needs on first load) ────────────────
async function ensureDenial({ actorId, documentId, route }) {
  const { data } = await admin
    .from("audit_events")
    .select("id")
    .eq("actor_user_id", actorId)
    .eq("document_id", documentId)
    .eq("event_type", "access_denied")
    .eq("route", route)
    .limit(1);
  if ((data ?? []).length > 0) return;

  await admin.rpc("tv_log_event", {
    p_event_type: "access_denied",
    p_document_id: documentId,
    p_route: route,
    p_outcome: "denied",
    p_metadata: { action: "read", reason: "no_grant", source: "seed" },
    p_actor_user_id: actorId,
  });
  log(`denied  outsider -> ${route} (recorded)`);
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log("Seeding TrustVault demo data ...");
try {
  const ids = await ensureUsers();
  const ownerId = ids["owner@trustvault.test"];
  const outsiderId = ids["outsider@trustvault.test"];

  const financeFolder = await folderIdByName(ownerId, "Finance");
  const legalFolder = await folderIdByName(ownerId, "Legal");

  const payrollId = await ensureDocument({
    ownerId,
    title: "Q3 Payroll Summary",
    category: "finance",
    folderId: financeFolder,
    filename: "payroll-q3.txt",
    content:
      "TRUSTVAULT SAMPLE — Q3 PAYROLL (fake data)\n\n" +
      "Engineering   4 people\n" +
      "Operations    2 people\n" +
      "Total         6 people\n\n" +
      "Shared with Eddie (edit) and Vera (read). NOT shared with Otto.\n",
  });

  await ensureDocument({
    ownerId,
    title: "Board Minutes — Confidential",
    category: "legal",
    folderId: legalFolder,
    filename: "board-minutes.txt",
    content:
      "TRUSTVAULT SAMPLE — BOARD MINUTES (fake data)\n\n" +
      "1. Approved the seed round.\n" +
      "2. Asked legal to review the vendor contract.\n" +
      "3. Next meeting: first Tuesday.\n",
  });

  await ensureDocument({
    ownerId,
    title: "Vendor Contract — Acme Corp",
    category: "contract",
    folderId: legalFolder,
    filename: "acme-contract.txt",
    content:
      "TRUSTVAULT SAMPLE — VENDOR CONTRACT (fake data)\n\n" +
      "Acme Corp will provide widgets for 12 months.\n" +
      "Termination: 30 days written notice.\n",
  });

  // Sharing: editor gets edit, viewer gets read — on one document only, so the
  // tests (and the demo) can show edit vs read vs no access side by side.
  await ensureGrant({
    documentId: payrollId,
    granteeEmail: "editor@trustvault.test",
    permission: "edit",
    grantedBy: ownerId,
  });
  await ensureGrant({
    documentId: payrollId,
    granteeEmail: "viewer@trustvault.test",
    permission: "read",
    grantedBy: ownerId,
  });

  // A revoked grant (history kept) so the UI shows revocation, not just absence.
  const { data: revokedExisting } = await admin
    .from("document_grants")
    .select("id")
    .eq("document_id", payrollId)
    .eq("grantee_email", "leaver@trustvault.test")
    .maybeSingle();
  if (!revokedExisting) {
    const { error } = await admin.from("document_grants").insert({
      document_id: payrollId,
      grantee_email: "leaver@trustvault.test",
      permission: "read",
      granted_by: ownerId,
      revoked_at: new Date().toISOString(),
      revoked_by: ownerId,
    });
    if (error) throw new Error(`revoked grant: ${error.message}`);
    log("grant   leaver@trustvault.test -> read (revoked, history kept)");
  }

  // Refused attempts, so the audit view has red rows on first load.
  await ensureDenial({
    actorId: outsiderId,
    documentId: payrollId,
    route: "/api/documents/:id/download",
  });

  console.log("\nDemo accounts (password for all: " + DEMO_PASSWORD + "):");
  for (const u of USERS) console.log(`  ${u.email.padEnd(28)} ${u.role}`);
  console.log("\nSeed complete. Verify the audit chain with: npm run audit:verify");
} catch (err) {
  console.error(`\nSEED FAILED: ${err.message}`);
  process.exit(1);
}
