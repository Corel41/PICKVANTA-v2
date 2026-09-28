-- ============================================================================
-- PickVanta — Deal Engine operations (Step 14, migration 0006)
-- ----------------------------------------------------------------------------
-- 0005 established the Deal Engine's records. This adds the one thing the Admin
-- Panel was still missing: a way for an administrator to configure a source.
--
-- What this file adds, and nothing else:
--   • public.deal_source_save(jsonb, uuid) — the only path a browser has into
--     public.deal_sources. Create when the id is null, update when it is not.
--     It is security definer, gated on public.is_admin(), and validates every
--     value itself before it writes.
--   • public.deal_source_validate(jsonb) — the validation, in one place, so the
--     create path and the update path cannot disagree.
--   • public.deal_source_json(public.deal_sources) — the exact column set the
--     panel is allowed to see, so a future column is not published by accident.
--
-- What this file deliberately does not add:
--   • no write policy on public.deal_sources, and no table privilege either.
--     0005 left the table read-only to every client (SELECT-only policy, gated
--     on is_admin()); that stays true. A browser writes through the function
--     above, which the database can validate, or it does not write at all.
--   • no connector, no fetcher, no worker, no schedule, no job execution. Rows
--     in public.deal_engine_jobs are still queued by nothing.
--   • no write path for imported deals, media or the event trail. Those are
--     still written by no client at all; the pipeline that will write them does
--     not exist yet.
--   • no delete. Archiving is the retirement path: a source that is archived
--     keeps its row, because the provenance of what was imported from it has to
--     survive the agreement ending.
--   • no credential store. 0005 refuses a credential-shaped configuration key
--     at the table; this file refuses it again, with the offending key named,
--     and adds a narrow shape check on the configuration's *values* — a token
--     pasted under an innocent key is still a credential. The place for a
--     credential is the server environment.
--
-- Attribution of a source change is not recorded: public.deal_sources has no
-- column for it and this step does not add one. That is a later step's decision
-- to make deliberately, not something to bolt on here.
--
-- Apply after db/migrations/0005_deal_engine_foundation.sql. Re-runnable.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Pre-flight — the objects these functions work with have to be there.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.deal_sources') is null then
    raise exception 'Apply db/migrations/0005_deal_engine_foundation.sql before this file: public.deal_sources is missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.set_updated_at() is missing.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'This project has no auth schema. Apply 0002 on a Supabase project (or the local test double) first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Validation — every rule a source has to satisfy, in one place.
