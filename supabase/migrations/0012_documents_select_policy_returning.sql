-- ============================================================================
-- 0012_documents_select_policy_returning.sql
-- Bug found by the first full test run against a live database: creating a
-- document through the API (INSERT ... RETURNING, i.e. PostgREST's
-- `.insert(...).select(...)`) failed with "new row violates row-level
-- security policy for table documents", while the same INSERT without
-- RETURNING succeeded.
--
-- Cause (PostgreSQL semantics): the RETURNING clause is subject to the
-- table's SELECT policy, and policy predicates run against the statement
-- snapshot — which cannot see rows the statement itself is inserting. The
-- old select policy answered "owner?" with a subquery over documents
-- (`exists (select 1 from documents where id = ... and owner_id = auth.uid())`),
-- so for a brand-new row that lookup always missed and the owner was denied
-- their own document.
--
-- Fix: the owner check becomes a DIRECT ROW REFERENCE (owner_id = auth.uid()),
-- which is always visible because it is evaluated on the row being returned.
-- The other read paths (grants, platform admin) move to
-- tv_document_read_grant(), which reads only untouched tables (profiles,
-- document_grants) and is therefore snapshot-safe.
--
-- Semantics are unchanged: active user AND (owner OR active grant OR admin).
-- ============================================================================

create or replace function public.tv_document_read_grant(p_document_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when not exists (
      select 1 from public.profiles where id = auth.uid() and is_active
    ) then false
    when tv_is_admin() then true
    when exists (
      select 1 from public.document_grants g
      where g.document_id = p_document_id
        and g.revoked_at is null
        and (
          g.grantee_user_id = auth.uid()
          or (
            g.grantee_email = lower(coalesce(auth.jwt()->>'email', ''))
            and coalesce(auth.jwt()->>'email_verified', 'false') = 'true'
          )
        )
    ) then true
    else false
  end;
$$;

drop policy if exists "documents_select_owner_grant_or_admin" on public.documents;

create policy "documents_select_owner_grant_or_admin"
  on public.documents for select
  to authenticated
  using (
    tv_is_active_user()
    and (
      owner_id = auth.uid()
      or tv_document_read_grant(id)
    )
  );
