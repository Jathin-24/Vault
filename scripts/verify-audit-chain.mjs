// Independent audit-chain verifier.
// Usage: npm run audit:verify
//
// Deliberately re-implements the canonical serialisation and SHA-256 chain in
// Node instead of trusting tv_verify_audit_chain() in the database: if someone
// tampered with that function, it would happily "verify" their edits. Two
// implementations must agree; this one reads raw rows over PostgREST with the
// service key and recomputes every link itself.
import { createHash } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Mirror of tv_event_canonical() in 0007_audit.sql.
function canonical(row) {
  const epochMs = Math.floor(new Date(row.created_at).getTime());
  return [
    String(row.id),
    String(epochMs),
    row.actor_user_id ?? "",
    row.actor_email ?? "",
    row.actor_role,
    row.event_type,
    row.document_id ?? "",
    row.target_email ?? "",
    row.route ?? "",
    row.outcome,
    row.ip ?? "",
    row.user_agent ?? "",
    row.metadata_sha256,
  ].join("|");
}

async function fetchAll() {
  const all = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const res = await fetch(
      `${url}/rest/v1/audit_events?select=*&order=id.asc&limit=${limit}&offset=${offset}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) throw new Error(`PostgREST ${res.status}: ${await res.text()}`);
    const page = await res.json();
    all.push(...page);
    if (page.length < limit) break;
  }
  return all;
}

const rows = await fetchAll();
let prev = "";
let ok = true;
for (const row of rows) {
  // NOTE: the chain covers the STORED metadata_sha256 column. Consistency of
  // metadata-text vs that digest is checked inside the DB by
  // tv_verify_audit_chain() (admin console), where jsonb::text is exact.
  const expected = sha256(prev + canonical(row));
  if (row.prev_hash !== prev || row.event_hash !== expected) {
    console.error(`CHAIN BROKEN at event id=${row.id} (${row.event_type} @ ${row.created_at})`);
    console.error(`  stored prev_hash: ${row.prev_hash}`);
    console.error(`  expected prev_hash: ${prev}`);
    console.error(`  stored event_hash: ${row.event_hash}`);
    console.error(`  expected event_hash: ${expected}`);
    ok = false;
    break;
  }
  prev = row.event_hash;
}

if (ok) {
  console.log(`Audit chain verified: ${rows.length} events intact.`);
  console.log(`Head: ${prev || "(empty)"}`);
} else {
  process.exitCode = 1;
}
