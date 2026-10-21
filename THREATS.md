# THREATS — TrustVault threat model

Written 2026-10-21 and kept in sync with the code. Each threat lists the attack, the
mitigation as implemented (with file references), and — where relevant — the accepted risk.
Nothing here is aspirational: if a mitigation is claimed, it exists in the migrations or routes.

---

## T1 — Read another user's document (direct object reference)

**Attack.** Guess/enumerate a document UUID and `GET /api/documents/{id}` or
`GET /api/documents/{id}/download` with my own valid session.

**Mitigation.** The decision is made by `tv_authorize_document_access()` inside Postgres
(`supabase/migrations/0008_*`), which checks the document exists, is not purged, the account
is active, and a non-revoked `read`/`edit` grant row exists for my email — or a break-glass
`admin_override` audit row exists. Every document route calls it before returning anything,
and downloads additionally require the *same* call to have succeeded on this request before a
single byte is streamed. RLS is a second layer on top: the anon/authenticated keys cannot even
select rows they are not entitled to.

**Status.** Mitigated. Cross-user isolation is exercised by
`tests/authorization/cross-user-isolation.test.ts`, which fails if the authorisation call or the
RLS policy is removed.

## T2 — Download a file without going through the audit

**Attack.** Obtain a storage URL for a private object (leaked signed URL, guessed path, or
direct Storage API call) and fetch bytes with no server decision.

**Mitigation.** No route ever mints a signed URL (this was rejected in PROMPTS.md entry 3).
Downloads are proxied: the route authorises, writes an `allow` audit event, then streams bytes
from the private bucket using the server-side service key. The Storage bucket denies
`SELECT` for authenticated users entirely (`0010_storage.sql`), so even a logged-in user with
the project URL cannot list or read objects directly. Storage keys are server-generated
(`{docId}/v{n}/{uuid}.{ext}`) so clients cannot address another document's path.

**Status.** Mitigated, with the accepted risk in T6 (service key is a server secret).
Verified by hand-check on the live gateway (2026-10-21): the `public` and `authenticated`
object endpoints return 400/401 for both an anonymous caller **and a logged-in viewer with a
valid session**, and the bucket list returns `[]` even with a session — only the service key,
used server-side after the RPC authorises, ever touches objects.

## T3 — Tamper with or delete the audit trail

**Attack.** UPDATE a row to change what it says, DELETE an embarrassing row, or rewrite history
after the fact. Not only by a normal user: also by the platform super admin, and in principle by
the service role.

**Mitigation.**
1. Append-only trigger blocks `UPDATE` and `DELETE` on `audit_events` for **every** role,
   including `service_role` (`0007_audit.sql`).
2. Every row is chained: `event_hash = sha256(prev_hash || canonical(event))`, so removing or
   editing a row breaks verification of every later row. `tv_verify_audit_chain()` recomputes
   it SQL-side; `scripts/verify-audit-chain.mjs` re-implements the same canonicalisation
   independently in Node so a compromised SQL function cannot lie about itself.
3. `metadata_sha256` pins each event's metadata payload.

**Accepted risk (stated openly).** A Postgres superuser (the Supabase project owner) can drop
the trigger and rewrite rows. We cannot prevent our own infrastructure operator from breaking
their own database. What stops it *being silent* is (2): the rewritten chain fails external
verification, and the demo shows this by tampering with a row and running verify. This is the
answer to "what stops tampering" on the scorecard: **we do not claim tamper-proof, we claim
tamper-evident with an independent verifier.**

## T4 — Forge an audit event (false attribution)

**Attack.** Make the log say "Alice read the payroll file" when she did not, or attribute an
event to a user id I control.

**Mitigation.** `tv_log_event` is executable by `service_role` only, and takes the actor id as an
argument — routes pass the uid verified from the session cookie (`requireUser()`), never from the
request body. Browser-side keys cannot call it (no EXECUTE grant). `tv_log_event` also
auto-detects the true caller's `auth.uid()` and records it separately from the claimed actor.

**Accepted risk.** Server code with the service key can still attribute an event to any uid it
claims — that is inherent in any server-side logging of client identity; the defence is that only
repository code holds that key, and every call site passes a session-verified uid (this exact bug
was found and fixed in PROMPTS.md entry 2, commit `42fb237`).

## T5 — Revocation that does not revoke

**Attack.** Owner revokes Bob, but Bob keeps access because he holds a token, cached decision,
or a previously issued download link.

