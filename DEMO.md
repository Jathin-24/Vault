# DEMO.md — 5-minute demo video script

Target: 5:00 exactly. One continuous screen recording, three browser windows
(owner / grantee+outsider side by side / admin) plus the Supabase SQL editor and
a terminal. Narration is written to be read aloud at a normal pace — don't
paraphrase the security claims, the wording matters.

## Pre-flight (5 minutes before recording)

```bash
npm run db:seed        # resets demo passwords, refreshes sample data
npm run audit:verify   # must print chain OK + a head hash — you'll show this later
npm run dev            # http://localhost:3000
```

Browser setup (fresh profiles so logins don't fight over cookies):
- **Window A** — owner: `owner@trustvault.test` / `TrustVault!Demo2026`
- **Window B** — right half: `viewer@trustvault.test`, later swap to `outsider@trustvault.test`
- **Window C** — left half: `admin@trustvault.test`
- **Tab D** — Supabase SQL editor, and a terminal showing `npm run audit:verify`

Have `tests/` open in the editor for the closing shot.

---

## 0:00–0:35 — Hook: the claim

**Screen:** TrustVault landing page.

**Say:** "This is TrustVault. One claim: the wrong person can never read a file —
and the system can prove who read it, including everyone it *refused*. Sharing is
per-person, per-document, like a Google Sheet — no public links, no signed URLs.
Every request is re-authorized on the server, every yes *and every no* goes into
an append-only audit chain, and a revoke takes effect on the very next request.
Five minutes, all of it live."

## 0:35–1:20 — Owner shares one document

**Screen:** Window A → log in as owner → dashboard. Point at the three seeded
documents, then open **Q3 Payroll Summary**.

**Do:** Show the Share panel: Eddie = *edit*, Vera = *read*, Lena = *revoked
(history kept)*, Otto = absent. Say the rule out loud: "folders never grant —
access is decided per document, per email." Click **Activity** on the document —
seeded `access_denied` from Otto is already visible: "refusals are evidence too."

**Say:** "Ava owns this. She shares it with exactly two people. Note what doesn't
exist: there is no link to copy, no 'anyone with the URL' — there is nothing a
leaked URL could unlock."

## 1:20–2:10 — Grantee reads; stranger hits a wall

**Do (Window B):** log in as `viewer@trustvault.test` → open Q3 Payroll →
**Download** → file opens. "Vera has a read grant: she can read, she cannot edit,
she cannot re-share — try the buttons, they're 403."

**Do (Window B):** log out → log in as `outsider@trustvault.test`. Search for
"Payroll" → empty. Open the same document by URL → **404**. Download → 404.

**Say:** "Otto gets 404, not 403 — a stranger can't even learn the document
exists. The check isn't in this UI: every request runs an authorization function
*inside Postgres*, which writes the refusal to the audit trail before it answers."

**Do (Window C):** admin console → audit feed → filter `access_denied` → the
events from seconds ago, actor = Otto, with document and route.

## 2:10–2:55 — Revocation is immediate

**Do (Window A):** on Q3 Payroll, revoke Vera's grant. **Leave Window B logged in
as Vera, sitting on the open document.** Switch to B, press F5 (or Download).

**Show:** 404, instantly. Switch to A → activity now shows the revoke + Vera's new
`access_denied`.

**Say:** "Nothing was 'issued' that needs collecting: there is no signed URL with
a lifetime, no cached decision. The grant is read at decision time on the next
request — so the next request is a refusal, and that refusal is now evidence."

## 2:55–3:50 — What stops tampering?

**Do:** terminal → `npm run audit:verify` → runs live: chain OK, N events, head
hash printed. **Then (Tab D):** run:

```sql
update audit_events set outcome = 'success' where id = 1;
```

**Show:** the database refuses: `TrustVault: audit_events is append-only (UPDATE
is not permitted)`.

**Say:** "Two answers. One: the table is append-only *in the database* — a
trigger blocks update and delete for every role, including the service key the
API itself uses; there is no endpoint with write verbs either, only 405s. Two:
every row hashes the previous row, so even someone with enough power to drop the
trigger can't quietly rewrite history — verification recomputes every hash and
stops at the first lie. The accepted risk is written down in THREATS.md, with
this detection as the answer."

## 3:50–4:30 — Admin: sees everything, changes nothing

**Do (Window C):** admin → documents → open *Board Minutes* (admin has no grant).
Show metadata view: "admin — break-glass". **Download** it.

**Show:** the file downloads; immediately open audit feed filtered
`admin_override` — the event exists, actor = admin. Then show the header claim:
DevTools → Network → the download response → `X-TrustVault-Access: admin-override`.

**Say:** "The admin is the most watched user: content access only through a
separate break-glass call that audits itself *before* any byte streams, and the
audit log has no write path for them — or anyone. Full trail, zero edit rights."

## 4:30–5:00 — Close: it's tested

**Screen:** terminal → run one file to keep it quick:

```bash
$env:TEST_BASE_URL = "http://localhost:3000"; npx vitest run tests/authorization/cross-user-isolation.test.ts
```

**Show:** green pass line. Then switch to the repo root: README, THREATS.md,
PROMPTS.md, API.md.

**Say:** "The core claim isn't asserted, it's tested: automated cross-user
isolation tests run against the live app, each denial paired with a positive
control so a *broken* endpoint can't pass — delete an auth check and they go red.
Threat model, API permissions, and an honest log of every AI prompt and what was
wrong with its answer — all in the repo. That's TrustVault."

---

## Timing safety

- If running long: cut the DevTools header shot (keep `admin_override` in the
  feed — the audit event is the claim).
- If short: add 20s showing `npm test` full output (100 passed) instead of one file.
- Never show `.env.local`, the service-role key, or the Supabase dashboard API page
  on camera.
