# API reference — TrustVault

All routes are `GET`/`POST`/`PATCH`/`DELETE` under `/api`, JSON in / JSON out, session-cookie auth
(Supabase SSR cookies `sb-<ref>-auth-token*`, `HttpOnly; SameSite=Lax` — set by
`/api/auth/login`, refreshed by `src/proxy.ts`). Every route is authenticated **server-side**
except `/api/auth/login` and `/api/auth/signup`. Errors use `{ "error": "<message>" }` with a
status of `400` (bad input), `401` (no/invalid session), `403` (authenticated but not allowed to
act on a resource that exists), `404` (resource invisible to you — also returned when an
authorisation check denies, to avoid confirming existence), `409` (conflict), `429` (rate limit).

**Notation.** *Role* column = what the caller must be. *Document access* column = the per-document
check run inside Postgres by `tv_authorize_document_access()` on every call. `—` = not applicable.

## Auth

| Method + path | Role | Document access | Notes |
| --- | --- | --- | --- |
| `POST /api/auth/signup` | public | — | Password ≥12 chars w/ complexity, checked before the account exists. Email verification stays ON, so no session is issued here — signup cannot be used to probe "does this email exist" (uniform `{ ok: true }`). Rate-limited (IP). Audited. |
| `POST /api/auth/login` | public | — | Rate-limited (IP + identifier). Failed attempts audited as `auth.login_failed`. Deactivated accounts get the same generic 401. |
| `POST /api/auth/logout` | session | — | Ends session. Audited. |
| `GET /api/me` | session | — | Own profile row (email, name, role, `is_active`) via RLS self-read; the UI locks the session when `is_active=false`. |

## Documents

| Method + path | Role | Document access | Notes |
| --- | --- | --- | --- |
| `GET /api/documents?q=&owner=&category=&status=&folderId=&from=&to=&page=&limit=` | session | filter applied in SQL (RLS) | List + search in one endpoint. Never returns documents without `read`, not even their titles/counts. |
| `POST /api/documents` | session | — | Creates the record; owner = session user (pinned server-side). |
| `GET /api/documents/:id` | session | **read** | Metadata + owner + version list + my role. |
| `PATCH /api/documents/:id` | session | **edit** + owner-only fields | Title/description/category/folder: owner or editor. Owner/status changes are refused by a DB trigger too. |
| `DELETE /api/documents/:id` | session | **owner only** | Soft-delete (`status=deleted`). Editors → 403, strangers → 404. |
| `POST /api/documents/:id/restore` | session | **owner only** | Undo soft delete (DB trigger refuses anyone else, admins included). |
| `POST /api/documents/:id/purge` | session | **owner or admin** + already soft-deleted | Deletes objects then rows via `tv_purge_document` (snapshot logged first). |
| `GET /api/documents/:id/download[?version=n]` | session | **read** (fresh) | No signed URLs. Authorise → write `allow`/`deny` audit → stream bytes from private bucket. Deny ⇒ 404, zero bytes. |
| `POST /api/documents/:id/versions` | session | **edit** | Multipart upload; validates extension/magic bytes/MIME/25 MB; server-generated storage key; unwinds storage object if DB write fails. |

## Grants (sharing)

| Method + path | Role | Document access | Notes |
| --- | --- | --- | --- |
| `GET /api/documents/:id/grants` | session | **owner only** (admin: read-only) | Grantees themselves get 404 — the list would disclose who else has access. |
| `POST /api/documents/:id/grants` | session | **owner only** | `{ email, permission: read\|edit }`. 403 for editors. Rate-limited. `grant.create` written by a table trigger (works even for direct SQL). |
| `PATCH /api/documents/:id/grants` | session | **owner only** | Body `{ grantId, permission }`. 403 for editors. `grant.permission_changed` written by the trigger. |
| `DELETE /api/documents/:id/grants?grantId=…` | session | **owner only** | Revoke (sets `revoked_at`; row kept for history). Immediately effective on the grantee's next request. |
| `GET /api/documents/:id/suggestions` | session | **owner only** | Heuristic viewer suggestions, persisted for a later auditable decision (never auto-granted). Owner-only both in the route and inside `tv_suggest_viewers`. |
| `POST /api/documents/:id/suggestions` | session | **owner only** | Body `{ suggestionId, decision: accepted\|declined }`. Accept creates the real grant; both the decision and the grant are audited. |

## Folders

| Method + path | Role | Document access | Notes |
| --- | --- | --- | --- |
| `GET /api/folders` | session | — | Caller's own folders. |
| `POST /api/folders` | session | — | Name ≤80 chars, validated. |
| `PATCH /api/folders/:id` | session | — | Owner of the folder only. |
| `DELETE /api/folders/:id` | session | — | Owner only; documents keep existing (folders never grant/deny). |

## Audit (own activity)

| Method + path | Role | Document access | Notes |
| --- | --- | --- | --- |
| `GET /api/audit?eventType=&outcome=&documentId=&from=&to=&limit=&offset=` | session | joins only own + visible events | Events where the caller is actor, or the event's document is theirs. `GET /api/documents/:id` also returns the version list. |

## Admin (`is_platform_admin()` checked server-side + in SQL)

| Method + path | Role | Document access | Notes |
| --- | --- | --- | --- |
| `GET /api/admin/summary` | admin | all metadata | Counters for the console. |
| `GET /api/admin/audit?eventType=&actor=&outcome=&documentId=&from=&to=&limit=&offset=` | admin | metadata of all | **Read-only.** `audit_events` has no insert/update/delete policy for any API role, and a table trigger blocks UPDATE/DELETE for every role including the service key — so this endpoint is read-only by construction, not by convention. |
| `GET /api/admin/documents?q=&status=` | admin | metadata only | Every document incl. deleted, with owner + grant counts. Never returns bytes. |
| `GET /api/documents/:id/download` (as admin) | admin | **break-glass** | The same download route: when the normal authorisation says no, it calls `tv_admin_read_document`, which writes an `admin_override` audit event before any byte streams. Response header `X-TTrustVault-Access: admin-override`. |
| `GET /api/admin/anomalies` | admin | — | Rate / failure / override anomaly scan. |
| `POST /api/admin/verify` | admin | — | Runs `tv_verify_audit_chain()`; returns `{ ok, events, head }` or `{ ok: false, broken_at, reason }`. |
| `GET /api/admin/users` | admin | — | Directory of accounts. |
| `PATCH /api/admin/users` | admin | — | Body `{ userId, platformRole? , isActive? }` → `tv_set_platform_role` / `tv_set_user_active` (each re-checks admin and writes its own audit event). Deactivation takes effect on the victim's next request. |

## Cross-cutting guarantees

1. **Every document-touching request is authorised inside Postgres, at request time:** RLS
   (`tv_document_has_access`) filters every query, and content paths (download, upload) call
   `tv_authorize_document_access()` explicitly first. Fail-closed: if that call errors, the
   request errors — no bytes, no data.
2. **Allow and deny are both written to the append-only hash-chained audit table** — denials
   included, before any content is streamed.
3. **No signed URLs, no bearer links, no cached decisions, no client-side trust, no folder
   inheritance.**
4. `tv_log_event` is executable by the service role only; actor ids come from the
   session-verified uid passed by routes, never from the request body.
