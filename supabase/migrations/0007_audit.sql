-- ============================================================================
-- 0007_audit.sql
-- The audit trail. This is the evidence, so its protection is structural:
--
-- 1. APPEND-ONLY. A trigger raises on any UPDATE or DELETE, for every role,
--    including service_role. Direct INSERT is not granted to API roles;
--    rows only enter through tv_log_event() (SECURITY DEFINER).
-- 2. HASH CHAIN. Each event stores prev_hash (the previous row's event_hash)
--    and event_hash = sha256(prev_hash || canonical(event)), computed under an
--    advisory lock so concurrent inserts cannot fork the chain. Deleting,
--    reordering or editing a row breaks verification at that point.
-- 3. METADATA DIGEST. metadata_sha256 is stored alongside; a naive edit of
--    metadata is caught even before chain recomputation.
-- 4. DENIALS ARE EVIDENCE TOO. access_denied / login_failed events record who
--    was refused, where, and from which IP.
--
-- Accepted risk (documented in THREATS.md): a PostgreSQL superuser/DB owner
-- could DROP the immutability trigger. Prevention is impossible at that level;
-- detection (chain verification, run in-app and by scripts/verify-audit-chain.mjs)
-- is the answer.
-- ============================================================================

create table public.audit_events (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null,
  actor_user_id    uuid,
  actor_email      text,
  actor_role       text not null check (actor_role in ('user', 'admin', 'system')),
  event_type       text not null check (char_length(event_type) between 1 and 80),
  document_id      uuid,          -- no FK on purpose: audit outlives purged documents
  target_email     text,
  route            text,
  outcome          text not null default 'success'
                   check (outcome in ('success', 'denied', 'error')),
  ip               text,
  user_agent       text,
  metadata         jsonb not null default '{}'::jsonb,
  metadata_sha256  text not null check (metadata_sha256 ~ '^[0-9a-f]{64}$'),
  prev_hash        text not null,
  event_hash       text not null check (event_hash ~ '^[0-9a-f]{64}$')
);

create index audit_events_document_idx on public.audit_events (document_id, id desc);
create index audit_events_actor_idx on public.audit_events (actor_user_id, id desc);
create index audit_events_type_idx on public.audit_events (event_type, id desc);
create index audit_events_created_idx on public.audit_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Canonical serialisation. Implemented here in SQL and re-implemented
-- independently in scripts/verify-audit-chain.mjs — two implementations that
-- must agree, so a tampered DB function cannot silently "verify" itself.
-- ---------------------------------------------------------------------------
create or replace function public.tv_event_canonical(
  p_id               bigint,
  p_created_at       timestamptz,
  p_actor_user_id    uuid,
  p_actor_email      text,
  p_actor_role       text,
  p_event_type       text,
  p_document_id      uuid,
  p_target_email     text,
  p_route            text,
  p_outcome          text,
  p_ip               text,
  p_user_agent       text,
  p_metadata_sha256  text
)
returns text
language sql
immutable
as $$
  select array_to_string(array[
    p_id::text,
    -- epoch milliseconds (UTC), truncated — identical in the Node verifier
    floor(extract(epoch from p_created_at) * 1000)::bigint::text,
    coalesce(p_actor_user_id::text, ''),
    coalesce(p_actor_email, ''),
    p_actor_role,
    p_event_type,
    coalesce(p_document_id::text, ''),
    coalesce(p_target_email, ''),
    coalesce(p_route, ''),
    p_outcome,
    coalesce(p_ip, ''),
    coalesce(p_user_agent, ''),
    p_metadata_sha256
  ], '|');
$$;

-- ---------------------------------------------------------------------------
-- tv_log_event: the ONLY way rows enter the audit trail.
-- Actor identity is derived from auth.uid() inside the function — callers
-- cannot impersonate anyone. Callable by service_role only: if authenticated
-- users could call it, they could forge "someone downloaded a document"
-- events (noise at best, framing at worst). Denials caused by direct
-- PostgREST probing are recorded by tv_authorize_document_access instead.
-- ---------------------------------------------------------------------------
create or replace function public.tv_log_event(
  p_event_type    text,
  p_document_id   uuid    default null,
  p_target_email  text    default null,
  p_route         text    default null,
  p_outcome       text    default 'success',
  p_metadata      jsonb   default '{}'::jsonb,
  p_ip            text    default null,
  p_user_agent    text    default null,
  p_actor_user_id uuid    default null   -- server-side only: session uid verified by the route
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid    := coalesce(auth.uid(), p_actor_user_id);
  v_email     text;
  v_role      text    := 'system';
  v_prev      text;
  v_row_id    bigint;
  v_created   timestamptz;
  v_meta_text text;
  v_meta_sha  text;
  v_canon     text;
  v_hash      text;
begin
  if v_uid is not null then
    select email, case when platform_role = 'admin' then 'admin' else 'user' end
      into v_email, v_role
      from public.profiles where id = v_uid;
  end if;

  v_created   := clock_timestamp();
  v_meta_text := coalesce(p_metadata::text, '{}');
  v_meta_sha  := encode(sha256(convert_to(v_meta_text, 'UTF8')), 'hex');

  -- Serialise chain appends; released at commit/rollback.
  perform pg_advisory_xact_lock(7272726);

  -- NOTE: SELECT INTO on an EMPTY table assigns NULL (it overwrites the
  -- declaration default), and the very first audited event ever written sees
  -- an empty chain — so coalesce again here or prev_hash violates NOT NULL.
  select coalesce(event_hash, '')
    into v_prev
    from public.audit_events
    order by id desc
    limit 1;
  v_prev := coalesce(v_prev, '');

  v_row_id := nextval('public.audit_events_id_seq');

  v_canon := public.tv_event_canonical(
    v_row_id, v_created, v_uid, v_email, v_role, p_event_type,
    p_document_id, p_target_email, p_route, p_outcome,
    p_ip, p_user_agent, v_meta_sha
  );
  v_hash := encode(sha256(convert_to(v_prev || v_canon, 'UTF8')), 'hex');

  insert into public.audit_events (
    id, created_at, actor_user_id, actor_email, actor_role, event_type,
    document_id, target_email, route, outcome, ip, user_agent,
    metadata, metadata_sha256, prev_hash, event_hash
  )
  overriding system value
  values (
    v_row_id, v_created, v_uid, v_email, v_role, p_event_type,
    p_document_id, p_target_email, p_route, p_outcome, p_ip, p_user_agent,
    coalesce(p_metadata, '{}'::jsonb), v_meta_sha, v_prev, v_hash
  );

  return v_row_id;
end;
$$;

revoke execute on function public.tv_log_event(text, uuid, text, text, text, jsonb, text, text, uuid)
  from anon, authenticated;
grant execute on function public.tv_log_event(text, uuid, text, text, text, jsonb, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Append-only enforcement. Statement-level: covers every row, every role.
-- ---------------------------------------------------------------------------
create or replace function public.tv_audit_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'TrustVault: audit_events is append-only (% is not permitted)', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_events_no_update_or_delete
  before update or delete on public.audit_events
  for each statement execute function public.tv_audit_events_immutable();

-- ---------------------------------------------------------------------------
-- Structural audit: database-level changes to grants and documents log
-- themselves, even if made straight through the SQL API rather than our app.
-- ---------------------------------------------------------------------------
create or replace function public.tv_audit_grant_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.tv_log_event('grant.create', new.document_id,
      new.grantee_email, null, 'success',
      jsonb_build_object('permission', new.permission, 'grant_id', new.id));
  elsif tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null then
    perform public.tv_log_event('grant.revoke', new.document_id,
      new.grantee_email, null, 'success',
      jsonb_build_object('permission', new.permission, 'grant_id', new.id));
  elsif tg_op = 'UPDATE' and old.permission is distinct from new.permission then
    perform public.tv_log_event('grant.permission_changed', new.document_id,
      new.grantee_email, null, 'success',
      jsonb_build_object('from', old.permission, 'to', new.permission, 'grant_id', new.id));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger grants_audit
  after insert or update on public.document_grants
  for each row execute function public.tv_audit_grant_change();

create or replace function public.tv_audit_document_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.tv_log_event('document.create', new.id, null, null, 'success',
      jsonb_build_object('title', new.title, 'category', new.category));
  elsif tg_op = 'UPDATE' then
    if old.status = 'active' and new.status = 'deleted' then
      perform public.tv_log_event('document.delete', new.id, null, null, 'success',
        jsonb_build_object('title', new.title));
    elsif old.status = 'deleted' and new.status = 'active' then
      perform public.tv_log_event('document.restore', new.id, null, null, 'success',
        jsonb_build_object('title', new.title));
    elsif old.title is distinct from new.title
       or old.category is distinct from new.category
       or old.folder_id is distinct from new.folder_id
       or old.description is distinct from new.description then
      perform public.tv_log_event('document.update', new.id, null, null, 'success',
        jsonb_build_object(
          'title', new.title,
          'from_title', old.title,
          'from_category', old.category,
          'to_category', new.category
        ));
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger documents_audit
  after insert or update on public.documents
  for each row execute function public.tv_audit_document_change();

-- ---------------------------------------------------------------------------
-- RLS: reading the trail is allowed (self, doc owner, admin); writing is not.
-- No insert/update/delete policies for API roles at all.
-- ---------------------------------------------------------------------------
alter table public.audit_events enable row level security;

create policy "audit_select_actor_owner_or_admin"
  on public.audit_events for select
  to authenticated
  using (
    tv_is_admin()
    or actor_user_id = auth.uid()
    or (
      document_id is not null
      and exists (
        select 1 from public.documents d
        where d.id = audit_events.document_id and d.owner_id = auth.uid()
      )
    )
  );

-- Direct reads are allowed (RLS filters), writes are impossible.
revoke all on public.audit_events from anon;
grant select on public.audit_events to authenticated;
