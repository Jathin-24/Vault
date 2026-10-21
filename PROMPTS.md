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

## Entry 6 — 2026-10-21 — THREATS.md and API.md (threat thinking + API docs)

**What I asked (prompt summary):** "Read the actual route files and write two docs:
THREATS.md — every attack on the sharing model a judge could raise, with what stops
it and what we cannot stop; API.md — every endpoint with an explicit permission
table (who may call it, what a stranger gets back)."

**What it produced:** THREATS.md with 13 threats (T1–T13), each with attack /
mitigation / status, plus an accepted-risk list and a "what we deliberately did NOT
do" section; API.md with per-route permission tables for auth, documents, grants,
folders, audit and admin.

**What was wrong with it:** the first API.md draft was written from the plan rather
than the code. Checking it against the route files found six factual errors: search
documented as `POST /api/documents/search` (actually `GET /api/documents?q=`), a
separate own-activity endpoint (actually `GET /api/audit`), `grantId` as a URL param
on grant update/delete (actually in body/query), an `admin` flag returned by
`/api/me` (admins are identified by `role` on the session user object instead), plus
the wrong session-cookie name family and a wrong claim that signup issues a session.

**What I did instead:** rewrote every table from the source of each `route.ts`, and
added an explicit cross-cutting rule the code really enforces — anything the caller
may not see returns **404, never 403**, so existence is not leaked. In THREATS.md the
unresolved items (superuser drops the audit trigger, in-flight download after a
mid-flight revoke, service-role key theft) are listed as detection mechanisms or
accepted risks instead of being dressed up as solved.

→ **commit `f18cf95`** (plus a follow-up correction of the folder-name length row
80→120 chars, which came from re-reading `folders/route.ts`).

---

## Entry 7 — 2026-10-21 — First REAL execution: migrations, seed, chain verify (schema + audit)

**What I asked (prompt summary):** "Stop reviewing the SQL — execute it. Run
`npm run db:migrate` against the actual Supabase project, then `npm run db:seed`,
then `npm run audit:verify`, and fix whatever breaks."

**What it produced:** the schema, seeder and chain verifier all running against the
live database — after four rounds of real errors that no amount of reading the SQL
had shown:

1. **Role-name syntax.** `revoke ... from public.anon` is invalid: `anon` /
   `authenticated` / `service_role` are already top-level roles (`public` is kept
   only as the *ALL PRIVILEGES* keyword). Same class of error in `0007`/`0009`,
   plus `overriding system value` placed after `values` instead of before it.
2. **Empty-chain bootstrap (`0011`).** `select ... into v_prev` on an empty
   `audit_events` assigns **NULL** over the declared default — so the very first
   audited event ever written failed `prev_hash NOT NULL`. The bug only exists on
   a fresh database; every later event masks it.
3. **`INSERT ... RETURNING` vs RLS (`0012`).** Creating a document through the API
   (PostgREST does `.insert().select()`) failed with "new row violates row-level
   security", while a plain insert worked: the SELECT policy is evaluated against
   the statement snapshot, which **cannot see the row being inserted**, and the old
   policy asked "is owner?" by subquerying `documents` itself. Fixed with a direct
   `owner_id = auth.uid()` row reference (always visible) plus
   `tv_document_read_grant()` for grant/admin reads (touches no `documents` rows).
4. **A grant model that could never open (`0013`).** Grantees got 404 on every
   document despite active grants: all access paths matched
   `auth.jwt()->>'email_verified'`, but modern Supabase tokens carry **no**
   top-level `email_verified` claim — it lives in `user_metadata`, which the *user
   can edit*, so trusting it would let anyone grant themselves access. Verification
   now comes from `auth.users.email_confirmed_at`, synced into
   `profiles.email_verified` by a trigger on `auth.users`, and every access path
   matches on profiles (ours, not user-editable) instead of JWT claims.

**What was wrong with my initial diagnosis:** I first read problems 2–4 as app-layer
bugs. Executing them in order showed they were all *database-semantics* bugs that
only appear against a live engine — snapshot visibility, `select into` on zero rows,
JWT claim drift.

**What I did instead:** fixed each at the source (`0007`/`0008` edited so fresh
clones get the corrected bodies directly) **and** added `0011`–`0013` as idempotent
follow-ups so the already-recorded live database converges to the identical final
state. Two of the four fixes are authorisation/audit-critical, which is exactly why
they get their own migrations with the failure mode written into the header comment.

→ **commit `4f46484`.** After it: migrate/seed/audit-verify all green on the live
project (`audit:verify` prints the chain head hash).

---

## Entry 8 — 2026-10-21 — The integration suite that had to fail if an auth check is removed (tests)

**What I asked (prompt summary):** "Write the automated cross-user isolation tests:
against the real running app, five accounts, every negative assertion paired with a
positive control, and they must go red if any authorisation check is deleted. Then
run the whole suite and fix what it catches."

**What it produced:** `tests/helpers/` (cookie-jar HTTP client, session-cached
logins — login is rate-limited, so re-authenticating per run would throttle us —
fixtures) and six authorization files plus the unit suite: isolation, revocation,
audit integrity (including a direct-SQL tamper attempt inside a rolled-back
transaction, impersonating an admin via `request.jwt.claims` GUCs), admin
read-only, sessions, upload validation. **100 tests, all green.**

