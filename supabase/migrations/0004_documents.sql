-- ============================================================================
-- 0004_documents.sql
-- Documents + immutable version history.
--
-- Storage layout: bucket 'documents' (private), object key
--   {document_id}/v{version_no}/{random-uuid}.{ext}
-- The key is SERVER-GENERATED. The original filename is data (stored in this
-- table), never part of a path. The CHECK on storage_path pins every version
-- object under its own document's prefix, so even an editor who can insert
-- version rows cannot point them at another document's bytes.
-- ============================================================================

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]'),
  description     text not null default '' check (char_length(description) <= 2000),
  category        text not null default 'general'
                  check (char_length(category) between 1 and 40 and category = lower(category) and category !~ '[[:cntrl:]]'),
  folder_id       uuid references public.folders (id) on delete set null,
  status          text not null default 'active'
                  check (status in ('active', 'deleted')),
  current_version integer check (current_version is null or current_version >= 1),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index documents_owner_idx on public.documents (owner_id);
create index documents_folder_idx on public.documents (folder_id);
create index documents_category_idx on public.documents (category);
create index documents_created_at_idx on public.documents (created_at desc);

create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.tv_touch_updated_at();

-- ---------------------------------------------------------------------------
create table public.document_versions (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references public.documents (id) on delete cascade,
  version_no        integer not null check (version_no >= 1),
  original_filename text not null
                    check (char_length(original_filename) between 1 and 255
                           and original_filename !~ '[[:cntrl:]]'
                           and original_filename !~ '/'),
  storage_path      text not null unique,
  mime_type         text not null check (char_length(mime_type) between 3 and 120),
  extension         text not null check (extension ~ '^[a-z0-9]{1,10}$'),
  size_bytes        bigint not null check (size_bytes > 0),
  content_hash      text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  uploaded_by       uuid not null references public.profiles (id),
  created_at        timestamptz not null default now(),
  unique (document_id, version_no),
  -- A version's object must live under its own document's prefix. Stops a
  -- hostile editor from inserting a version row that streams someone else's
  -- object.
  check (storage_path like document_id::text || '/%')
);

create index document_versions_document_idx on public.document_versions (document_id, version_no desc);
