/* ==========================================================================
   PickVanta — Step 12: admin dashboard counts
   --------------------------------------------------------------------------
   The admin panel needs to show how much work is waiting and what the public
   catalogue currently holds. Every number on that dashboard is a real row
   count from this database; nothing is estimated, sampled or invented.

   Why a function rather than counting rows in the browser:

     • a count is not a read. Counting client-side would mean shipping every
       row of every application to the browser — including the ones an
       administrator does not need — and then counting them there (or issuing
       five requests for five counts).
     • a `security definer` function can see the whole table without handing
       the browser a broader row-level policy than it needs, exactly as
       `catalogue_stats()` in 0001 and the review functions in 0003 do.
     • the administrator check lives here, in the database, and is the same
       `public.is_admin()` every other privileged path uses. This function
       cannot be tricked into answering a non-administrator.

   It reads and returns nothing else: no ids, no names, no contact details.
   Counts only.

   Apply db/migrations/0001_catalogue.sql, 0002_auth_profiles.sql and
   0003_seller_provider_profiles.sql before this file.

   Re-appliable: the function is replaced, and the final block fails the
   migration if anything about it is not what it should be.
   ========================================================================== */

-- ---------------------------------------------------------------------------
-- 1. Pre-checks — name what is missing instead of failing obscurely
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
  ) then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'seller_provider_profiles'
  ) then
    raise exception 'Apply db/migrations/0003_seller_provider_profiles.sql before this file: public.seller_provider_profiles is missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The counts
-- ---------------------------------------------------------------------------
/*
   Returns one jsonb object:

     {
       "applications": { "total": n, "pending": n, "active": n,
                         "suspended": n, "rejected": n, "archived": n },
       "catalogue":    { "published_listings": n, "active_deals": n,
                         "demo_sellers": n }
     }

   Definitions, so the numbers on the dashboard mean something exact:

     published_listings  listings with status = 'published' — what a visitor
                         can actually browse
     active_deals        offers whose own status is 'scheduled' or 'active'
                         AND whose listing is published — the offers the Deals
                         view can show
     demo_sellers        rows in public.sellers, the public display records the
                         catalogue already uses. These are the bundled
                         demonstration records, NOT PickVanta accounts; the
                         distinction is deliberate and is what the dashboard
                         labels it as.
     applications        every row of seller_provider_profiles, by status.
                         A PickVanta participant account — a different thing
                         from a `sellers` row, and the two are never merged.

   `demo_sellers` is included because the admin panel needs one honest number
   for the catalogue side of the marketplace, and because confusing
   `sellers` with `seller_provider_profiles` is the mistake this schema is
   designed to make impossible. It is labelled as what it is.
*/
create or replace function public.admin_dashboard_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can read the admin dashboard counts'
      using errcode = '42501';
  end if;

  with by_status as (
    select status, count(*)::int as total
      from public.seller_provider_profiles
     group by status
  )
  select jsonb_build_object(
    'applications', jsonb_build_object(
      'total',     coalesce((select sum(total) from by_status), 0),
      'pending',   coalesce((select total from by_status where status = 'pending'), 0),
      'active',    coalesce((select total from by_status where status = 'active'), 0),
      'suspended', coalesce((select total from by_status where status = 'suspended'), 0),
      'rejected',  coalesce((select total from by_status where status = 'rejected'), 0),
      'archived',  coalesce((select total from by_status where status = 'archived'), 0)
    ),
    'catalogue', jsonb_build_object(
      'published_listings', (select count(*)::int from public.listings where status = 'published'),
      'active_deals',       (select count(*)::int from public.deals d
                              join public.listings l on l.id = d.listing_id
                             where d.status in ('scheduled', 'active')
                               and l.status = 'published'),
      'demo_sellers',       (select count(*)::int from public.sellers)
    )
  )
  into counts;

  return counts;
end;
$$;

/* Callable only by a signed-in caller, and only answers an administrator.
   anon is refused outright — visitors have no business counting applications. */
revoke all on function public.admin_dashboard_counts() from public, anon;
grant execute on function public.admin_dashboard_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Self-check — fail the migration rather than leave a quiet hole
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_dashboard_counts'
      and p.prosecdef is not true
  ) then
    problems := problems || 'admin_dashboard_counts must be security definer: a count must not require a wider row policy';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_dashboard_counts'
      and pg_get_functiondef(p.oid) like '%public.is_admin()%'
  ) then
    problems := problems || 'admin_dashboard_counts does not check is_admin()';
  end if;

  if not exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'admin_dashboard_counts'
      and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    problems := problems || 'authenticated cannot execute admin_dashboard_counts';
  end if;

  if exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'admin_dashboard_counts'
      and grantee in ('anon', 'PUBLIC')
  ) then
    problems := problems || 'anon can execute admin_dashboard_counts';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'admin dashboard migration self-check failed: %', array_to_string(problems, '; ');
  end if;
  raise notice 'admin_dashboard_counts(): definer function, is_admin() gate, authenticated only — verified.';
end $$;
