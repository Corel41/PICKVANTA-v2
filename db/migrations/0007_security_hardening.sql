-- ============================================================================
-- PickVanta — database security hardening (migration 0007)
-- ----------------------------------------------------------------------------
-- A security-hardening step, and nothing else. No new tables, no new columns,
-- no data change, no new product behaviour. It fixes three genuine defects that
-- were found by inspecting the existing migrations against the database's own
-- privilege and function catalogues:
--
--   1. SIX functions had no pinned `search_path` — the Supabase linter reports
--      five of them as `function_search_path_mutable`; the sixth
--      (public.seller_profiles_guard) has the same defect and is not in the
--      reported list. With no pinned path, a caller who can create objects in a
--      schema that appears on the path can influence how an unqualified name
--      inside the function resolves. Four further functions pinned the path to
--      `public` without `pg_temp`, which leaves the caller-writable temporary
--      schema searched first; those are completed here too (section 2b).
--
--   2. `authenticated` held INSERT, UPDATE, DELETE and TRUNCATE on every
--      catalogue table. 0001 revoked those from `anon` only, and stated in a
--      comment that the revoke was "defence in depth" — but the second layer
--      was never actually applied to signed-in callers. Row Level Security
--      blocks the row writes today (verified: an INSERT is refused and an
--      UPDATE/DELETE matches no row), so this is not a live data leak. It is
--      still a real defect, because **TRUNCATE is not subject to Row Level
--      Security at all**: it needs only the TRUNCATE privilege, and a signed-in
--      non-administrator could truncate a catalogue table that has no inbound
--      foreign key (verified against public.catalogue_settings). The intended
--      design has two independent layers; this restores the second one.
--
--   3. `anon` and `authenticated` held CREATE on schema `public`. A signed-in
--      caller could create objects there (verified), which is how a caller
--      could get objects in front of an unpinned `search_path` in the first
--      place — the two defects compound. It is also what makes
--      `extension_in_public` a live concern rather than a cosmetic one.
--
-- What this file deliberately does NOT do:
--   • It does not move, drop or recreate pg_trgm. See the note in section 5.
--   • It does not touch a single RLS policy. Every policy created by
--     0001–0006 stays exactly as it is: catalogue rows are readable exactly
--     where they were, `profiles` and `seller_provider_profiles` keep their
--     own-row policies, and the six Deal Engine tables keep their single
--     admin-only SELECT policy and no write policy.
--   • It does not touch the grants that 0002 and 0003 make on purpose:
--     `profiles` and `seller_provider_profiles` keep INSERT and their
--     column-level UPDATE, because the seller/provider flow needs them and
--     their guard triggers and policies constrain them.
--   • It does not rewrite any of 0001–0006. Those files are history; the fix
--     belongs in a new migration, applied after them.
--   • It adds no extension, no schema, no role and no default privilege beyond
--     the narrow one in section 4.
--
-- Apply after db/migrations/0006_deal_engine_operations.sql. Re-runnable.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Pre-flight — the objects this file hardens have to be there.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text[] := '{}';
  name    text;
begin
  if to_regclass('public.listings') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.listings is missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;
  if to_regclass('public.deal_sources') is null then
    raise exception 'Apply db/migrations/0005_deal_engine_foundation.sql before this file: the Deal Engine tables are missing.';
  end if;

  /* Every function this file pins has to exist, with the signature it had.
     Each is matched by its exact argument list so a differently-shaped
     function of the same name would be reported rather than silently skipped. */
  foreach name in array array[
    'public.set_updated_at()',
    'public.listings_refresh_search_text()',
    'public.catalogue_stats()',
    'public.catalogue_tags()',
    'public.catalogue_facets()',
    'public.seller_profiles_guard()'
  ]
  loop
    if to_regprocedure(name) is null then
      missing := missing || name;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception 'These functions are missing, so this file cannot harden them: %', array_to_string(missing, ', ');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Pin the search_path of every function that lacks one.
