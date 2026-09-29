-- ============================================================================
-- 0014_user_preferences.sql — Backlog #5: a user's country & currency.
-- ----------------------------------------------------------------------------
-- PickVanta is meant to be global, not one country. Until now the only
-- country/currency knowledge in the database belonged to records and sources:
-- a listing's currency (0001/0005), a source's market country (0008). The
-- signed-in person had no way to say where they are or which currency they
-- prefer to see, and the interface fell back to its built-in defaults
-- (domain.js: DEFAULT_COUNTRY / DEFAULT_CURRENCY) for every visitor alike.
--
-- This migration adds two preference columns to public.profiles — the table
-- that already is "one row per authenticated user" (0002) — and nothing else:
--
--   country    text not null default ''   '' = not set; otherwise ISO 3166-1
--                                         alpha-2 (the same two-letter shape
--                                         a source's market_country uses)
--   currency   text not null default ''   '' = not set; otherwise ISO 4217
--                                         alpha-3 (the same shape every price
--                                         currency in the schema uses)
--
-- Deliberate decisions, so nobody has to guess them later:
--
--   • The default is '' — "not set" — not a country code. A new account
--     receives its profile from the existing on_auth_user_created trigger
--     (0002), which is unchanged; the columns' own defaults fill themselves
--     in. No country is baked in as a permanent assumption: until the person
--     chooses, the interface keeps using its existing presentation fallback.
--
--   • A preference is a presentation fallback, never a conversion. No amount
--     is ever exchanged or restated: a price that states its own currency
--     keeps it, and the preference answers only "which currency does the
--     interface use when a price states none". Country and currency stay
--     separate facts: where a user lives says nothing about which currency a
--     merchant's price was recorded in.
--
--   • The write boundary is the column grant, exactly as 0002 did for
--     display_name: profiles_update_own (0002) already limits every UPDATE to
--     the caller's own row; this file grants UPDATE on exactly the two new
--     columns and on nothing else. role, id, email and the timestamps stay
--     unwritable by any browser role, and the profiles_guard_role trigger
--     (0002) keeps guarding them.
--
-- No historical migration is modified. Re-runnable: every statement is
-- guarded or idempotent.
--
-- Apply after db/migrations/0013_import_pipeline_stages.sql.
-- Rollback:
--   revoke update (country, currency) on public.profiles from authenticated;
--   alter table public.profiles drop column currency, drop column country;
-- ============================================================================

-- ---------------------------------------------------------------- pre-checks ---
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.profiles is missing.';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_own') then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: the profiles_update_own policy is missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The two preference columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists country text not null default '';
alter table public.profiles add column if not exists currency text not null default '';

-- The shapes are the code shapes the rest of the schema already uses, and
-- nothing more: '' (not set) or an upper-case code. No lookup table lives in
-- the database — a code that is well-formed but unknown (say 'XQ') is a
-- preference the interface can simply not special-case, not a corruption.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_country_code') then
    alter table public.profiles
      add constraint profiles_country_code
      check (country = '' or country ~ '^[A-Z]{2}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_currency_code') then
    alter table public.profiles
      add constraint profiles_currency_code
      check (currency = '' or currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.profiles.country is
  'The user''s country preference: '''' when not set, otherwise an ISO 3166-1 alpha-2 code. A presentation preference only — it never changes where a record comes from.';
comment on column public.profiles.currency is
  'The user''s preferred display currency: '''' when not set, otherwise an ISO 4217 alpha-3 code. A fallback for prices that state no currency — never a conversion, and never a relabelling of a price that states its own.';

-- ---------------------------------------------------------------------------
-- 2. The write boundary — two columns, own row, no more
-- ---------------------------------------------------------------------------
-- 0002 granted update on display_name only. This adds exactly the two new
-- columns to that grant. RLS (profiles_update_own) still limits every UPDATE
-- to the caller's own row, and every other column stays un-granted.
grant update (country, currency) on public.profiles to authenticated;

-- The server key gets the same narrow, explicit treatment the pipeline
-- functions received in 0012/0013: a hosted Supabase project already grants
-- the service role the table's default privileges, so this changes nothing
-- there — it makes the boundary deterministic in every environment instead of
-- depending on a project's default-privilege settings.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.profiles to service_role;
    grant update (country, currency) on public.profiles to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Self-check — the migration refuses to have applied half of itself
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'profiles' and rowsecurity
  ) then
    raise exception 'profiles must still have row level security enabled.';
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'country', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'currency', 'update') then
    raise exception 'authenticated must be able to update its own country and currency preference.';
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update') then
    raise exception 'the existing display_name update grant must be preserved.';
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'role', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'email', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'id', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'update') then
    raise exception 'authenticated must not gain update rights on any column beyond display_name, country and currency.';
  end if;

  if has_table_privilege('anon', 'public.profiles', 'select')
     or has_table_privilege('anon', 'public.profiles', 'insert')
     or has_table_privilege('anon', 'public.profiles', 'update')
     or has_table_privilege('anon', 'public.profiles', 'delete') then
    raise exception 'anon must have no privileges on profiles.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
      and (roles = '{public}' or 'anon' = any (roles))
  ) then
    raise exception 'profiles must not become readable by anon or public.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_country_code'
      and pg_get_constraintdef(oid) like '%^[A-Z]{2}$%'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_currency_code'
      and pg_get_constraintdef(oid) like '%^[A-Z]{3}$%'
  ) then
    raise exception 'the country/currency code checks are not the expected ones.';
  end if;

  /* column_default renders as ''::text on modern PostgreSQL; normalize the
     quoting away and require what remains to be the empty string. */
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('country', 'currency')
      and replace(replace(coalesce(column_default, ''), '''', ''), '::text', '') <> ''
  ) then
    raise exception 'the preference columns must default to '''' (not set), not to a code.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal
  ) then
    raise exception 'the on_auth_user_created trigger must survive: new accounts still need their profile row.';
  end if;
end $$;
