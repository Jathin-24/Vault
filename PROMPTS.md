# PROMPTS.md — how AI was used to build TrustVault

Working method: I keep the challenge brief, design decisions and a live TODO list in
a separate context folder (outside the repo, per the workflow rules): `BRIEF.md`,
`DECISIONS.md`, `TODO.md`. Before asking the AI for any module I paste the relevant
decision from `DECISIONS.md` so it builds against the agreed design instead of
inventing one. After each module I run a fixed review pass (the checklist is at the
bottom of this file — I use the same one every time).

Honesty rule for this file: every entry below describes something that actually
happened during this build, including the times the AI was confidently wrong.
Entries are dated. Fixes link to the commit that contains the fix.

---

## Entry 1 — 2026-10-21 — Schema first: "design the database before any app code"

**What I asked (prompt summary):**
> "Scaffold a Next.js 15 + TypeScript + Tailwind project in `trustvault/` (separate
> from the context folder). Then design the complete Postgres schema for TrustVault
> BEFORE writing app code: profiles with platform roles, folders, documents, versions,
> per-document email grants with revocation, and an append-only audit table with a
> SHA-256 hash chain. RLS policy for every table, SECURITY DEFINER RPCs for actions,
> no database extensions, and a comment in the SQL explaining every security decision."

**What it produced:** the scaffold (package.json, tsconfig, next.config with CSP
headers, .env.example) and `supabase/migrations/0001–0010` — profiles + triggers,
folders, documents/versions, grants, support tables, the audit chain, the authorisation
function, action RPCs and storage deny policies. Plus `scripts/apply-migrations.mjs`
and `scripts/verify-audit-chain.mjs`.

**What was wrong with it (specifically):**
1. `0002_profiles.sql` contained literal drafting junk in the file it first wrote —
   a line `email text primary key? no -- replaced below`, a `drop table` for a table
   it had just failed to create properly, and `drop force row level security if exists`
   which is not valid SQL. Running it would fail at the first migration.
2. `document_grants` had `check (grantee_email is distinct from lower(auth.jwt()->>'email'))`.
   CHECK constraints may only contain IMMUTABLE expressions; `auth.jwt()` is STABLE —
   migration error at table creation.
3. `tv_suggest_viewers` shipped with a dead CTE (`join public.documents d2 on false
   where false`) — a leftover of its own drafting that would have run but wasted a
   scan and destroyed trust in the query.

**What I did instead:** rewrote `0002_profiles.sql` cleanly; deleted the CHECK and
moved the "no self-grant" rule into the grant-creation route with a SQL comment
explaining that CHECK cannot call `auth.jwt()` (the rule is harmless if bypassed —
the owner already has access); dropped the dead CTE and replaced the ranking query
with an explainable two-part heuristic.
→ **all three fixed before the schema landed: commit `99b1180`.**

---

## Entry 2 — 2026-10-21 — AUDIT: who is the actor when there is no JWT? (audit trail)

**What I asked (prompt summary):**
> "Route handlers need to write audit events for signup/login/logout. Those happen
> before (or without) a user JWT — the handler uses the service-role key. Design
> `tv_log_event` and the call sites."

**What it produced:** `tv_log_event(...)` deriving the actor purely from
`auth.uid()`, with `revoke execute … from anon, authenticated`, called from routes
via the service-role client.

**What was wrong with it (specifically):** for service-role calls `auth.uid()` is
NULL, so **every login success, login failure, signup and logout would have been
recorded as `actor = 'system'`** — the trail could not prove who was at the keyboard
at exactly the moment authentication happens, which is when an auditor cares most.
The obvious "fix" it did not flag is worse: letting authenticated callers pass an
actor id would let any signed-in user forge `"alice downloaded bob's document"`
events. Both easy directions were wrong in opposite ways.

**What I did instead:** added an explicit `p_actor_user_id` parameter that is only
granted to `service_role` (routes pass the uid they verified from the session in the
same request), while `auth.uid()` still wins when present so user-context calls can
never be spoofed.
→ **commit `42fb237` ("fix(db): tv_log_event takes a server-verified actor id for
pre-auth events").**

---

## Entry 3 — 2026-10-21 — AUTHORISATION: "just use signed storage URLs" (access control)

**What I asked (prompt summary):**
> "Implement GET download for a stored file. The client already has a Supabase
> storage client; the quick path is minting a signed URL with a 10-minute expiry and
> returning it."

**What it produced:** the signed-URL approach (mint URL → browser fetches
`/storage/v1/object/sign/...` directly).

**What was wrong with it (specifically):** a signed URL is a bearer token. After the
owner revokes access, an already-issued URL **keeps working until it expires** —
that directly violates non-negotiable #3 ("whatever you have issued to that person
before that moment stops working"). URLs also leak (browser history, proxy logs,
Referer headers) and grant bytes to anyone holding them, with no session and no
per-request decision. The audit would record "URL minted", not "document read".