**Mitigation.** There is no token to hold. Every document request re-runs the database
authorisation function, and grants are considered revoked the moment `revoked_at` is set — no
cache, no signed URL, no "valid until" window. Tests revoke a live grant and immediately assert
the same session gets 404 on metadata, download, and list, and 404 on search.

**Accepted risk.** A download stream that already started may finish after a mid-flight
revocation (the bytes were authorised at stream start). The event is recorded as `allow` and the
revocation is recorded too; the next request fails.

## T6 — Service-role key compromise

**Attack.** The `SUPABASE_SERVICE_ROLE_KEY` leaks (client bundle, log, repo).

**Mitigation.** The key is server-only (`src/lib/supabase/*.ts` refuses to expose it to client
code), never sent to the browser, and `NEXT_PUBLIC_*` vars are distinct. Storage and RLS deny
browser keys all document reads.

**Accepted risk.** If it leaks, the attacker has full database access — this is true of every
server-side secret and is why it lives only in `.env.local`/Vercel env, never in git
(`.env.example` contains no values). Detection would require Supabase-side key rotation audit.

## T7 — Privilege escalation through sharing (grant laundering)

**Attack.** I am an *editor* on a document, so I add myself (or a friend) as owner/reader, or
grant a role I do not have.

**Mitigation.** `tv_document_grant` validates on write: only the owner may manage grants
(editors get 403 from `requireOwner`-style checks in `PATCH /api/documents/[id]` and the grants
routes), grants can only be `read`/`edit`, cannot target the owner, and cannot target an
already-revoked grantee without re-granting through the owner path. Ownership cannot be changed
by the API at all.

**Accepted risk.** The owner's email-address directory is visible to active accounts (searching
while sharing requires knowing who exists). Deliberate, documented in DECISIONS.md.

## T8 — Malicious file upload (content attacks, path escape, quota abuse)

**Attack.** Upload `.html`/`.svg`/executable content that later executes in a victim's browser,
or a filename like `../../etc/x`, or 4 GB to fill the bucket.

**Mitigation.** Extension allowlist (pdf, png, jpg, jpeg, webp, txt, md, csv, docx, xlsx, pptx),
magic-byte sniffing cross-checked against the declared MIME type (`0010_storage.sql` +
`src/lib/upload/validateUpload.ts`), 25 MB cap, filename sanitisation (control chars, path
separators, leading dots stripped), server-generated storage keys, DB `CHECK` that the stored
path is under the owning document's directory. Downloads are served with
`Content-Disposition: attachment` and a fixed safe content type, so browser-rendered execution
of stored content does not happen in our origin.

**Status.** Mitigated; asserted by `tests/authorization/upload-validation.test.ts`.

## T9 — Brute force / credential stuffing / weak passwords

**Attack.** Guess passwords, or sign up with `password12345`.

**Mitigation.** Server-side password policy: minimum 12 characters with complexity classes
(`src/lib/auth/passwordPolicy.ts`), applied on both signup and login-with-signup. Login and
signup routes are rate-limited per IP and per identifier (in-memory sliding window,
`src/lib/auth/rateLimit.ts`) and every failed login attempt is audited as `login.failed`.

**Accepted risk.** The in-memory rate limiter resets on server restart and is per-instance on
serverless (approximate under concurrency). A determined attacker would need distributed
requests; a production hardening would move this to a Redis/Postgres table.

## T10 — Unauthorised admin actions

**Attack.** A normal user hits `/api/admin/*` to read everything, verify chains, or manage
users. Or an admin tries to *edit* audit rows (which they should not be able to do).

**Mitigation.** `requireAdmin()` checks the profile's `role` (server-derived from the DB row,
never from the request) before any admin handler runs; `is_platform_admin()` in SQL does the same
inside the authorisation and audit RPCs. Admin audit routes are read-only surfaces — there is no
write/update/delete audit endpoint anywhere in the API, which is asserted by
`tests/authorization/admin-audit-readonly.test.ts`.

**Status.** Mitigated.

## T11 — SQL injection

**Attack.** Inject through search terms, filenames, emails, or JSON bodies.

**Mitigation.** No string-built SQL anywhere: all database access goes through the Postgres
client's parameterised statements or RPCs with typed parameters (`= $1`, `ILIKE '%' || $1 || '%'`
with `$1` bound). RPCs are `SECURITY DEFINER` but take scalars and bind them; user input is never
concatenated into SQL text. Emails are normalised to lowercase text rather than interpolated.