**What it caught (each a real defect, not a test bug):**
1. **A security header that never shipped.** The download route set
   `X-TTrustVault-Access` with an extra *T*, so the break-glass marker documented
   in API.md read back as `null` — the audit event was written, the client-visible
   signal was not. → `703db15`.
2. **RLS refusing by exception, not by zero rows.** `PATCH /api/documents/:id`
   threw 500 when row security rejected the statement outright (`42501`) instead of
   updating nothing. Both shapes now feed the same visibility logic (403 known /
   404 invisible). → `703db15`.
3. **A search term that tripped a CDN firewall.** `q=1; drop table documents;--`
   returned 500 — not because of SQL (parameter binding), and not even because of
   PostgREST's `.or()` grammar as I first diagnosed by probing: the term made
   *Supabase's Cloudflare WAF* reject our own backend's request, and supabase-js
   surfaced the HTML block page as an "error body". → `81922e7`.

**What I did instead:** `.or()` values are now double-quoted with proper `\\` / `\"`
escapes (`quoteOrValue`, verified against PostgREST's documented grammar), and only
errors provably caused by the *term* (filter parse error, WAF HTML) degrade to
`200 + empty page` — a search we cannot ask Postgres about reveals nothing — while
auth/schema/network failures still throw. A positive control (the owner's own search
must still find their document) keeps the quoting honest.

**Process note:** the suite was written first and run locally before any of this was
committed, so the fixes (`703db15`, `81922e7`) land in history *before* the suite
itself (`13da8be`); running the suite at `c84f4d4`/`13da8be` onward is green.

→ **commits `c84f4d4` (unit), `703db15`, `81922e7`, `13da8be` (suite).**

---

## Entry 9 — 2026-10-21 — Config drift: the anon key grew a second name (engineering)

**What I asked (prompt summary):** "The project's `.env.local` uses
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the name newer Supabase dashboards show)
and the app still throws 'environment variables missing'. Make the env handling
single-sourced and tolerant of both names."

**What it produced:** `src/lib/supabase/env.ts` — one resolver for URL / browser key
/ service key with an error that says exactly which variable is missing — replacing
four hand-rolled `process.env` reads in `server.ts`, `client.ts`, `admin.ts` and
`proxy.ts`. The proxy keeps a *tolerant* read on purpose: it runs on every request,
so a missing key must degrade to "session not refreshed", never a 500.

**Why it is an entry at all:** two build machines differing on one variable name is
the kind of failure that wastes an evening and looks like an auth bug. Centralising
it turned a class of failures into one readable message.

→ **commit `590628f`.**

---

## Entry 10 — 2026-10-21 — Deploy day: a CRLF in every secret, and a test that assumed it was the only referee (deployment + tests)

**What I asked (prompt summary):** "I have the Vercel CLI — deploy the app and run
the whole test suite against the live URL."

**What it produced, and what was wrong with it:** two failures a green local suite
could not predict, plus one landmine caught before it fired.
1. Every env var was silently corrupted on upload: piping `value | vercel env add`
   from PowerShell appends a newline, so all six secrets were stored with a
   trailing CRLF. The CLI's own "Value contains newlines" warnings were the hint;
   `vercel env pull` proved it (each value ended in an escaped `\r\n`). Fixed by
   deleting the vars and re-adding each through exact-byte file redirection
   (`cmd /c "vercel env add NAME production < file"`), then re-pulling and
   verifying every value byte-clean before the first deploy. Left unfixed this
   would have 401'd or 500'd every request on the live site while looking like an
   auth bug.
2. The live suite ran 99/100 — "an oversized upload is refused before anything is
   stored" timed out twice. `scripts/probe-oversized-upload.mjs` (written to
   answer exactly this) plus a curl ground-truth run showed the real referee:
   Vercel's edge refuses bodies over ~4.5 MB, but only AFTER the body streams up
   (~18 s for 6 MB on this uplink, ~80 s for 27 MB), so the test was dying
   mid-upload, not meeting a refusal. The test now threads an `AbortSignal`
   through the client and counts a 20 s deadline as a transport-level refusal,
   keeping the assertion that actually matters — no version is ever created.
   Verified on both referee paths: 10/10 locally (our own 413 answers instantly)
   and 10/10 live (the transport path). Full suite against the deployed URL
   afterwards: **100/100**.
3. `NEXT_PUBLIC_APP_URL` still said `localhost:3000` after the first deploy —
   which would have made the deployed Origin check (CSRF layer 3, THREATS T15)
   reject every legitimate browser mutation. Caught by reading what the variable
   actually drives before judges could; now it is the deployment URL, and the
   live login cookie reads `Secure; HttpOnly; SameSite=lax`.

**Why it is an entry at all:** deployment is where invisible characters and
platform-level referees hide. A piped newline is silent until every request
starts failing, and "the suite passed locally" certifies the local stack — not
the one the judges will attack.

→ **commit `3697880`** (adaptive test + probe script).

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
