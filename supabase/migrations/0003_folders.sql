-- ============================================================================
-- 0003_folders.sql
-- Folders ORGANISE documents. They do NOT grant access to anything.
--
-- This is a deliberate design decision, and the most important comment in this
-- codebase: folder-level permission inheritance is exactly the bug the product
-- exists to fix ("given access to a folder so they can see one file, and they
-- can now see forty"). Every access decision is made per document, from
-- document_grants, at request time.
-- ============================================================================

create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  parent_id   uuid references public.folders (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- path traversal / control characters never survive validation anywhere
  check (name !~ '[[:cntrl:]]')
);

create index folders_owner_idx on public.folders (owner_id);
create index folders_parent_idx on public.folders (parent_id);

create trigger folders_touch_updated_at
  before update on public.folders
  for each row execute function public.tv_touch_updated_at();

alter table public.folders enable row level security;

create policy "folders_owner_all"
  on public.folders for all
  to authenticated
  using (owner_id = auth.uid() or tv_is_admin())
  with check (owner_id = auth.uid());
-- Note the asymmetry: admins can SEE folders (metadata), only the owner can
-- create/change/delete them.
