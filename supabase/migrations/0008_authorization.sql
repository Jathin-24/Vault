-- ============================================================================
-- 0008_authorization.sql
-- The single source of truth for "may this person reach this document?".
--
-- tv_document_has_access() is called by every RLS policy below, and
-- tv_authorize_document_access() (0009) wraps it for API routes with audit
-- logging. Both evaluate at request time against document_grants; neither
-- caches anything. If this function were deleted, every policy fails CLOSED
-- (they'd return false) — the system denies by default.
-- ============================================================================

create or replace function public.tv_document_owner(p_document_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select owner_id from public.documents where id = p_document_id;
$$;

-- p_want: 'read' | 'edit'
--   owner         -> both
--   grant 'read'  -> read (and read-only)
--   grant 'edit'  -> read + edit
--   platform admin-> read of METADATA ONLY (content requires break-glass RPC
--                    tv_admin_read_document, which logs admin_override)
create or replace function public.tv_document_has_access(p_document_id uuid, p_want text)
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
    when exists (
      select 1 from public.documents
      where id = p_document_id and owner_id = auth.uid()
    ) then true
    when p_want = 'read' and tv_is_admin() then true
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
        and (g.permission = 'edit' or p_want = 'read')
    ) then true
    else false
  end;
$$;

-- ============================================================================
-- documents
-- ============================================================================
alter table public.documents enable row level security;

create policy "documents_select_owner_grant_or_admin"
  on public.documents for select
  to authenticated
  using (tv_document_has_access(id, 'read'));

create policy "documents_insert_own_only"
  on public.documents for insert
  to authenticated
  with check (tv_is_active_user() and owner_id = auth.uid());

create policy "documents_update_owner_or_editor"
  on public.documents for update
  to authenticated
  using (tv_document_has_access(id, 'edit'))
  with check (tv_document_has_access(id, 'edit'));

-- Physical delete is owner-only (the app uses soft delete; hard purge goes
-- through tv_purge_document which checks status + ownership/admin and logs).
create policy "documents_delete_owner_only"
  on public.documents for delete
  to authenticated
  using (owner_id = auth.uid() and tv_is_active_user());

-- Guards that RLS cannot express (column-level intent):
--   * ownership never changes (no transfer feature; no silent hijack)
--   * only the owner may flip status active<->deleted (editors cannot delete)
create or replace function public.tv_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'TrustVault: document ownership cannot be changed'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and auth.uid() is distinct from old.owner_id then
    raise exception 'TrustVault: only the document owner may delete or restore a document'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger documents_guard
  before update on public.documents
  for each row execute function public.tv_documents_guard();

-- ============================================================================
-- document_versions
-- ============================================================================
alter table public.document_versions enable row level security;

create policy "versions_select_read_access"
  on public.document_versions for select
  to authenticated
  using (tv_document_has_access(document_id, 'read'));

create policy "versions_insert_edit_access"
  on public.document_versions for insert
  to authenticated
  with check (
    tv_is_active_user()
    and tv_document_has_access(document_id, 'edit')
    and uploaded_by = auth.uid()
  );

-- No UPDATE/DELETE policies: version history is immutable through the API.
-- (Physical rows disappear only when the document itself is purged.)
