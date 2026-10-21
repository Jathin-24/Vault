-- ============================================================================
-- 0009_rpc_actions.sql
-- SECURITY DEFINER action functions. Each one re-checks its precondition
-- internally (never trusts the caller's route), derives the actor from
-- auth.uid(), and logs to the audit chain where the action matters.
--
-- Privilege notes:
--   * Postgres grants EXECUTE to PUBLIC by default, so every function here is
--     explicitly revoked from PUBLIC/anon and granted only to the roles that
--     need it.
--   * tv_authorize_document_access is callable by authenticated users. That is
--     deliberate: if someone probes documents directly through PostgREST
--     instead of our app, the refusal is still recorded as evidence.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The content-access decision + audit. API routes call this before streaming
-- a single byte; a revocation that happened one millisecond ago is honoured.
-- ---------------------------------------------------------------------------
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
                g.grantee_email = lower(coalesce(auth.jwt()->>'email', ''))
                and coalesce(auth.jwt()->>'email_verified', 'false') = 'true'
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

revoke execute on function public.tv_authorize_document_access(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.tv_authorize_document_access(uuid, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Break-glass: the ONLY way an administrator reaches document content.
-- Always audited as admin_override. Returns metadata, not bytes — the route
-- then streams via the service role.
-- ---------------------------------------------------------------------------
create or replace function public.tv_admin_read_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_owner_email text;
begin
  if not tv_is_admin() then
    raise exception 'TrustVault: admin only' using errcode = '42501';
  end if;

  select d.title, p.email into v_title, v_owner_email
    from public.documents d
    join public.profiles p on p.id = d.owner_id
    where d.id = p_document_id;

  if not found then
    raise exception 'TrustVault: document not found' using errcode = 'P0002';
  end if;

  perform public.tv_log_event(
    'admin_override', p_document_id, null, '/admin',
    'success',
    jsonb_build_object('action', 'read_content', 'title', v_title, 'owner', v_owner_email)
  );

  return jsonb_build_object('allowed', true, 'title', v_title);
end;
$$;

revoke execute on function public.tv_admin_read_document(uuid) from public, anon;
grant execute on function public.tv_admin_read_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiter: fixed window per key, row-locked. Used for login, signup and
-- repeated denied access (so probing is slowed AND its noise is bounded).
-- ---------------------------------------------------------------------------
create or replace function public.tv_rate_limit_take(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.rate_limits%rowtype;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update set
    count = case
      when public.rate_limits.window_start + make_interval(secs => p_window_seconds) <= v_now
        then 1
      else public.rate_limits.count + 1
    end,
    window_start = case
      when public.rate_limits.window_start + make_interval(secs => p_window_seconds) <= v_now
        then v_now
      else public.rate_limits.window_start
    end
  returning * into v_row;

  return v_row.count <= p_max;
end;
$$;

revoke execute on function public.tv_rate_limit_take(text, integer, integer)
  from public, anon;
grant execute on function public.tv_rate_limit_take(text, integer, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- AI assist: suggest colleagues who maybe SHOULD see this document.
-- Heuristic + explainable (reason text is stored and shown). READ-ONLY over
-- existing grants: it can never widen access. The owner confirms; both the
-- suggestion and the decision are audited.
-- ---------------------------------------------------------------------------
create or replace function public.tv_suggest_viewers(p_document_id uuid)
returns table (
  suggested_email text,
  full_name       text,
  reason          text,
  score           numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.owner_id = auth.uid()
  ) then
    raise exception 'TrustVault: only the document owner sees suggestions'
      using errcode = '42501';
  end if;

  return query
  with base as (
    select
      p.email,
      p.full_name,
      (
        select count(*)
        from public.document_grants g
        join public.documents d2 on d2.id = g.document_id
        where g.grantee_email = p.email
          and g.revoked_at is null
          and d2.owner_id = tv_document_owner(p_document_id)
      ) as prior_grants,
      (
        select count(*)
        from public.document_versions v
        join public.documents d3 on d3.id = v.document_id
        where v.uploaded_by = p.id
          and d3.owner_id = tv_document_owner(p_document_id)
      ) as prior_uploads
    from public.profiles p
    where p.is_active
      and p.id <> tv_document_owner(p_document_id)
      and p.email <> tv_actor_email()
      and not exists (
        select 1 from public.document_grants g
        where g.document_id = p_document_id
          and g.revoked_at is null
          and g.grantee_email = p.email
      )
  )
  select
    b.email::text,
    b.full_name::text,
    case
      when b.prior_uploads > 0
        then format('Has uploaded %s version(s) of your other documents', b.prior_uploads)
      when b.prior_grants > 0
        then format('Already has access to %s of your documents', b.prior_grants)
      else null
    end::text as reason,
    least(0.95, 0.30 + b.prior_grants * 0.10 + b.prior_uploads * 0.15)::numeric as score
  from base b
  where b.prior_grants > 0 or b.prior_uploads > 0
  order by score desc, email
  limit 5;
end;
$$;

revoke execute on function public.tv_suggest_viewers(uuid) from public, anon;
grant execute on function public.tv_suggest_viewers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Record an owner's decision about a suggestion (accepted/declined).
-- The grant itself is a separate, RLS-checked insert; this only records.
-- ---------------------------------------------------------------------------
create or replace function public.tv_decide_suggestion(
  p_suggestion_id uuid,
  p_decision      text            -- 'accepted' | 'declined'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.access_suggestions%rowtype;
begin
  if p_decision not in ('accepted', 'declined') then
    raise exception 'TrustVault: unknown decision';
  end if;

  select * into v_s from public.access_suggestions where id = p_suggestion_id;

  if not found or not exists (
    select 1 from public.documents d
    where d.id = v_s.document_id and d.owner_id = auth.uid()
  ) then
    raise exception 'TrustVault: suggestion not found' using errcode = 'P0002';
  end if;

  update public.access_suggestions
    set status = p_decision, decided_by = auth.uid(), decided_at = now()
    where id = p_suggestion_id;

  perform public.tv_log_event(
    'suggestion.' || p_decision,
    v_s.document_id,
    v_s.suggested_email,
    null, 'success',
    jsonb_build_object('suggestion_id', v_s.id, 'reason', v_s.reason, 'score', v_s.score)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.tv_decide_suggestion(uuid, text) from public, anon;
grant execute on function public.tv_decide_suggestion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Self profile update (name only — role/active flags need admin RPCs).
-- ---------------------------------------------------------------------------
create or replace function public.tv_update_my_profile(p_full_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or char_length(coalesce(p_full_name, '')) > 120 then
    raise exception 'TrustVault: invalid input' using errcode = '22023';
  end if;
  update public.profiles set full_name = p_full_name where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.tv_update_my_profile(text) from public, anon;
grant execute on function public.tv_update_my_profile(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: role/activation management. Admin-only inside, audited.
-- Deactivating a leaver takes effect on their next request: every access
-- decision checks profiles.is_active.
-- ---------------------------------------------------------------------------
create or replace function public.tv_set_platform_role(p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not tv_is_admin() then
    raise exception 'TrustVault: admin only' using errcode = '42501';
  end if;
  if p_role not in ('user', 'admin') then
    raise exception 'TrustVault: unknown role';
  end if;

  select email into v_email from public.profiles where id = p_user_id;
  if not found then
    raise exception 'TrustVault: user not found' using errcode = 'P0002';
  end if;

  update public.profiles set platform_role = p_role where id = p_user_id;

  perform public.tv_log_event('admin.role_changed', null, v_email, '/admin',
    'success', jsonb_build_object('role', p_role, 'user_id', p_user_id));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.tv_set_user_active(p_user_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not tv_is_admin() then
    raise exception 'TrustVault: admin only' using errcode = '42501';
  end if;

  select email into v_email from public.profiles where id = p_user_id;
  if not found then
    raise exception 'TrustVault: user not found' using errcode = 'P0002';
  end if;

  update public.profiles set is_active = p_active where id = p_user_id;

  perform public.tv_log_event(
    case when p_active then 'admin.user_activated' else 'admin.user_deactivated' end,
    null, v_email, '/admin', 'success',
    jsonb_build_object('user_id', p_user_id));
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.tv_set_platform_role(uuid, text) from public, anon;
revoke execute on function public.tv_set_user_active(uuid, boolean) from public, anon;
grant execute on function public.tv_set_platform_role(uuid, text) to authenticated;
grant execute on function public.tv_set_user_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Retention: purge a SOFT-DELETED document (owner or admin). Logs a snapshot
-- first so the trail keeps what was destroyed.
-- ---------------------------------------------------------------------------
create or replace function public.tv_purge_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents%rowtype;
  v_versions jsonb;
begin
  select * into v_doc from public.documents where id = p_document_id for update;

  if not found then
    raise exception 'TrustVault: document not found' using errcode = 'P0002';
  end if;

  if not (v_doc.owner_id = auth.uid() or tv_is_admin()) then
    raise exception 'TrustVault: not permitted' using errcode = '42501';
  end if;

  if v_doc.status <> 'deleted' then
    raise exception 'TrustVault: only soft-deleted documents can be purged';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'version_no', version_no,
      'content_hash', content_hash,
      'original_filename', original_filename,
      'size_bytes', size_bytes
    ) order by version_no), '[]'::jsonb)
    into v_versions
    from public.document_versions where document_id = p_document_id;

  perform public.tv_log_event('document.purge', p_document_id, null, null,
    'success',
    jsonb_build_object('title', v_doc.title, 'versions', v_versions));

  delete from public.documents where id = p_document_id;  -- cascades versions, grants
  return jsonb_build_object('ok', true, 'versions_removed', jsonb_array_length(v_versions));
end;
$$;

revoke execute on function public.tv_purge_document(uuid) from public, anon;
grant execute on function public.tv_purge_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Chain verification (admin). Recomputes every hash; also checks each row's
-- metadata digest against its metadata. First inconsistency wins.
-- scripts/verify-audit-chain.mjs re-implements this independently in Node.
-- ---------------------------------------------------------------------------
create or replace function public.tv_verify_audit_chain()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text := '';
  v_cur public.audit_events%rowtype;
  v_sha text;
  v_canon text;
  v_hash text;
  v_count bigint := 0;
begin
  if not tv_is_admin() then
    raise exception 'TrustVault: admin only' using errcode = '42501';
  end if;

  for v_cur in select * from public.audit_events order by id loop
    v_sha := encode(sha256(convert_to(coalesce(v_cur.metadata::text, '{}'), 'UTF8')), 'hex');
    if v_sha <> v_cur.metadata_sha256 then
      return jsonb_build_object('ok', false, 'broken_at', v_cur.id,
        'reason', 'metadata_digest_mismatch', 'checked', v_count);
    end if;

    v_canon := public.tv_event_canonical(
      v_cur.id, v_cur.created_at, v_cur.actor_user_id, v_cur.actor_email,
      v_cur.actor_role, v_cur.event_type, v_cur.document_id, v_cur.target_email,
      v_cur.route, v_cur.outcome, v_cur.ip, v_cur.user_agent, v_cur.metadata_sha256);
    v_hash := encode(sha256(convert_to(v_prev || v_canon, 'UTF8')), 'hex');

    if v_cur.prev_hash <> v_prev then
      return jsonb_build_object('ok', false, 'broken_at', v_cur.id,
        'reason', 'prev_hash_mismatch', 'checked', v_count);
    end if;
    if v_hash <> v_cur.event_hash then
      return jsonb_build_object('ok', false, 'broken_at', v_cur.id,
        'reason', 'event_hash_mismatch', 'checked', v_count);
    end if;

    v_prev := v_cur.event_hash;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'events', v_count, 'head', v_prev);
end;
$$;

revoke execute on function public.tv_verify_audit_chain() from public, anon;
grant execute on function public.tv_verify_audit_chain() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: anomaly feed derived from the audit trail (what is worth noticing).
-- ---------------------------------------------------------------------------
create or replace function public.tv_admin_anomalies()
returns table (
  kind        text,
  subject     text,
  event_count bigint,
  last_at     timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not tv_is_admin() then
    raise exception 'TrustVault: admin only' using errcode = '42501';
  end if;

  return query
  with recent as (
    select * from public.audit_events
    where created_at > now() - interval '24 hours'
  )
  select 'denied_storm'::text,
         coalesce(r.actor_email, r.actor_user_id::text, 'anonymous'),
         count(*), max(r.created_at)
    from recent r
   where r.event_type = 'access_denied'
   group by 1, 2
  having count(*) >= 5
  union all
  select 'login_failures',
         r.target_email,
         count(*), max(r.created_at)
    from recent r
   where r.event_type = 'auth.login_failed'
   group by 1, 2
  having count(*) >= 5
  union all
  select 'mass_download',
         coalesce(r.actor_email, r.actor_user_id::text, 'anonymous'),
         count(*), max(r.created_at)
    from recent r
   where r.event_type = 'document.read'
   group by 1, 2
  having count(*) >= 20
  union all
  select 'grant_spam',
         coalesce(r.actor_email, r.actor_user_id::text, 'anonymous'),
         count(*), max(r.created_at)
    from recent r
   where r.event_type = 'grant.create'
   group by 1, 2
  having count(*) >= 10
  union all
  select 'admin_override',
         coalesce(r.actor_email, r.actor_user_id::text, 'anonymous'),
         count(*), max(r.created_at)
    from recent r
   where r.event_type = 'admin_override'
   group by 1, 2;
end;
$$;

revoke execute on function public.tv_admin_anomalies() from public, anon;
grant execute on function public.tv_admin_anomalies() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: console summary numbers.
-- ---------------------------------------------------------------------------
create or replace function public.tv_admin_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not tv_is_admin() then
    raise exception 'TrustVault: admin only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'active_users', (select count(*) from public.profiles where is_active),
    'documents_active', (select count(*) from public.documents where status = 'active'),
    'documents_deleted', (select count(*) from public.documents where status = 'deleted'),
    'grants_active', (select count(*) from public.document_grants where revoked_at is null),
    'grants_revoked', (select count(*) from public.document_grants where revoked_at is not null),
    'events_total', (select count(*) from public.audit_events),
    'events_24h', (select count(*) from public.audit_events where created_at > now() - interval '24 hours'),
    'denied_24h', (select count(*) from public.audit_events where created_at > now() - interval '24 hours' and outcome = 'denied')
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.tv_admin_summary() from public, anon;
grant execute on function public.tv_admin_summary() to authenticated;