**Status.** Mitigated; search and login inputs are exercised by the test suite.

## T12 — Denial of service / resource exhaustion

**Attack.** Huge uploads, endless version spam, hammering search/audit endpoints.

**Mitigation.** 25 MB upload cap, per-request authorisation before any heavy work, search/audit
pagination with hard limits, rate limits on auth endpoints.

**Accepted risk.** No per-user quota on documents or versions yet; a legitimate-but-greedy user
could grow their own storage. Noted in TODO as a possible hardening item, out of scope for the
deadline.

## T13 — Deactivated user keeps working

**Attack.** Admin deactivates an account; the user's still-open browser tab keeps downloading.

**Mitigation.** `tv_document_has_access` requires `NOT p_account.deactivated` on every check, and
the app layout locks the UI with a "contact the administrator" screen on any 403/404-permission
response from `/api/me`.

**Status.** Mitigated (same mechanism as T5 — decisions are never cached).

## T14 — Session cookie theft through XSS

**Attack.** Inject script into the app's origin, read the Supabase session cookie, exfiltrate the
refresh token (the cookie's value contains it, and it outlives access tokens by design).

**Mitigation.** The session cookie is written with `HttpOnly; SameSite=Lax` (and `Secure` in
production) at every write site — `src/lib/supabase/sessionCookie.ts`, applied by both the server
client and the proxy's refresh path. JavaScript cannot read it. This was a real finding from the
pre-demo hand-check: the library defaults shipped a JS-readable cookie, and the fix was possible
because no client component talks to Supabase directly (the previously shipped browser client had
zero importers and was deleted in the same commit, `a3af91d`). Verified live: the login response
sets `HttpOnly`.

**Accepted risk (residual).** Our CSP allows `'unsafe-inline'`/`'unsafe-eval'` in `script-src`
(kept for Next.js compatibility), so a stored-XSS bug could still act *as* the victim's session
(issuing requests) — it just cannot read the token out. Fully tightening the CSP (nonce-based)
is listed as unfinished work. Downloads are served as `attachment` with `nosniff`, which removes
the main stored-content XSS vector.

## T15 — CSRF on state-changing endpoints

**Attack.** Trick a logged-in victim's browser into submitting a grant/revoke/delete request from
another origin.

**Mitigation.** Two independent properties, both verified by hand-check on the running app:
1. The session cookie is `SameSite=Lax`, so a cross-site form POST or fetch arrives **without**
   the cookie — the request is anonymous and fails at `requireUser()`.
2. Every state-changing route parses a JSON body (`request.json()`); an HTML form can only send
   urlencoded/multipart, so even if the cookie were attached the handler rejects the body.

**Accepted risk.** No per-request CSRF token (the SameSite + JSON combination is judged
sufficient for a first-party app with no cookie-based subdomains). GET routes are read-only and
RLS-scoped, so a forged GET can only trigger reads that are audited against the attacker's own
session, not the victim's.

## T16 — Forged or tampered session tokens

**Attack.** Present a hand-crafted JWT: `alg=none` with my own claims (e.g. `role:
"authenticated"` plus someone else's `sub`), an unsigned HS256 header, or a valid token with a
doctored signature.

**Mitigation.** The app never trusts a token it did not verify: `requireUser()` resolves the
session through Supabase Auth (`getUser()`), which checks the signature against the project
secret. Verified by hand-check against the live gateway: a valid token returns 200 (control),
while a tampered signature, an `alg=none` token claiming another user's id, and an unsigned
`HS256` token are all rejected with 401. There is no code path that decodes the JWT payload
without verification — claims like role come from the database row, not the token.

**Status.** Mitigated.

---

## What we deliberately did NOT do

- **Folder-inherited access** — folders are cosmetic; access is only ever a per-document grant.
  Inheritance bugs are the classic way isolation fails, so it is absent by design
  (DECISIONS.md "Never do this" list).
- **Signed URLs for downloads** — rejected in PROMPTS.md entry 3 because they outlive revocation.
- **Client-side authorisation** — no route trusts a client claim; the UI hides what the server
  has already refused, never the other way around.
- **Machine-granted access** — the "suggested viewers" feature only proposes; a human confirms,
  and both the suggestion and the decision are audited.
