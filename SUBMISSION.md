# SUBMISSION.md — copy-paste drafts for hackathon.snovasys.com

Placeholders marked `«…»` to fill in after deploy. Everything below is checked
against the repo — no claim here is unsourced.

---

## Title

**TrustVault — provable document access control**

## One-liner

A document platform where every file is reachable only by people the owner
granted, every request re-decides server-side, every refusal is evidence in a
tamper-evident audit chain, and a revoke works on the very next request.

## GitHub link

`«PUBLIC repo URL»`

## Live URL

`«VERCEL URL»`

---

## 1. Problem solved, in your own words

Two failures. First, **over-sharing**: folder grants hand forty people access
when one was intended, and a link keeps working after its recipient leaves. So
TrustVault has no folder permissions and no links at all — access is exactly one
thing: a grant row naming one email on one document, `read` or `edit`, revocable
by the owner. Second, **no proof**: after a leak, "who opened this?" usually has
no trustworthy answer. TrustVault writes every access *and every refusal* into
an append-only Postgres table chained by SHA-256 hashes, so the answer exists,
includes the people who were stopped, and cannot be quietly edited — not even by
the platform admin, who has no write path to the log at all.

## 2. What actually works right now — specific and honest

Everything in the brief is live and tested (100 automated tests, green):
six seeded accounts (admin/owner/editor/viewer/outsider/leaver), upload with
real validation (magic bytes, 25 MB cap, traversal-proof names), versioned
documents, search by name/owner/category/date, per-email read/edit grants,
one-click revocation that 404s the next request, Google-style share dialog with
a "suggested viewers" assist that never widens access on its own, soft-delete +
restore + purge, own-activity and admin audit feeds with filters, admin console
with chain verification and an audited break-glass download, login rate limiting
and a 12-char password policy. The audit chain verifies clean (276 events at the
time of writing) with an independent Node verifier that re-implements the SQL
one. Honest limits are in answer 6.

## 3. How to run it — exact commands

```bash
git clone «repo» && cd trustvault
npm install
cp .env.example .env.local   # fill 5 values from your Supabase project (README table)
npm run db:migrate           # applies supabase/migrations/0001–0013, idempotent
npm run db:seed              # optional demo data
npm run dev                  # http://localhost:3000
```

Tests (needs the dev server running): `$env:TEST_BASE_URL="http://localhost:3000"; npm test`
(bash: `TEST_BASE_URL=http://localhost:3000 npm test`). Demo login for every role
is in the README (`*@trustvault.test`, one shared demo password).

## 4. Which AI tools used

OpenCode — an AI coding agent run from the terminal (model: MiMo). Every prompt,
what it produced, what was wrong with it, and the commit that fixed it is logged
in `PROMPTS.md` (9 dated entries; 3 are specifically about authorisation/audit).
The method: paste the agreed design from `DECISIONS.md` before asking for a
module, then run a fixed hostile-review checklist after it, then execute against
the real database — reading SQL is not running SQL.

## 5. What AI got wrong, and what was fixed personally (25 marks)

The AI was confidently wrong in ways that would have shipped broken or insecure:

1. **Schema draft junk + invalid SQL** (PROMPTS #1): a leftover query line in a
   migration, a CHECK constraint calling the STABLE `auth.jwt()`, a dead CTE.
   All caught by review before first commit (`99b1180`).
2. **Audit actor identity** (#2): the first design attributed service-side
   events to the wrong identity. Fixed by deriving the actor only from the
   verified session uid, never the request body (`42fb237`).
3. **Four database-semantics bugs found only by executing it** (#7): role-name
   syntax in GRANT/REVOKE, `SELECT INTO` on an empty audit chain yielding NULL
   and violating NOT NULL on the very first event, `INSERT…RETURNING` failing
   RLS because policy predicates can't see the row being inserted, and — the
   worst — grant matching on a JWT `email_verified` claim modern Supabase
   doesn't send (user-editable metadata; grants could never activate, and
   trusting it would be a privilege-escalation hole). Fixed with layered,
   idempotent migrations `0011–0013`; verification moved to
   `auth.users.email_confirmed_at` synced into our own table (`4f46484`).
4. **What the test suite caught after the AI was sure it worked** (#8): a
   security header misspelled so the break-glass marker never reached clients
   (`703db15`), a 500 where RLS refused by exception (`703db15`), and a search
   input that tripped Cloudflare's WAF and surfaced as a 500 — the AI first
   mis-diagnosed it as PostgREST quoting and a live probe disproved that before
   the real fix (`81922e7`).

Direction, not typing: the AI produced the code; the acceptance bar (run it
against the real database, test it as the attacker, link every claim to a
commit) was mine, and that is where all four classes of bug died.

## 6. What is not finished — honest gaps

- **Tests not yet re-run against the deployed Vercel URL** (they run against the
  local app + real database); will run with `TEST_BASE_URL` after deploy.
- **CSP still allows `unsafe-inline`/`unsafe-eval`** (Next.js compatibility), so
  a stored-XSS bug could act as the victim even though the HttpOnly cookie
  cannot be read out (THREATS T14). Nonce-based CSP is the fix, not done.
- **Rate limiter is in-memory** — resets on restart, approximate under
  serverless concurrency (T9). Production answer: Redis/Postgres.
- **No per-user storage/version quota** (T12); a greedy user can fill their own
  space.
- **A download already in flight finishes after a mid-flight revoke** (bytes
  were authorised at stream start); the next request is refused and both events
  are recorded (T5).
- **A Postgres superuser can drop the audit trigger** (T3). Prevention at that
  level is impossible by definition; the answer is detection — an external,
  independently-implemented chain verifier that fails loudly on the first lie.
- **No MFA/WebAuthn**; email visibility between active accounts is deliberate
  (sharing requires knowing who exists).