--
--    ALTER FUNCTION ... SET is used rather than CREATE OR REPLACE on purpose:
--    it cannot change the body, the argument list, the return type, the
--    volatility or the security mode, so there is no way for this file to
--    alter behaviour. The only thing that changes is how unqualified names
--    inside the existing bodies resolve.
--
--    `pg_temp` is listed last. Without it, a temporary object is searched
--    *first* for relation names, which is exactly the shadowing this guards
--    against; naming it explicitly and last removes the ambiguity.
--
--    Every one of these six functions already qualifies the objects it uses
--    (public.categories, public.listings, auth.uid(), …) and calls only
--    pg_catalog built-ins otherwise, so pinning the path changes no result —
--    it only closes the class of risk. None needs `extensions` or any other
--    schema, so none is given one.
-- ---------------------------------------------------------------------------
alter function public.set_updated_at()                 set search_path = public, pg_temp;
alter function public.listings_refresh_search_text()   set search_path = public, pg_temp;
alter function public.catalogue_stats()                set search_path = public, pg_temp;
alter function public.catalogue_tags()                 set search_path = public, pg_temp;
alter function public.catalogue_facets()               set search_path = public, pg_temp;
alter function public.seller_profiles_guard()          set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2b. Complete the pin on the four functions that already had one.
--
--    These are not in the linter's list: it reports a NULL search_path, and
--    these four are pinned — to `public` alone. That is not the whole job.
--    When `pg_temp` is not named explicitly, PostgreSQL searches the temporary
--    schema *first* for relation names, and the temporary schema is writable by
--    whoever is connected. Naming `pg_temp` last removes that implicit
--    first-look. It matters most for the three SECURITY DEFINER functions here,
--    and above all for public.is_admin(), which is the authorization primitive
--    the entire admin surface and every Deal Engine policy rests on.
--
--    All four bodies qualify every object they touch, so this changes no
--    result. It makes one invariant true and checkable instead of most-of-one:
--    after this file, every function in the public schema pins exactly
--    `public, pg_temp`.
-- ---------------------------------------------------------------------------
alter function public.handle_new_user()          set search_path = public, pg_temp;
alter function public.handle_user_email_change() set search_path = public, pg_temp;
alter function public.is_admin()                 set search_path = public, pg_temp;
alter function public.profiles_guard_role()      set search_path = public, pg_temp;


-- ---------------------------------------------------------------------------
-- 3. Restore the second layer under the catalogue's Row Level Security.
--
--    Named table by table, not `on all tables in schema public`, so that this
--    file cannot accidentally alter a grant that another migration made on
--    purpose — public.profiles and public.seller_provider_profiles keep the
--    INSERT and column-level UPDATE that 0002 and 0003 grant them.
--
--    TRUNCATE is included because it is the one write that Row Level Security
--    does not police, and it is the privilege that turned this from untidy
--    into exploitable.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.categories,
  public.subcategories,
  public.sellers,
  public.listings,
  public.deals,
  public.guides,
  public.guide_listings,
  public.catalogue_settings
from authenticated;

/* anon already had these revoked by 0001; repeated so that this file is also
   correct on a project where that statement was never run. */
revoke insert, update, delete, truncate on
  public.categories,
  public.subcategories,
  public.sellers,
  public.listings,
  public.deals,
  public.guides,
  public.guide_listings,
  public.catalogue_settings
from anon;


-- ---------------------------------------------------------------------------
-- 4. Close the schema to object creation.
--
--    USAGE is what PostgREST needs and stays; CREATE is what let a signed-in
--    caller put objects into the schema every unpinned search_path searches
--    first. This is the root cause behind the `extension_in_public` warning,
--    and it is worth fixing on its own merits regardless of the extension.
--
--    The default privileges are narrowed too, for the same four write
--    privileges only, so that a table created by a future migration does not
--    silently arrive with the wide grants this file just removed. A future
--    step that needs a write grants it explicitly, which is the pattern every
--    migration in this repository already follows.
--
--    Be clear about what this does NOT do, so that nobody reads more into it
--    than it says. It narrows *write* privileges. A table created later still
--    arrives readable by both clients (SELECT is deliberately left as the
--    default, because that is what every catalogue table wants), and Row Level
--    Security is not automatic — a new table has it off until its own migration
--    turns it on. The Deal Engine tables are private because 0005 says so, not
--    because this file made new tables private. A future step that creates a
--    table holding anything private must revoke and enable RLS itself, exactly
--    as 0002, 0003 and 0005 already do.
-- ---------------------------------------------------------------------------
revoke create on schema public from anon, authenticated;

alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. pg_trgm — investigated and deliberately left where it is.
--
--    The linter reports `extension_in_public` for pg_trgm, which 0001 creates
--    in the public schema. It is genuinely used: it provides the
--    `gin_trgm_ops` operator class behind public.listings_search_trgm_idx, and
--    the search the interface issues (`search_text ilike '%term%'`) is exactly
--    the pattern that index exists to serve. Removing it would degrade search,
--    so it is not removed.
--
--    Moving it (`alter extension pg_trgm set schema extensions`) is NOT done
--    here, deliberately:
--      • It cannot be verified from this repository. This sandbox's PostgreSQL
--        build does not ship pg_trgm at all, so a move could not be tested
--        before being written into a migration the operator is asked to apply
--        to a live project.
--      • 0001 is written to be re-runnable, and its index DO block names
--        `gin_trgm_ops` without a schema. After a move, re-running 0001 would
--        fail to resolve that name; the block's own exception handler would
--        swallow it and print "trigram index skipped". The index would survive
--        (an operator class is held by object id, not by name), but a
--        documented migration that prints a misleading notice on a second run
--        is a worse outcome than an accurately documented warning.
--      • It is a cosmetic change to the warning. The risk the warning points
--        at — a schema that clients may write to — is fixed in section 4.
--
--    The operator may still make the move by hand, in that order and nowhere
--    else, if the warning itself must be cleared:
--        create schema if not exists extensions;
--        alter extension pg_trgm set schema extensions;
--        grant usage on schema extensions to anon, authenticated;
--    It is a one-line, reversible change (`set schema public`), it needs the
--    `extensions` schema to exist, and it should be followed by a search from
--    the site to confirm the catalogue still answers.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 6. Self-check — this file fails rather than reporting success if any of the
--    properties it is responsible for is not true afterwards.
-- ---------------------------------------------------------------------------
do $$
declare
  offender text;
begin
  /* 6a. No public function may still have a mutable search_path. */
  select string_agg(p.proname, ', ' order by p.proname) into offender
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proconfig is null;
  if offender is not null then
    raise exception 'A public function still has a mutable search_path: %', offender;
  end if;

  /* 6b. Every pinned path must be exactly what this file set — nothing wider. */
  select string_agg(p.proname || ':' || array_to_string(p.proconfig, ','), ', ' order by p.proname)
    into offender
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not (p.proconfig @> array['search_path=public, pg_temp']);
  if offender is not null then
    raise exception 'A public function has an unexpected search_path: %', offender;
  end if;

  /* 6c. No client may hold a write privilege on a catalogue table. */
  select string_agg(c.relname || '/' || a.privilege_type, ', ' order by c.relname, a.privilege_type)
    into offender
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role_name)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as a(privilege_type)
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname in ('categories', 'subcategories', 'sellers', 'listings', 'deals',
                       'guides', 'guide_listings', 'catalogue_settings')
     and has_table_privilege(r.role_name, c.oid, a.privilege_type);
  if offender is not null then
    raise exception 'A client still holds a catalogue write privilege: %', offender;
  end if;

  /* 6d. No client may create objects in the public schema. */
  if has_schema_privilege('anon', 'public', 'CREATE')
     or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'A client can still create objects in schema public.';
  end if;

  /* 6e. The clients must still be able to *use* the schema and read the
         catalogue — a hardening step that broke the site would be a defect. */
  if not (has_schema_privilege('anon', 'public', 'USAGE')
          and has_schema_privilege('authenticated', 'public', 'USAGE')) then
    raise exception 'A client lost USAGE on schema public: the catalogue would stop loading.';
  end if;
  if not has_table_privilege('anon', 'public.listings', 'SELECT') then
    raise exception 'anon lost SELECT on public.listings: the public catalogue would stop loading.';
  end if;

  /* 6f. The grants this file must not disturb are still in place. */
  if not has_table_privilege('authenticated', 'public.seller_provider_profiles', 'INSERT') then
    raise exception 'authenticated lost INSERT on seller_provider_profiles: onboarding would break.';
  end if;
  if not has_table_privilege('authenticated', 'public.profiles', 'INSERT') then
    raise exception 'authenticated lost INSERT on profiles: profile creation would break.';
  end if;

  /* 6g. The Deal Engine tables keep the shape 0005 gave them: readable by a
         signed-in caller (the policies then decide), writable by nobody. */
  select string_agg(c.relname, ', ' order by c.relname) into offender
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('deal_sources', 'external_merchants', 'deal_engine_jobs',
                       'imported_deals', 'imported_deal_media', 'deal_engine_events')
     and (has_table_privilege('anon', c.oid, 'SELECT')
          or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('authenticated', c.oid, 'INSERT')
          or has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE')
          or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
  if offender is not null then
    raise exception 'A Deal Engine table has a privilege it should not have: %', offender;
  end if;

  /* 6h. Row Level Security is still on for every table in the schema. */
  select string_agg(c.relname, ', ' order by c.relname) into offender
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if offender is not null then
    raise exception 'Row Level Security is disabled on: %', offender;
  end if;

  raise notice 'database security hardening: search paths pinned, catalogue write privileges revoked, schema creation closed, RLS and Deal Engine boundaries intact';
end $$;
