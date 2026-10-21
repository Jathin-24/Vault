-- ============================================================================
-- 0005_grants.sql
-- THE permission table. Google-Sheets-style: a grant names a person by email
-- and gives exactly one permission: 'read' or 'edit'.
--
-- Revocation model: revoke = set revoked_at. Rows are never deleted, so the
-- audit history stays intact. EVERY access decision (RLS policies and
-- tv_authorize_document_access) requires revoked_at is null, evaluated at
-- request time. Nothing caches a decision, and no URL is a bearer token:
-- downloads re-check this table before a single byte streams.
--
-- grantee_user_id is a hint for UX/queries when the person already has an
-- account; matching at access time uses the VERIFIED email from the Supabase
-- JWT, so grants to people who sign up later (customers, regulators) activate
-- automatically and safely.
-- ============================================================================

create table public.document_grants (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  grantee_user_id uuid references public.profiles (id) on delete set null,
  grantee_email   text not null check (grantee_email = lower(grantee_email) and char_length(grantee_email) between 3 and 254),
  permission      text not null check (permission in ('read', 'edit')),
  granted_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles (id)
  -- NOTE: "no self-grant" cannot live in a CHECK (auth.jwt() is STABLE, and
  -- CHECK constraints need IMMUTABLE expressions). It is enforced in the
  -- grant-creation path (API route + RPC), and is harmless if bypassed:
  -- the owner already has access through ownership.
);

-- At most ONE active grant per (document, email). Re-granting after a revoke
-- creates a new row; the history stays.
create unique index document_grants_one_active_per_email
  on public.document_grants (document_id, grantee_email)
  where revoked_at is null;

-- Hot path for RLS lookups.
create index document_grants_active_lookup
  on public.document_grants (grantee_email)
  where revoked_at is null;

create index document_grants_document_idx on public.document_grants (document_id);
create index document_grants_user_idx on public.document_grants (grantee_user_id);

alter table public.document_grants enable row level security;

create policy "grants_select_visible"
  on public.document_grants for select
  to authenticated
  using (
    tv_is_admin()
    or grantee_user_id = auth.uid()
    or lower(grantee_email) = tv_actor_email()
    or exists (
      select 1 from public.documents d
      where d.id = document_grants.document_id and d.owner_id = auth.uid()
    )
  );

-- Only the document owner may create/revoke grants. Editors CANNOT share:
-- an editor who could re-share would escalate by sharing onward.
create policy "grants_insert_owner_only"
  on public.document_grants for insert
  to authenticated
  with check (
    tv_is_active_user()
    and granted_by = auth.uid()
    and exists (
      select 1 from public.documents d
      where d.id = document_grants.document_id and d.owner_id = auth.uid()
    )
  );

create policy "grants_update_owner_only"
  on public.document_grants for update
  to authenticated
  using (
    tv_is_active_user()
    and exists (
      select 1 from public.documents d
      where d.id = document_grants.document_id and d.owner_id = auth.uid()
    )
  )
  with check (
    tv_is_active_user()
    and exists (
      select 1 from public.documents d
      where d.id = document_grants.document_id and d.owner_id = auth.uid()
    )
  );

-- No DELETE policy: grants are revoked, never removed.
