# TrustVault

**A document platform where the wrong person can never read a file — and you can
prove who read it, including everyone who was refused.**

Sharing works like Google Sheets grants: the owner shares a specific document with
a specific email, as *read* or *edit*. There is no signed URL, no shared link, no
"anyone with the link" — the server re-checks authorisation on **every** request,
writes every allow **and every deny** into an append-only audit chain, and a revoke
takes effect on the very next request.

- `API.md` — every endpoint with an explicit permission table
- `THREATS.md` — the threat model: 13 attacks, what stops each, what we accept
- `PROMPTS.md` — honest log of how AI was used, what was wrong with each output,
  and the commit that fixed it
- `DEMO.md` — 5-minute demo video script

## The three claims, and where they live

| Claim | Where it is enforced |
| --- | --- |
| Server-side authorisation on every route | `tv_authorize_document_access()` in Postgres, called by every document route per request; RLS as defence-in-depth; downloads stream through the API with the service key **only after** the RPC allows |
| Provable audit trail, refusals included | Append-only trigger (all roles, incl. the service key) + SHA-256 hash chain; `npm run audit:verify` recomputes it; refusals are `access_denied` events written **before** the response |
| Revocation is immediate | Grants are read at decision time on every request — nothing is cached, no signed URL exists to outlive the revoke |

The super admin sees everything but **cannot modify the evidence**: `audit_events`
has no write policy for any API role and a trigger blocks UPDATE/DELETE outright
(tested with a direct-SQL bypass attempt in `tests/authorization/audit-integrity.test.ts`).
Admins reach file content only via an audited break-glass path.

## Quick start

Prerequisites: Node 20+, a Supabase project.

```bash
npm install
cp .env.example .env.local     # then fill from Supabase: Project Settings → API
npm run db:migrate             # applies supabase/migrations/0001–0013 (idempotent)
npm run db:seed                # optional: 6 demo accounts + sample documents
npm run dev                    # http://localhost:3000
```

`.env.local` (never committed):

| Variable | Where from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` **or** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API → anon/publishable key (either name works) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role key — **server only** |
| `DATABASE_URL` | Connect → Session mode (direct). Only used by `npm run db:migrate` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` in dev, your Vercel URL in prod |

## Demo accounts

All created by `npm run db:seed` with password **`TrustVault!Demo2026`**:

| Account | Role | What it demonstrates |
| --- | --- | --- |
| `owner@trustvault.test` | user | Owns every sample document; shares, revokes, sees activity |
| `editor@trustvault.test` | user | *edit* grant on "Q3 Payroll Summary" — can write, cannot re-share |
| `viewer@trustvault.test` | user | *read* grant — can read, cannot change anything |
| `outsider@trustvault.test` | user | **No grant anywhere** — every document is 404, and each attempt is audited |
| `leaver@trustvault.test` | user | Has a **revoked** grant (history kept) — shows revoke, not absence |
| `admin@trustvault.test` | admin | Sees the full audit trail, cannot write it; break-glass content access is itself audited |

Sample documents: *Q3 Payroll Summary* (shared with Eddie + Vera, revoked for
Lena, never shared with Otto), *Board Minutes — Confidential* and *Vendor Contract —
Acme Corp* (owner only). A seeded `access_denied` event means the admin console
shows refusals on first load.

## Tests

```bash
npm run typecheck              # tsc --noEmit (strict)
npm test                       # unit tests; integration files SKIP without TEST_BASE_URL
```

The integration suite needs the app running and tells you so loudly when it skips:

```bash
npm run dev                    # terminal 1
# terminal 2 (PowerShell):
$env:TEST_BASE_URL = "http://localhost:3000"; npm test
# bash: TEST_BASE_URL=http://localhost:3000 npm test
```

**100 tests** against the real app and real database: cross-user isolation
(every negative assertion has a mirror-image positive control), revocation,
audit-chain integrity under direct SQL tampering, admin read-only, sessions and
rate limits, upload validation, and unit tests for the security helpers.

The isolation tests are the kill-switch: **remove an auth check, drop an RLS
policy, or delete the authorisation RPC and they fail.** Two independent layers —
RLS makes requests return 404, the RPC missing stops `access_denied` events — and
different tests watch each.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (middleware/proxy included) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript strict, no emit |
| `npm test` / `npm run test:watch` | Vitest once / watch |
| `npm run db:migrate` | Applies `supabase/migrations/*.sql` in order (idempotent; tracks applied files) |
| `npm run db:seed` | Creates/resets the demo data (re-run safe; resets demo passwords) |
| `npm run audit:verify` | Recomputes the SHA-256 hash chain of every audit event; prints the head hash |

## Deploying

**Supabase (once):** create a project → run `npm run db:migrate` locally against it
(`DATABASE_URL` = Connect → Session mode). Migrations are plain SQL files applied
in filename order and recorded, so re-running is safe. `npm run db:seed` is
optional in production — it only creates the demo accounts.

**Live demo:** https://trustvault-seven.vercel.app (Vercel, `main` = this repo).

**Vercel (via CLI, what this project used):**

```bash
vercel link --yes --project trustvault
vercel env add NEXT_PUBLIC_SUPABASE_URL production          # …repeat for each var
vercel deploy --prod --yes
```

Importing the GitHub repo works identically. Set `NEXT_PUBLIC_APP_URL` to the
exact production URL (the Origin check on mutations compares against it).
`DATABASE_URL` is not needed on the host — migrations run from your machine.
Watch out when piping env values into `vercel env add` from PowerShell: the pipe
appends a newline and every secret silently gains a trailing CRLF (verify with
`vercel env pull`). Nothing else to configure; the build runs `next build` and
the proxy handles session refresh per request.

**Upload size on the hosted demo:** Vercel refuses request bodies over ~4.5 MB
at the platform edge — nothing is stored and the app's own 25 MB cap is what
applies when you self-host. The test suite accounts for both referees.

**After deploy:** log in as `admin@trustvault.test`, open the admin console →
*Verify chain* to confirm the audit chain is intact on the live database.

## How it fits together

```
browser ── session cookie ──> Next.js (proxy refreshes session)
                                │
        every document route ───┼──> supabase.rpc("tv_authorize_document_access")
                                │        ├─ evaluated in Postgres, at this moment
                                │        ├─ writes allow OR deny audit event first
                                │        └─ fail closed: RPC error ⇒ no access
                                │
        only if allowed ────────┴──> service-role read of storage object → stream
```

RLS protects every table underneath (the browser's own anon-key client can only
ever see what its grants allow), the audit table is append-only by trigger with a
hash chain, and storage is private — objects are reachable only through the API
route above, never through a public URL.
