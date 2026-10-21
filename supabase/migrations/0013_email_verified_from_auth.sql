-- ============================================================================
-- 0013_email_verified_from_auth.sql
-- Bug found by the first full HTTP test run: grants never activated for
-- grantees. Every access path matched grant rows with
--     auth.jwt()->>'email_verified' = 'true'
-- but modern Supabase access tokens carry NO top-level email_verified claim
-- (it lives inside user_metadata, which the USER can edit — trusting it would
-- let anyone grant themselves access by rewriting their own metadata). So the
-- verified-email gate could never open, and every grantee got 404.
--
-- Fix: verification state comes from the only spoof-proof source — Supabase
-- Auth's auth.users.email_confirmed_at — and is synced into
-- profiles.email_verified by a trigger on auth.users (INSERT + UPDATE, so a
-- user confirming their address later flips the flag immediately). Matching
-- then uses profiles (owned by us, not user-editable) instead of JWT claims.
-- ============================================================================

alter table public.profiles
  add column if not exists email_verified boolean not null default false;

-- Helper for all access paths: is the CALLER's email confirmed?
create or replace function public.tv_actor_email_verified()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select email_verified from public.profiles where id = auth.uid()),
    false
  );
$$;

-- Sync trigger: auth.users is the source of truth for email + confirmation.
-- SECURITY DEFINER so the auth-side trigger can write public.profiles.
-- Trigger name sorts AFTER on_auth_user_created ('c' < 's'), so the profile
-- row exists by the time this runs for a brand-new user.
create or replace function public.tv_sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = lower(new.email),
      email_verified = (new.email_confirmed_at is not null)
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_sync_profile on auth.users;
create trigger on_auth_user_sync_profile
  after insert or update on auth.users
  for each row execute function public.tv_sync_auth_user_profile();

-- Backfill existing profiles (idempotent; also re-run-safe).
update public.profiles p
set email_verified = (u.email_confirmed_at is not null)
from auth.users u
where u.id = p.id
  and p.email_verified is distinct from (u.email_confirmed_at is not null);

-- ---------------------------------------------------------------------------
-- Re-point every access path at profiles-based matching (JWT claims removed).
-- ---------------------------------------------------------------------------

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
            g.grantee_email = lower(coalesce(public.tv_actor_email(), ''))
            and public.tv_actor_email_verified()
          )
        )
        and (g.permission = 'edit' or p_want = 'read')
    ) then true
    else false
  end;
$$;

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
            g.grantee_email = lower(coalesce(public.tv_actor_email(), ''))
            and public.tv_actor_email_verified()
          )
        )
    ) then true
    else false
  end;
$$;

create or replace function public.tv_authorize_document_access(
  p_document_id  uuid,
  p_action       text,            -- 'read' | 'edit'
  p_route        text default null,
  p_ip           text default null,
  p_user_agent   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_allowed  boolean := false;
  v_reason   text := 'not_found';
  v_perm     text;
  v_is_owner boolean := false;
  v_title    text;
  v_event    text;
begin
  if p_action not in ('read', 'edit') then
    raise exception 'TrustVault: unknown action %', p_action;
  end if;

  if v_uid is null then
    v_reason := 'unauthenticated';
  elsif not exists (select 1 from public.profiles where id = v_uid and is_active) then
    v_reason := 'user_inactive';
  else
    select (owner_id = v_uid), title into v_is_owner, v_title
      from public.documents where id = p_document_id;

    if found then
      if v_is_owner then
        v_allowed := true; v_reason := 'owner'; v_perm := 'owner';
      else
        select g.permission into v_perm
          from public.document_grants g
          where g.document_id = p_document_id
            and g.revoked_at is null
            and (
              g.grantee_user_id = v_uid
              or (
                g.grantee_email = lower(coalesce(public.tv_actor_email(), ''))
                and public.tv_actor_email_verified()
              )
            )
          limit 1;
        if v_perm is not null and (v_perm = 'edit' or p_action = 'read') then
          v_allowed := true; v_reason := 'grant';
        else
          v_reason := case when v_perm is null then 'no_grant'
                           else 'grant_insufficient' end;
        end if;
      end if;
    end if;
    -- Note: platform admins are NOT allowed here. Content access for admins
    -- goes through tv_admin_read_document (break-glass, separately audited).
  end if;

  v_event := case
    when v_allowed and p_action = 'read' then 'document.read'
    when v_allowed and p_action = 'edit' then 'document.edit'
    else 'access_denied'
  end;

  perform public.tv_log_event(
    v_event,
    p_document_id,
    null,
    p_route,
    case when v_allowed then 'success' else 'denied' end,
    case when v_allowed
      then jsonb_build_object('action', p_action, 'permission', v_perm, 'title', v_title)
      else jsonb_build_object('action', p_action, 'reason', v_reason)
    end,
    p_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'permission', coalesce(v_perm, 'none'),
    'is_owner', v_is_owner
  );
end;
$$;
