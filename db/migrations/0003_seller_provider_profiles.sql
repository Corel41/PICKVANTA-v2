-- ============================================================================
-- PickVanta — seller / provider accounts (Step 11, migration 0003)
-- ----------------------------------------------------------------------------
-- Supabase / PostgreSQL. This migration adds the marketplace-participation
-- foundation: a business entity that a PickVanta user can own, with a review
-- lifecycle, on top of the catalogue schema (0001) and the user profiles (0002).
--
--   1. public.seller_provider_profiles
--        one row per business a user wants to sell or provide with:
--        owner, account type, business details, contact details, structured
--        location, status, and the review columns a future admin workflow needs
--   2. RLS                a signed-in user creates and reads only their own
--                         rows, and may edit only their own *pending* row
--   3. guard trigger      ownership, status and review columns cannot be
--                         written by a client at all — including on insert
--   4. review functions   admin-only, security definer, for the future review
--                         workflow (no interface is built in this step)
--
-- Why a separate table from public.sellers
--   public.sellers (0001) is the catalogue's *public* seller record: it is
--   anonymous-readable, it appears on listing pages, and listings and deals
--   reference it by id. It is display data. A seller/provider account is
--   something else: it belongs to a person, it holds private contact details,
--   and it moves through a review lifecycle. Putting account data on the
--   public table would mean publishing it, and would mean an anonymous visitor
--   could read a business's private phone number. So the account lives here,
--   with RLS, and links to its public catalogue record through seller_id — set
--   when the account is approved, in a later step, not by this one.
--
-- The relationship (nothing in this migration publishes anything)
--
--   auth.users ──1:1──> public.profiles            (global role: user | admin)
--       │
--       └──1:N──> public.seller_provider_profiles  (owner, type, status)
--                        │
--                        └── seller_id (nullable) ──> public.sellers
--                                                          │
--                                                          └──> public.listings ──> public.deals
--
--   A user may own several accounts (owner_id is indexed, not unique), because a
--   person can legitimately sell products and provide services, now or later.
--   Listings keep referencing public.sellers exactly as they do today: this
--   migration changes no catalogue table, so the public catalogue is untouched.
--   Imported merchant/affiliate offers (a later stage) will reference external
--   merchants and are deliberately NOT this entity — see the README.
--
-- Apply order (see the README):
--     db/migrations/0001_catalogue.sql
--     db/migrations/0002_auth_profiles.sql
--     db/migrations/0003_seller_provider_profiles.sql
--     db/seed/0001_catalogue.sql
--   The migration is written to be re-applied safely: every object is created
--   "if not exists" or replaced, and every policy is dropped before it is made.
-- ============================================================================

-- ---------------------------------------------------------------- pre-checks ---
do $$
begin
  /* to_regprocedure, not to_regproc: only the former accepts a function name
     together with its argument list (see 0002 for the same guard). */
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.set_updated_at() is missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Supabase Auth is required for this migration: the auth.users table does not exist.';
  end if;
  if to_regclass('public.sellers') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.sellers is missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. seller_provider_profiles — the marketplace account
