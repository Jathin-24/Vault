-- ============================================================================
-- 0011_fix_tv_log_event_bootstrap.sql
-- Fix discovered on the FIRST REAL RUN against a live database (the schema
-- had only ever been executed in review until then): on a completely empty
-- audit chain, `select ... into v_prev` returns no rows and PL/pgSQL assigns
-- NULL — overwriting the declaration default ''. The first tv_log_event call
-- then tried to insert prev_hash = NULL and hit the NOT NULL constraint
-- (reproducible: fresh database → first audited event).
--
-- This migration re-points tv_log_event with the corrected body for databases
-- that already recorded 0007 as applied. Fresh clones get the same fixed
-- body directly from 0007; the two bodies are kept identical on purpose.
-- ============================================================================

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

  -- Same fix as 0007: an empty chain means SELECT INTO yields NULL.
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
