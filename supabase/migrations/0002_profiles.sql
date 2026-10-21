-- ============================================================================
-- 0002_profiles.sql
-- Platform-level identity. One row per auth.users entry.
--
-- platform_role: 'user' | 'admin'. Document ownership is NOT a platform role;
-- it derives from documents.owner_id. Roles are written down in README/THREATS.
-- is_active: admins can deactivate a leaver; every authorisation decision
-- checks it, so a leaver loses all access immediately — not just "links".
--
-- Email handling: stored normalised lowercase with a CHECK, compared with
-- lower() everywhere. Avoids the citext extension entirely (one less
-- environment-dependent piece).
-- ============================================================================

create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null unique
                 check (email = lower(email) and char_length(email) between 3 and 254),
  full_name      text not null default ''
                 check (char_length(full_name) <= 120),
  platform_role  text not null default 'user'
                 check (platform_role in ('user', 'admin')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index profiles_platform_role_idx on public.profiles (platform_role)
  where platform_role = 'admin';

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.tv_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.tv_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile when a Supabase Auth user is created.
-- ---------------------------------------------------------------------------
create or replace function public.tv_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tv_handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper predicates used by RLS policies. SECURITY DEFINER so they can read
-- profiles without tripping profiles' own RLS (and without recursion).
-- Marked STABLE: policy-called functions must not be VOLATILE.
-- ---------------------------------------------------------------------------
create or replace function public.tv_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and platform_role = 'admin' and is_active
  );
$$;

create or replace function public.tv_is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create or replace function public.tv_actor_email()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select email from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- RLS: readable by self and admin only. NO insert/update/delete policies for
-- API roles — profiles are only mutated by SECURITY DEFINER RPCs (0009), so
-- nobody can promote themselves with a direct UPDATE.
-- (No FORCE: postgres owns the table and deliberately bypasses RLS so the
-- definer functions work; every API role is non-owner and fully subject to
-- these policies.)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_self_or_admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or tv_is_admin());