-- ---------------------------------------------------------------------------
create table if not exists public.seller_provider_profiles (
  id uuid primary key default gen_random_uuid(),
  /* The person who created the account and is answerable for it. Cascades on
     delete, so removing an auth user cannot leave an orphaned business. Not
     unique: one person may own more than one business. */
  owner_id uuid not null references auth.users (id) on delete cascade,
  /* The two ways a PickVanta participant participates. 'seller' is a product
     business; 'provider' is a service business. The user-facing language
     differs, the account structure does not — which is what keeps this
     scalable to future account types without a second table. */
  account_type text not null check (account_type in ('seller', 'provider')),
  business_name text not null,
  description text not null default '',
  /* Contact details are for PickVanta and the account holder. They are never
     public: public.sellers carries what the catalogue displays. */
  contact_email text not null default '',
  contact_phone text not null default '',
  website text,
  /* The same structured location vocabulary the catalogue uses (see
     public.sellers in 0001), so an approved account can become a catalogue
     seller record without translating anything. */
  country text not null default 'Kenya',
  county text not null default '',
  city text not null default '',
  area text not null default '',
  /* The review lifecycle. 'pending' is the only status a client can ever
     create; the rest are reached through an admin action (see section 4).
     'rejected' exists rather than overloading 'archived', so a refused
     application is distinguishable from a business that closed. */
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'rejected', 'archived')),
  /* Review bookkeeping, for the future admin workflow. Written only by the
     review functions below — never by a client. */
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_note text not null default '',
  /* The public catalogue record this account speaks for. Nullable, because a
     pending account has no published record yet: nothing in this step creates
     one, and no existing catalogue record is claimed by anybody. Set when an
     account is approved, in a later step. */
  seller_id text references public.sellers (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint seller_profiles_business_name_length check (length(business_name) <= 120),
  constraint seller_profiles_business_name_not_blank check (length(btrim(business_name)) > 0),
  constraint seller_profiles_description_length check (length(description) <= 2000),
  constraint seller_profiles_contact_email_length check (length(contact_email) <= 254),
  /* Either empty (a phone-only or pending detail) or a plausible address. The
     shape is checked here as well as in the client, because the client is not
     the authority. */
  constraint seller_profiles_contact_email_shape
    check (contact_email = '' or contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  constraint seller_profiles_contact_phone_length check (length(contact_phone) <= 40),
  constraint seller_profiles_website_length check (website is null or length(website) <= 300),
  constraint seller_profiles_website_shape
    check (website is null or website = '' or website ~* '^https?://[^[:space:]]+$'),
  constraint seller_profiles_country_length check (length(country) <= 80),
  constraint seller_profiles_county_length check (length(county) <= 80),
  constraint seller_profiles_city_length check (length(city) <= 80),
  constraint seller_profiles_area_length check (length(area) <= 80),
  constraint seller_profiles_review_note_length check (length(review_note) <= 500),
  /* A reviewed row must say when, so the history cannot be half-written. */
  constraint seller_profiles_reviewed_consistency
    check ((status = 'pending') = (reviewed_at is null))
);

comment on table public.seller_provider_profiles is
  'A seller (product business) or provider (service business) account owned by a PickVanta user. Private account data with a review lifecycle; the public catalogue record it speaks for is public.sellers, linked by seller_id once approved.';
comment on column public.seller_provider_profiles.owner_id is
  'The auth user who owns this account. Not unique: one person may own several businesses.';
comment on column public.seller_provider_profiles.account_type is
  'seller = sells products, provider = provides services. Underlying structure is shared; only the language differs.';
comment on column public.seller_provider_profiles.status is
  'pending by default. Only an admin review (public.seller_profile_set_status) reaches active, suspended, rejected or archived.';
comment on column public.seller_provider_profiles.seller_id is
  'The public catalogue seller record this account will speak for. Null until an account is approved and a record exists — never set by a client.';

create index if not exists seller_provider_profiles_owner_idx
  on public.seller_provider_profiles (owner_id);
create index if not exists seller_provider_profiles_status_idx
  on public.seller_provider_profiles (status, created_at desc);
/* One public catalogue record can be claimed by at most one account. */
create unique index if not exists seller_provider_profiles_seller_idx
  on public.seller_provider_profiles (seller_id) where seller_id is not null;

drop trigger if exists seller_provider_profiles_set_updated_at on public.seller_provider_profiles;
create trigger seller_provider_profiles_set_updated_at
  before update on public.seller_provider_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Guard trigger — what a client may never write
-- ---------------------------------------------------------------------------
-- Column grants alone are not enough (a client could still try, and a future
-- careless grant would open a hole). This trigger is the second lock:
--
--   insert  the row must be the caller's own, pending, unlinked and unreviewed
--   update  id, owner_id, account_type, status, seller_id and the review
--           columns cannot change — from any client, ever
--
-- The functions in section 4 bypass it deliberately: they run as the table
-- owner with an explicit is_admin() check of their own.
create or replace function public.seller_profiles_guard()
returns trigger
language plpgsql
/* Deliberately not security definer: the guard needs no privileges of its own
   and must run as whoever is writing, so the check cannot be side-stepped by
   the function's own rights. */
as $$
declare
  caller uuid := auth.uid();
  by_review boolean := coalesce(current_setting('pickvanta.review', true), '') = 'on';
begin
  /* The review functions below change columns a client may never touch. They
     announce themselves with a transaction-local flag — and that flag only has
     an effect for a caller who is *already* an admin, so it cannot be used to
     get around anything. */
  if by_review and public.is_admin() then
    new.id := old.id;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    if caller is null or new.owner_id is distinct from caller then
      raise exception 'seller_provider_profiles: an account must be created for the signed-in user'
        using errcode = '42501';
    end if;
    if new.status is distinct from 'pending' then
      raise exception 'seller_provider_profiles: a new account always starts as pending'
        using errcode = '42501';
    end if;
    if new.seller_id is not null then
      raise exception 'seller_provider_profiles: a client cannot link an account to a catalogue record'
        using errcode = '42501';
    end if;
    if new.reviewed_at is not null or new.reviewed_by is not null or coalesce(new.review_note, '') <> '' then
      raise exception 'seller_provider_profiles: review columns are set by PickVanta, not by a client'
        using errcode = '42501';
    end if;
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := now();
    return new;
  end if;

  /* UPDATE */
  if new.id is distinct from old.id then
    raise exception 'seller_provider_profiles: id cannot be changed' using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'seller_provider_profiles: ownership cannot be changed' using errcode = '42501';
  end if;
  if new.account_type is distinct from old.account_type then
    raise exception 'seller_provider_profiles: the account type cannot be changed after creation'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    raise exception 'seller_provider_profiles: status is set by PickVanta review, not by a client'
      using errcode = '42501';
  end if;
  if new.seller_id is distinct from old.seller_id then
    raise exception 'seller_provider_profiles: the catalogue link is set by PickVanta, not by a client'
      using errcode = '42501';
  end if;
  if new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.review_note is distinct from old.review_note then
    raise exception 'seller_provider_profiles: review columns are set by PickVanta, not by a client'
      using errcode = '42501';
  end if;
  if old.status <> 'pending' then
    /* An approved, suspended, rejected or archived account is edited by
       PickVanta, not by its owner. */
    raise exception 'seller_provider_profiles: only a pending account can be edited'
      using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists seller_provider_profiles_guard on public.seller_provider_profiles;
create trigger seller_provider_profiles_guard
  before insert or update on public.seller_provider_profiles
  for each row execute function public.seller_profiles_guard();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.seller_provider_profiles enable row level security;

-- Nothing by default: anonymous visitors have no business here at all.
revoke all on public.seller_provider_profiles from anon, authenticated;

-- A signed-in person may read their own rows, create their own row, and update
-- their own pending row. There is no delete: an account is archived or rejected,
-- never silently removed. Nothing here may touch anybody else's row.
grant select, insert on public.seller_provider_profiles to authenticated;
grant update (business_name, description, contact_email, contact_phone, website,
              country, county, city, area)
  on public.seller_provider_profiles to authenticated;

drop policy if exists seller_profiles_select_own on public.seller_provider_profiles;
create policy seller_profiles_select_own on public.seller_provider_profiles
  for select to authenticated
  using (owner_id = auth.uid());

/* An administrator has to be able to see what is waiting to be reviewed. This
   is the only policy that reads anybody else's row, and it is gated on the
   database's own is_admin(), never on anything a client sends. */
drop policy if exists seller_profiles_select_admin on public.seller_provider_profiles;
create policy seller_profiles_select_admin on public.seller_provider_profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists seller_profiles_insert_own on public.seller_provider_profiles;
create policy seller_profiles_insert_own on public.seller_provider_profiles
  for insert to authenticated
  with check (owner_id = auth.uid() and status = 'pending' and seller_id is null);

drop policy if exists seller_profiles_update_own_pending on public.seller_provider_profiles;
create policy seller_profiles_update_own_pending on public.seller_provider_profiles
  for update to authenticated
  using (owner_id = auth.uid() and status = 'pending')
  with check (owner_id = auth.uid() and status = 'pending');

/* No delete policy exists, on purpose. */

-- ---------------------------------------------------------------------------
-- 4. Review functions — the database side of the future admin workflow
-- ---------------------------------------------------------------------------
-- No interface is built in this step, and none of these can be reached by a
-- normal account: each one checks public.is_admin() itself (the table's RLS
-- cannot help, because these run as the owner to be able to change status).
-- They exist so that approval is a database action with one implementation,
-- rather than a policy that later has to be invented.

create or replace function public.seller_profile_set_status(
  target_id uuid,
  new_status text,
  note text default ''
)
returns public.seller_provider_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.seller_provider_profiles;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can review a seller or provider account'
      using errcode = '42501';
  end if;
  if new_status not in ('pending', 'active', 'suspended', 'rejected', 'archived') then
    raise exception 'Unknown seller/provider status: %', new_status using errcode = '22023';
  end if;
  if length(coalesce(note, '')) > 500 then
    raise exception 'The review note is too long' using errcode = '22001';
  end if;

  perform set_config('pickvanta.review', 'on', true);
  update public.seller_provider_profiles
     set status = new_status,
         review_note = coalesce(note, ''),
         reviewed_at = case when new_status = 'pending' then null else now() end,
         reviewed_by = case when new_status = 'pending' then null else auth.uid() end,
         updated_at = now()
   where id = target_id
  returning * into updated;

  if updated.id is null then
    raise exception 'No seller/provider account with that id' using errcode = 'P0002';
  end if;
  return updated;
end;
$$;

-- Links an approved account to the public catalogue record it speaks for. The
-- record itself is created by a later step; this only wires the two together.
create or replace function public.seller_profile_set_seller(
  target_id uuid,
  catalogue_seller_id text
)
returns public.seller_provider_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.seller_provider_profiles;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can link an account to a catalogue record'
      using errcode = '42501';
  end if;
  if catalogue_seller_id is null or not exists (select 1 from public.sellers s where s.id = catalogue_seller_id) then
    raise exception 'No catalogue seller with that id' using errcode = 'P0002';
  end if;

  perform set_config('pickvanta.review', 'on', true);
  update public.seller_provider_profiles
     set seller_id = catalogue_seller_id, updated_at = now()
   where id = target_id
  returning * into updated;

  if updated.id is null then
    raise exception 'No seller/provider account with that id' using errcode = 'P0002';
  end if;
  return updated;
end;
$$;

/* Both functions are callable only by a signed-in caller who is also an admin
   (they check is_admin() themselves). anon is refused outright. */
revoke all on function public.seller_profile_set_status(uuid, text, text) from public, anon;
revoke all on function public.seller_profile_set_seller(uuid, text) from public, anon;
grant execute on function public.seller_profile_set_status(uuid, text, text) to authenticated;
grant execute on function public.seller_profile_set_seller(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-check — fail the migration rather than leave a quiet hole
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.seller_provider_profiles'::regclass) then
    problems := problems || 'RLS is not enabled on public.seller_provider_profiles';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'seller_provider_profiles'
      and grantee = 'anon'
  ) then
    problems := problems || 'anon still holds a privilege on public.seller_provider_profiles';
  end if;
  if exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'seller_provider_profiles'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
      and column_name in ('owner_id', 'status', 'seller_id', 'reviewed_at', 'reviewed_by', 'account_type', 'id')
  ) then
    problems := problems || 'authenticated can update a protected column directly';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'seller_provider_profiles' and cmd = 'SELECT'
      and policyname = 'seller_profiles_select_own'
  ) then
    problems := problems || 'the own-row select policy is missing';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'seller_provider_profiles' and cmd in ('DELETE', 'ALL')
  ) then
    problems := problems || 'a delete-capable policy exists on public.seller_provider_profiles';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('seller_profile_set_status', 'seller_profile_set_seller')
      and p.prosecdef is not true
  ) then
    problems := problems || 'a review function is not security definer';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'seller_profiles_guard' and p.prosecdef is true
  ) then
    problems := problems || 'the guard trigger runs with privileges it does not need';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'seller/provider migration self-check failed: %', array_to_string(problems, '; ');
  end if;
  raise notice 'seller_provider_profiles: schema, RLS and review functions verified.';
end $$;
