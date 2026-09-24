-- ============================================================================
-- PickVanta — authentication & user roles (Step 9, migration 0002)
-- ----------------------------------------------------------------------------
-- Supabase / PostgreSQL. This migration adds the minimum database structure
-- needed to represent an authenticated PickVanta user, on top of the catalogue
-- schema in 0001_catalogue.sql.
--
--   1. public.profiles   one row per Supabase Auth user
--                        (id, email, display_name, role, created_at, updated_at)
--   2. profile creation  a trigger on auth.users creates the profile row, so a
--                        new account always has one
--   3. public.is_admin() a trusted, server-side answer to "is this caller an
--                        administrator?" — used by policies now and by admin
--                        features in a later step
--   4. RLS policies      a signed-in user reads and updates their own profile
--                        and nothing else; roles cannot be self-assigned
--
-- Design notes
--   • Credentials never live here. Supabase Auth (auth.users, auth.uid()) stays
--     the single source of truth for authentication; this table only holds the
--     application profile. No passwords, no tokens, no auth state is copied.
--   • profiles.id is the Supabase Auth user id (uuid), so the two can only ever
--     refer to the same account.
--   • Roles are 'user' and 'admin'. The default is 'user'. Nothing in the
--     browser can choose or change a role: the column-level grants and the
--     guard trigger make a self-promotion impossible even if a policy were
--     later written carelessly.
--   • UI visibility based on role is a convenience only. Every restriction
--     that matters is enforced here, in the database.
--
-- Apply order (see the README):
--     psql "$DATABASE_URL" -f db/migrations/0001_catalogue.sql
--     psql "$DATABASE_URL" -f db/migrations/0002_auth_profiles.sql
--     psql "$DATABASE_URL" -f db/seed/0001_catalogue.sql
--   or paste each file into the Supabase dashboard → SQL editor, in that order.
--   The migration is written to be re-applied safely: every object is created
--   "if not exists" or replaced, and every policy is dropped before it is made.
-- ============================================================================