**What I did instead:** the product has no signed-URL feature at all. Bytes flow
through `GET /api/documents/:id/download`, which per request: verifies the session →
calls `tv_authorize_document_access()` (re-reads `document_grants` *now*, writes the
allow **or deny** audit event before anything else) → only then fetches bytes with
the service role and streams them with `attachment` + `nosniff` + `sandbox` headers.
If the authorisation RPC throws, the route fails closed. Revocation therefore takes
effect on the very next byte request, from any device or old session.
→ **commit `87ac6cd` (download route), design recorded in `DECISIONS.md`.**
Test: `tests/authorization/revocation.test.ts` (written later) proves it.

---

## Entry 4 — 2026-10-21 — AUDIT: AI suggestions whose decisions referenced nothing (audit trail)

**What I asked (prompt summary):**
> "Add the AI-assist surface: GET /suggestions returns suggested viewers from
> `tv_suggest_viewers`, POST /suggestions records the owner's decision."

**What it produced:** GET returned the RPC rows (`suggested_email, reason, score`);
POST expected a `suggestionId` and called `tv_decide_suggestion(suggestionId, …)`.

**What was wrong with it (specifically):** `tv_suggest_viewers` computes suggestions
on the fly — **no row in `access_suggestions` ever existed**, so the POST's
`suggestionId` could never be valid, and the "decision" half of "the suggestion and
the decision both go into the audit" had nothing to point at. A silent version of
this would have produced a UI where every "Grant view" click failed — or worse, a
route that logged a decision event for a suggestion row nobody could verify later.

**What I did instead:** GET now persists each pending suggestion into
`access_suggestions` (owner-only RLS insert, preserving prior accept/decline state)
and returns real row ids; POST stays id-based and audits
`suggestion.accepted/declined` + `grant.create`. The ShareDialog was changed to pass
ids instead of a fabricated map.
→ **commit `4160745` (suggestions GET persistence + ShareDialog).**

---

## Entry 5 — 2026-10-21 — Security advisories in the dependency tree (engineering)

**What I asked (prompt summary):** "npm audit reports 2 moderate, 1 high, 2 critical
(postcss inside next, tinypool inside vitest). Fix them."

**What it produced:** `npm audit fix --force` proposing `next@16.4.2` and
`vitest@5.0.5` as breaking upgrades.

**What was wrong with it:** doing it blindly on the evening of the deadline is how
you ship an untested framework bump; also the first build after the bump warned that
the `middleware` file convention is deprecated in Next 16 (`proxy` instead).

**What I did instead:** upgraded on day 1 while the surface was small
(`next@16.4.2`, `vitest@5`, tailwind 4 current), re-ran typecheck + full build,
ran the official `@next/codemod middleware-to-proxy` migration, and committed each
step separately so a regression would be attributable.
→ **commits `ff8faf4` (upgrade, `npm audit` = 0 vulnerabilities), proxy migration
landed in `4160745`.**

---

## Reused prompts, instructions and context files (the part that shows the method)

1. **`project-context/BRIEF.md`** (outside repo) — the challenge text, verbatim
   requirements + marksheet. Pasted in full with the first prompt; referenced in
   every later "build X" prompt so nothing drifts from the brief.
2. **`project-context/DECISIONS.md`** (outside repo) — my design decisions
   (permission model, revocation semantics, storage rules, what is deliberately NOT
   built). Every AI prompt about a feature starts with the relevant decision from
   this file. This is the single biggest quality lever: the AI stops guessing.
3. **`project-context/TODO.md`** (outside repo) — live plan; I tick items as they
   land and add the next batch. Keeps AI work in reviewable increments, and feeds
   commit messages.
4. **The review checklist prompt** (reused after every module, same wording):
   > "Review this module as a hostile judge: (1) is any authorisation decision made
   > client-side or in UI-only code? (2) does any query bypass RLS by using the
   > service role without an authorisation RPC first? (3) can any error message or
   > status code leak existence of a resource the caller cannot see? (4) can any
   > caller-supplied string reach SQL/headers/storage keys unsanitised? (5) does
   > every state change produce an audit event, and can any path write audit rows
   > without going through `tv_log_event`? List concrete line-level findings."
   This prompt is what caught Entry 2 (actor identity) and the upload-unwind gaps.
5. **The attack list in `TODO.md` ("Judge attack list to prepare for")** — written
   as predictions before the tests existed, then used verbatim as the test plan for
   `tests/authorization/*`. Predicting first, then testing, is deliberate: it makes
   it obvious which tests are real attempts versus restatements of the code.

---

## Note on commit history

Fixes are committed separately from the code they fix, with messages that say what
changed. Where a flaw was caught *before* the first commit (Entry 1), the commit
link points at the state that contains the fix and this file says so plainly rather
than pretending the broken version was ever committed.
