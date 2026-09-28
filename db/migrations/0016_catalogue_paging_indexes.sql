-- ============================================================================
-- 0016_catalogue_paging_indexes.sql — Backlog #7: server-side catalogue
-- search & pagination.
-- ----------------------------------------------------------------------------
-- The live catalogue now asks the database for exactly one page at a time:
-- every browse runs as
--
--     SELECT … FROM listings
--      WHERE status = 'published'            (plus the visitor's filters)
--      ORDER BY <the chosen deterministic order>
--      LIMIT <page size> OFFSET <page>
--
-- and every search runs the same shape over the maintained search_text column
-- (0001's pg_trgm index already backs that filter). Two access paths had no
-- index that fits them, and both are on every page view:
--
--   1. the default browse: status = 'published' ORDER BY created_at DESC.
--      0001 indexes status and created_at separately; together they serve
--      this query as one index scan instead of a filter plus a sort.
--   2. the name sorts: ORDER BY name [DESC]. No name index existed, so each
--      name-sorted page was a full sort of the filtered set.
--
-- Both are ordinary btree indexes on existing columns of one existing table —
-- nothing speculative, nothing else changed: no policy, no column, no
-- historical migration.
--
-- Re-runnable. Apply after db/migrations/0015_canonical_public_read.sql.
-- Rollback:
--   drop index if exists public.listings_status_created_idx;
--   drop index if exists public.listings_name_idx;
-- ============================================================================

-- ---------------------------------------------------------------- pre-checks ---
do $$
begin
  if to_regclass('public.listings') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.listings is missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The two paging indexes
-- ---------------------------------------------------------------------------
create index if not exists listings_status_created_idx
  on public.listings (status, created_at desc);

create index if not exists listings_name_idx
  on public.listings (name);

-- ---------------------------------------------------------------------------
-- 2. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'listings'
      and indexname = 'listings_status_created_idx'
      and indexdef like '%(status, created_at DESC)%'
  ) then
    raise exception 'listings_status_created_idx is missing or not (status, created_at desc).';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'listings'
      and indexname = 'listings_name_idx'
      and indexdef like '%(name)%'
  ) then
    raise exception 'listings_name_idx is missing or not on (name).';
  end if;

  /* the search index 0001 already provides must survive beside these —
     wherever 0001 could create it at all: on a PostgreSQL without the pg_trgm
     extension, 0001 deliberately skips the index ("search still works"), and
     this check must not demand what 0001's own guard refuses to promise. */
  if exists (select 1 from pg_extension where extname = 'pg_trgm')
     and not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'listings'
      and indexname = 'listings_search_trgm_idx'
  ) then
    raise exception 'the 0001 search trgm index is missing; search_text filtering must stay indexed.';
  end if;
end $$;