-- ---------------------------------------------------------------- pre-checks ---
-- Fail loudly with an actionable message instead of half-creating the schema.
do $$
begin
  /* to_regprocedure, not to_regproc: only the former accepts a function name
     together with its argument list. to_regproc takes a bare name, so a
     signature makes it return null and this guard would fail on a project
     where 0001 is correctly applied. */
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.set_updated_at() is missing.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Supabase Auth is required for this migration: the auth.users table does not exist.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. profiles — one row per authenticated user
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  /* The Supabase Auth user id. Cascades on delete, so deleting the auth user
     (a later step, not this one) can never leave an orphaned profile. */
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null default '',
  display_name text not null default '',
  /* 'user' is the only role a normal account can have. 'admin' exists so that
     later steps have a trusted role to build on. */
  role         text not null default 'user'
               check (role in ('user', 'admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_display_name_length check (length(display_name) <= 80)
);

comment on table public.profiles is
  'Application profile for an authenticated PickVanta user. Credentials stay in Supabase Auth; role is assigned here by the database, never by the browser.';
comment on column public.profiles.role is
  'Application role: user (default) or admin. Only an existing admin can change a role.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Profile creation — every new account gets a profile
-- ---------------------------------------------------------------------------
-- Runs as the table owner (security definer) because the auth trigger fires in
-- the context of the sign-up request, which has no profile row to write to yet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    /* Optional metadata only. Sign-up does not ask for profile information:
       an empty display_name is normal and the interface falls back to the
       email address. */
    coalesce(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keeps the profile email in step when the address changes in Supabase Auth.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- 3. Is the caller an administrator? — the trusted answer
-- ---------------------------------------------------------------------------
-- Reads the role from this table, for the caller's own id, as the table owner.
-- The caller cannot influence it: there is no parameter to pass and no way to
-- read another row. `auth.uid()` is null for anonymous visitors, so anon and
-- signed-out callers always get false.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

comment on function public.is_admin() is
  'True only when the current caller has an authenticated session whose profile role is admin. Server-side source of truth for authorization; never a client value.';

-- ---------------------------------------------------------------------------
-- 4. Privileged fields cannot be self-assigned
-- ---------------------------------------------------------------------------
-- Second boundary behind the grants below. If a future grant or policy ever
-- widened write access, this still refuses a self-promotion.
create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  /* Who counts as a client: a request that arrives through the API runs as
     `anon` or `authenticated`. The SQL editor, a migration and the
     server-side key do not, and one of those is the only way the *first*
     administrator can ever be made (see the README) — so this guard must not
     block them, or the admin role would be unassignable and the admin panel
     unreachable. A request with no token at all is `anon`, so it is covered
     too. */
  if tg_op = 'INSERT' then
    if new.role is distinct from 'user' and not public.is_admin()
       and current_user in ('anon', 'authenticated') then
      raise exception 'A new profile can only be created with role "user".'
        using errcode = '42501';
    end if;
    return new;
  end if;

  /* UPDATE: the id is the link to the auth user and never changes. */
  if new.id is distinct from old.id then
    raise exception 'profiles.id cannot be changed.'
      using errcode = '42501';
  end if;

  /* Same discrimination as above: an administrator may promote somebody, an
     operator's out-of-band SQL may bootstrap the first administrator, and a
     client — signed in or not — may not touch the column at all. */
  if new.role is distinct from old.role and not public.is_admin()
     and current_user in ('anon', 'authenticated') then
    raise exception 'profiles.role can only be changed by an administrator.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_role();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security — your own profile, and only your own
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_read_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;

-- Read: only the row whose id is the caller's own auth user id. There is
-- deliberately no "public read" policy: the profiles table is not a public
-- directory in this step, and the catalogue does not join to it.
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

-- A user who somehow has no profile row (for example an account created before
-- this migration was applied) may create exactly one: their own row, and only
-- with role 'user'. Choosing 'admin' is refused by the policy itself and again
-- by the guard trigger above.
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and role = 'user');

-- Update: own row only. Which columns may be written is decided by the column
-- grant below, not by this policy.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No delete policy exists: account deletion is not part of this step.

-- ---------------------------------------------------------------------------
-- 6. Grants — the browser gets the smallest privilege that works
-- ---------------------------------------------------------------------------
-- Supabase grants ALL on new tables in schema public to anon and authenticated
-- by default, so everything is revoked explicitly and then re-granted
-- narrowly. Note that `role`, `id`, `email`, `created_at` and `updated_at`
-- are NOT updatable by any browser role, whatever a policy might later say.
revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;

/* Anonymous visitors get no privilege and no policy: nothing to read and
   nothing to write. */
grant select, insert on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Checks — prove the boundary holds (read-only, safe to re-run)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'profiles' and rowsecurity
  ) then
    raise exception 'profiles must have row level security enabled.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
      and (roles = '{public}' or 'anon' = any (roles))
  ) then
    raise exception 'profiles must not be readable by anon or public.';
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'role', 'update') then
    raise exception 'authenticated must not be able to update profiles.role.';
  end if;

  if has_table_privilege('anon', 'public.profiles', 'select') then
    raise exception 'anon must not be able to read profiles.';
  end if;

  if has_table_privilege('anon', 'public.profiles', 'insert')
     or has_table_privilege('anon', 'public.profiles', 'update')
     or has_table_privilege('anon', 'public.profiles', 'delete') then
    raise exception 'anon must not be able to write profiles.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Making someone an administrator
-- ---------------------------------------------------------------------------
-- There is no admin interface in this step and the browser cannot do it. Run
-- this once, as a privileged role (Supabase dashboard → SQL editor):
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- Everything that later steps restrict to administrators will read the answer
-- from public.is_admin(), which reads this column.
-- ============================================================================