--    Called by deal_source_save() only: EXECUTE is revoked from clients below,
--    so this cannot be used as an oracle from a browser.
-- ---------------------------------------------------------------------------
create or replace function public.deal_source_validate(p_source jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_name     text;
  v_type     text;
  v_provider text;
  v_country  text;
  v_endpoint text;
  v_status   text;
  v_config   jsonb;
  v_offender text;      /* the key or value path that looked like a credential */
begin
  if p_source is null or jsonb_typeof(p_source) <> 'object' then
    raise exception 'A source has to be sent as a JSON object' using errcode = '22023';
  end if;

  -- The name, which is what an operator sees first.
  v_name := btrim(coalesce(p_source->>'name', ''));
  if v_name = '' then
    raise exception 'A source needs a name' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'A source name is limited to 120 characters' using errcode = '22001';
  end if;

  -- The type, from 0005's closed vocabulary.
  v_type := coalesce(p_source->>'source_type', '');
  if v_type not in ('marketplace-feed', 'affiliate-network-feed', 'merchant-api',
                    'merchant-product-feed', 'permitted-url-source') then
    raise exception 'Unknown source type: %', coalesce(nullif(v_type, ''), '(none)')
      using errcode = '22023';
  end if;

  v_provider := btrim(coalesce(p_source->>'provider_name', ''));
  if length(v_provider) > 120 then
    raise exception 'A provider or network name is limited to 120 characters' using errcode = '22001';
  end if;

  -- ISO 3166-1 alpha-2, any country. Empty means "not recorded", which is not
  -- the same as "nowhere" and is allowed.
  v_country := upper(btrim(coalesce(p_source->>'market_country', '')));
  if v_country <> '' and v_country !~ '^[A-Z]{2}$' then
    raise exception 'A market country has to be a two-letter code such as GB, KE or DE'
      using errcode = '22023';
  end if;

  -- The endpoint is a reference an operator may open. Nothing fetches it.
  v_endpoint := btrim(coalesce(p_source->>'endpoint_url', ''));
  if length(v_endpoint) > 400 then
    raise exception 'An endpoint address is limited to 400 characters' using errcode = '22001';
  end if;
  if v_endpoint <> '' and v_endpoint !~* '^https?://[^[:space:]]+$' then
    raise exception 'An endpoint has to be an http(s) address' using errcode = '22023';
  end if;

  -- The lifecycle state, from 0005's closed vocabulary.
  v_status := coalesce(p_source->>'status', '');
  if v_status not in ('active', 'paused', 'disabled', 'archived') then
    raise exception 'Unknown source status: %', coalesce(nullif(v_status, ''), '(none)')
      using errcode = '22023';
  end if;

  -- Configuration: an object, small, and never a credential.
  if p_source ? 'config' and jsonb_typeof(p_source->'config') <> 'object' then
    raise exception 'Configuration has to be a JSON object' using errcode = '22023';
  end if;
  v_config := coalesce(p_source->'config', '{}'::jsonb);
  if length(v_config::text) > 2000 then
    raise exception 'Configuration is limited to 2000 characters' using errcode = '22001';
  end if;

  /* Credential-shaped keys, at any depth: the same pattern 0005's constraint
     refuses, checked here too so the operator is told which key is the problem
     instead of being shown a constraint name. */
  if v_config::text ~* '"[a-z0-9_-]*(secret|token|password|passwd|credential|credentials|api[_-]?key|apikey|bearer|private[_-]?key|client[_-]?secret|access[_-]?key)[a-z0-9_-]*"[[:space:]]*:' then
    select k into v_offender
      from jsonb_object_keys(v_config) as k
     where k ~* '^[a-z0-9_-]*(secret|token|password|passwd|credential|credentials|api[_-]?key|apikey|bearer|private[_-]?key|client[_-]?secret|access[_-]?key)[a-z0-9_-]*$'
     limit 1;
    raise exception 'Configuration looks like it holds a credential (%). Credentials belong in the server environment, never in a source row',
      coalesce(v_offender, 'nested key')
      using errcode = '22023';
  end if;

  /* A key can look innocent and its *value* still be a credential: a token
     pasted into "note", a connection string in "url", a private key in "pem".
     A shape check on the values is a heuristic, and it is deliberately narrow:
     it refuses the forms a credential actually takes, and it does not try to
     guess at a random-looking string. */
  select w.path into v_offender
    from (
      with recursive walk(node, path) as (
        select v_config, '$'::text
        union all
        select child.value, walk.path || child.key
          from walk
          join lateral (
            select c.key, c.value
              from jsonb_each(walk.node) as c(key, value)
             where jsonb_typeof(walk.node) = 'object'
            union all
            select '[' || (e.ordinality - 1)::text || ']', e.value
              from jsonb_array_elements(walk.node) with ordinality as e(value, ordinality)
             where jsonb_typeof(walk.node) = 'array'
          ) as child on true
      )
      select node, path from walk
    ) as w
   where jsonb_typeof(w.node) = 'string'
     and (
       (w.node #>> '{}') ~* '(^|[^a-z0-9])(password|passwd|secret|token|api[_-]?key|apikey|client[_-]?secret|private[_-]?key|access[_-]?key)[[:space:]]*[:=][[:space:]]*[^[:space:]]'
       or (w.node #>> '{}') ~* '^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}$'
       or (w.node #>> '{}') ~* '^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.'
       or (w.node #>> '{}') ~* '^-----begin [a-z ]*private key-----'
       or (w.node #>> '{}') ~* '^bearer[[:space:]]+\S+$'
       or (w.node #>> '{}') ~* '^[a-z][a-z0-9+.-]*://[^/[:space:]:]+:[^/@[:space:]]+@'
     )
   limit 1;
  if v_offender is not null then
    raise exception 'Configuration looks like it holds a credential in its value at %. Credentials belong in the server environment, never in a source row',
      v_offender
      using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The column set the panel may see. Kept in one place so that a column added
--    to the table later is not published to a browser by default.
-- ---------------------------------------------------------------------------
create or replace function public.deal_source_json(src public.deal_sources)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id',             src.id,
    'name',           src.name,
    'source_type',    src.source_type,
    'provider_name',  src.provider_name,
    'market_country', src.market_country,
    'endpoint_url',   src.endpoint_url,
    'status',         src.status,
    'config',         src.config,
    'created_at',     src.created_at,
    'updated_at',     src.updated_at
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. The write itself. One function, so there is exactly one place where a
--    source can be written and exactly one set of rules it has to satisfy.
-- ---------------------------------------------------------------------------
create or replace function public.deal_source_save(
  p_source jsonb,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.deal_sources;
begin
  /* The database decides who is an administrator. Nothing the browser sends —
     a token, a URL, a hidden field — is consulted, and a refusal says only
     that the caller is not an administrator. */
  if not public.is_admin() then
    raise exception 'Only an administrator can configure a Deal Engine source'
      using errcode = '42501';
  end if;

  perform public.deal_source_validate(p_source);

  if p_id is null then
    insert into public.deal_sources
      (name, source_type, provider_name, market_country, endpoint_url, status, config)
    values (
      btrim(p_source->>'name'),
      p_source->>'source_type',
      btrim(coalesce(p_source->>'provider_name', '')),
      upper(btrim(coalesce(p_source->>'market_country', ''))),
      btrim(coalesce(p_source->>'endpoint_url', '')),
      p_source->>'status',
      coalesce(p_source->'config', '{}'::jsonb)
    )
    returning * into saved;
  else
    /* updated_at moves through 0005's trigger, not from anything the caller
       sends. created_at is never touched, and the id is never taken from the
       payload — only from the argument. */
    update public.deal_sources
       set name           = btrim(p_source->>'name'),
           source_type    = p_source->>'source_type',
           provider_name  = btrim(coalesce(p_source->>'provider_name', '')),
           market_country = upper(btrim(coalesce(p_source->>'market_country', ''))),
           endpoint_url   = btrim(coalesce(p_source->>'endpoint_url', '')),
           status         = p_source->>'status',
           config         = coalesce(p_source->'config', '{}'::jsonb)
     where id = p_id
    returning * into saved;

    if saved.id is null then
      raise exception 'No Deal Engine source with that id' using errcode = 'P0002';
    end if;
  end if;

  /* What comes back is the row the database holds, not what was asked for. */
  return public.deal_source_json(saved);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges. A client may call the save function and nothing else: the two
--    helpers are internal, and the table itself stays read-only.
-- ---------------------------------------------------------------------------
revoke all on function public.deal_source_validate(jsonb) from public, anon, authenticated;
revoke all on function public.deal_source_json(public.deal_sources) from public, anon, authenticated;
revoke all on function public.deal_source_save(jsonb, uuid) from public, anon;
grant execute on function public.deal_source_save(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-check. A migration that claims to have closed a door should prove it.
-- ---------------------------------------------------------------------------
do $$
declare
  problems text := '';
  fn       record;
  v_count  integer;
begin
  /* The save path is security definer with a pinned search path. */
  for fn in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'deal_source_save'
  loop
    if not fn.prosecdef then
      problems := problems || 'deal_source_save must be security definer; ';
    end if;
    if fn.proconfig is null
       or not (array_to_string(fn.proconfig, ',') like '%search_path=public%') then
      problems := problems || 'deal_source_save must pin search_path; ';
    end if;
  end loop;

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'deal_source_save';
  if v_count <> 1 then
    problems := problems || 'deal_source_save is missing or duplicated; ';
  end if;

  /* A client may execute the save function — and only that one. */
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'deal_source_save'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) is not true then
    problems := problems || 'authenticated cannot execute deal_source_save; ';
  end if;

  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('deal_source_validate', 'deal_source_json')
       and grantee in ('anon', 'authenticated', 'PUBLIC')
       and privilege_type = 'EXECUTE'
  ) then
    problems := problems || 'a validation helper is executable by a client; ';
  end if;

  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'deal_source_save'
       and grantee in ('anon', 'PUBLIC') and privilege_type = 'EXECUTE'
  ) then
    problems := problems || 'anon can execute deal_source_save; ';
  end if;

  /* The table is still read-only for every client, and so are the records the
     future pipeline writes. If a write policy ever appears here, the function
     above stops being the only way in and this migration has failed its point. */
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('deal_sources', 'imported_deals', 'imported_deal_media',
                         'deal_engine_events', 'deal_engine_jobs', 'external_merchants')
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    problems := problems || 'a client write policy exists on a Deal Engine table; ';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('deal_sources', 'imported_deals', 'imported_deal_media',
                          'deal_engine_events', 'deal_engine_jobs', 'external_merchants')
       and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    problems := problems || 'a client holds a write privilege on a Deal Engine table; ';
  end if;

  if problems <> '' then
    raise exception 'Deal Engine operations failed its own check: %', problems;
  end if;

  raise notice 'deal engine operations: administrative source management verified.';
end $$;


-- ---------------------------------------------------------------------------
-- Migration order for Step 14
--   0001_catalogue.sql
--   0002_auth_profiles.sql
--   0003_seller_provider_profiles.sql
--   0004_admin_dashboard.sql
--   0005_deal_engine_foundation.sql
--   0006_deal_engine_operations.sql   ← this file
--   then the seed.
-- ---------------------------------------------------------------------------
