-- ============================================================================
-- 0006_support_tables.sql
-- rate_limits: in-database fixed-window rate limiter (login, signup, failed
--   access). One table, evaluated inside a SECURITY DEFINER function under a
--   row lock, so it is correct under concurrency and needs no extra service.
-- access_suggestions: the AI-assist surface. A suggestion NEVER grants
--   anything; the owner confirms, and both the suggestion and the decision go
--   into the audit chain.
-- ============================================================================

create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null check (count >= 0)
);

create table public.access_suggestions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  suggested_email text not null check (suggested_email = lower(suggested_email)),
  reason          text not null check (char_length(reason) <= 300),
  score           numeric(4,3) not null check (score between 0 and 1),
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined')),
  decided_by      uuid references public.profiles (id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (document_id, suggested_email)
);

create index access_suggestions_document_idx on public.access_suggestions (document_id);

alter table public.access_suggestions enable row level security;

create policy "suggestions_owner_only"
  on public.access_suggestions for all
  to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = access_suggestions.document_id and d.owner_id = auth.uid()
    )
  )
  with check (
    tv_is_active_user()
    and exists (
      select 1 from public.documents d
      where d.id = access_suggestions.document_id and d.owner_id = auth.uid()
    )
  );
