-- ============================================================================
-- PickVanta — Deal Engine foundation (Step 13, migration 0005)
-- ----------------------------------------------------------------------------
-- Supabase / PostgreSQL. This migration adds the private, internal side of
-- PickVanta: the records behind deals that are imported from outside, and the
-- pipeline that will carry them from a source to a published deal.
--
-- Nothing here is connected to anything yet. There is no connector, no
-- scraper, no affiliate network, no worker and no scheduled job. This file
-- establishes the shapes those will need, so that the shapes can be reviewed
-- (and changed) before any of them is written.
--
--   1. public.deal_sources            where imported information comes from
--   2. public.external_merchants      a merchant an import came from — not a
--                                     PickVanta seller or provider, and with
--                                     no path to one
--   3. public.deal_engine_jobs        the unit of work a future worker runs
--   4. public.imported_deals          one imported record, with its provenance
--                                     kept intact and its place in the
--                                     pipeline recorded
--   5. public.imported_deal_media     references to media the source hosts
--   6. public.deal_engine_events      what happened to a record, append-only
--
-- The pipeline this models
--   IMPORTED → VALIDATED → NORMALIZED → DEDUPLICATED → PENDING-REVIEW
--            → APPROVED → PUBLISHED
--   with `rejected`, `archived` and `failed` as terminal outcomes. Nothing
--   publishes itself: an imported record ends up in a review queue, and only
--   an administrator's decision moves it past that point.
--
-- Three separations this migration exists to make structural
--   • Imported deal vs public deal. public.deals (0001) stays the presentation
--     model — what a visitor reads. Raw imported records never reach a public
--     page; an approved import points at the public record it became.
--   • source_url vs affiliate_url. Where the information came from and the
--     tracked destination a buyer would be sent through are different columns,
--     with a constraint that refuses to let them be the same value.
--   • PickVanta seller/provider vs external merchant. A person who applies to
--     sell on PickVanta lives in public.seller_provider_profiles (0003). A
--     merchant an import came from lives in public.external_merchants, and no
--     column in either table points at the other.
--
-- Security posture for this stage
--   • RLS is enabled on all six tables, and the only policy that exists is
--     a SELECT policy gated on public.is_admin(). An anonymous visitor and a
--     signed-in member of the public read nothing (0 rows / refused), and
--     neither does a signed-in member who guesses an id.
--   • There is no INSERT, UPDATE or DELETE policy for any client role — not
--     for the public and not for an administrator. Nothing in a browser can
--     write a Deal Engine record: the future pipeline writes them with a
--     server-side key or through its own function, which is where the
--     validation of untrusted, externally supplied data belongs.
--   • No secrets in these tables. deal_sources.config is checked to refuse a
--     key that looks like a credential: credentials belong in the server
--     environment, never in a row and never in the browser.
--
-- Apply order (see the README):
--     psql "$DATABASE_URL" -f db/migrations/0001_catalogue.sql
--     psql "$DATABASE_URL" -f db/migrations/0002_auth_profiles.sql
--     psql "$DATABASE_URL" -f db/migrations/0003_seller_provider_profiles.sql
--     psql "$DATABASE_URL" -f db/migrations/0004_admin_dashboard.sql
--     psql "$DATABASE_URL" -f db/migrations/0005_deal_engine_foundation.sql
--   or paste each file into the Supabase dashboard → SQL editor, in that order.
--   The migration is written to be re-applied safely: every object is created
--   "if not exists" or replaced, and every policy is dropped before it is made.
-- ============================================================================

-- ---------------------------------------------------------------- pre-checks ---
-- Fail loudly with an actionable message instead of half-creating the schema.
-- to_regprocedure (not to_regproc) is the function that accepts a name *with*
-- its argument list; to_regproc takes a bare name and returns null for a
-- signature, which would make this guard fail on a correctly migrated project.
do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.set_updated_at() is missing.';
  end if;
  if to_regclass('public.deals') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.deals is missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'Supabase Auth is required for this migration: the auth.users table does not exist.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. deal_sources — where imported information comes from
-- ---------------------------------------------------------------------------
-- A source is an agreement, not a scraper: a marketplace feed, an affiliate
-- network feed, a merchant API, a merchant product feed, or a discovery source
-- that PickVanta is permitted to read. A connector for one of these arrives in
-- a later stage; this row is what it will be configured against.
create table if not exists public.deal_sources (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  /* The kind of access, from a closed vocabulary. 'permitted-url-source' says
     exactly what it means: a source PickVanta is allowed to read, nothing more
     (no crawling, no sitemap scanning — that is not built at all). */
  source_type    text not null
                 check (source_type in ('marketplace-feed', 'affiliate-network-feed',
                                        'merchant-api', 'merchant-product-feed',
                                        'permitted-url-source')),
  provider_name  text not null default '',
  /* ISO 3166-1 alpha-2, any country — the engine is not Kenya-only. Empty
     string means "not recorded", which is different from "nowhere". */
  market_country text not null default ''
                 check (market_country = '' or market_country ~ '^[A-Z]{2}$'),
  endpoint_url   text not null default '',
  status         text not null default 'paused'
                 check (status in ('active', 'paused', 'disabled', 'archived')),
  /* Non-secret configuration: which market, which category map, page limits.
     The check below refuses a credential-shaped key outright, because the
     place for a credential is the server environment. */
  config         jsonb not null default '{}'::jsonb,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint deal_sources_name_present check (btrim(name) <> ''),
  constraint deal_sources_endpoint_shape
    check (endpoint_url = '' or endpoint_url ~* '^https?://[^[:space:]]+$'),
  constraint deal_sources_config_object check (jsonb_typeof(config) = 'object'),
  constraint deal_sources_config_no_secrets check (
    not (config::text ~* '"(secret|token|password|passwd|credential|credentials|api[_-]?key|apikey|bearer|private[_-]?key|client[_-]?secret|access[_-]?key)"[[:space:]]*:')
  )
);

comment on table public.deal_sources is
  'Where imported deal information comes from. A source is configured by an operator and read by a future server-side connector; it is never contacted from a browser and never holds a credential.';
comment on column public.deal_sources.endpoint_url is
  'The feed/API location the pipeline would read. A reference, not a link the interface follows on its own, and never a credential.';
comment on column public.deal_sources.config is
  'Non-secret configuration only (market, category map, limits). A constraint refuses credential-shaped keys.';

-- ---------------------------------------------------------------------------
-- 2. external_merchants — a merchant an import came from
-- ---------------------------------------------------------------------------
-- Deliberately separate from public.seller_provider_profiles (0003) and from
-- public.sellers (0001):
--   • a PickVanta seller/provider is a person who applied to participate here;
--   • a catalogue seller is a public display record a listing points at;
--   • an external merchant is a business represented through an outside
--     marketplace or affiliate source. It is not a PickVanta account, it never
--     becomes one by being listed here, and no column links it to one.
-- The future affiliate side (network, account, offer, link) attaches here, in
-- tables that do not exist yet.
create table if not exists public.external_merchants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  /* The source's own identifier for this merchant, kept verbatim. */
  merchant_ref text not null default '',
  website_url  text not null default '',
  country      text not null default ''
               check (country = '' or country ~ '^[A-Z]{2}$'),
  /* Which source first introduced this merchant. Not ownership. */
  source_id    uuid references public.deal_sources (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint external_merchants_name_present check (btrim(name) <> ''),
  constraint external_merchants_website_shape
    check (website_url = '' or website_url ~* '^https?://[^[:space:]]+$')
);

comment on table public.external_merchants is
  'A merchant (marketplace or affiliate-side business) that an imported deal came from. Not a PickVanta seller or provider: no column here references profiles or seller_provider_profiles, and none ever should.';

-- ---------------------------------------------------------------------------
-- 3. deal_engine_jobs — the unit of work a future worker runs
-- ---------------------------------------------------------------------------
-- The Deal Engine eventually runs outside the public request/response cycle:
-- a scan, an import, an extraction, a normalization pass, a deduplication
-- pass, a price or availability check, a link health check. No worker and no
-- scheduler exists in this step; this table is where one will report itself,
-- including how far it got and what went wrong.
create table if not exists public.deal_engine_jobs (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid references public.deal_sources (id) on delete restrict,
  job_type    text not null
              check (job_type in ('source-scan', 'feed-import', 'url-discovery',
                                  'extraction', 'normalization', 'deduplication',
                                  'price-check', 'availability-check',
                                  'deal-expiry', 'link-health')),
  status      text not null default 'queued'
              check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress    smallint not null default 0 check (progress between 0 and 100),
  detail      text not null default '',
  error       text not null default '',
  stats       jsonb not null default '{}'::jsonb,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint deal_engine_jobs_stats_object check (jsonb_typeof(stats) = 'object'),
  constraint deal_engine_jobs_window
    check (started_at is null or finished_at is null or started_at <= finished_at),
  /* A failure has to say something: a job that failed with no reason recorded
     is the kind of silence this table exists to prevent. */
  constraint deal_engine_jobs_failure_explained
    check (status <> 'failed' or btrim(error) <> '')
);

comment on table public.deal_engine_jobs is
  'One run of one Deal Engine task. Nothing schedules or executes these yet; the table exists so that a future worker has somewhere honest to report progress, outcome and failure.';

-- ---------------------------------------------------------------------------
-- 4. imported_deals — one imported record, with its provenance intact
-- ---------------------------------------------------------------------------
-- This is the raw, traceable record: what a source said, when it said it, and
-- where the record has got to since. It is not a public deal. It is never
-- published automatically, and a visitor's page never reads this table.
create table if not exists public.imported_deals (
  id                   uuid primary key default gen_random_uuid(),
  source_id            uuid not null references public.deal_sources (id) on delete restrict,
  /* Which run produced this record. Kept if the job row is ever pruned. */
  job_id               uuid references public.deal_engine_jobs (id) on delete set null,
  external_merchant_id uuid references public.external_merchants (id) on delete set null,

  -- provenance: what arrived, as it arrived -------------------------------
  external_product_id  text not null default '',
  merchant_name        text not null default '',
  merchant_ref         text not null default '',
  source_url           text not null default '',
  imported_title       text not null default '',
  imported_description text not null default '',
  imported_price       numeric(14, 2),
  imported_currency    text not null default ''
                       check (imported_currency = '' or imported_currency ~ '^[A-Z]{3}$'),
  imported_availability text not null default '',
  imported_category    text not null default '',
  /* The record as the source returned it, unchanged. The engine never edits
     this: it is the evidence a review decision is made against. */
  imported_metadata    jsonb not null default '{}'::jsonb,

  -- the tracked destination — a different thing from source_url -----------
  affiliate_url        text not null default '',

  -- normalisation output: the canonical shape, once a processor exists ----
  normalized_name        text not null default '',
  normalized_brand       text not null default '',
  /* Matched against the taxonomy in 0001. Not a foreign key on purpose: a
     category that could not be mapped has to stay visible as unmapped rather
     than block the import. */
  normalized_category_id text not null default '',
  normalized_availability text not null default '',
  model_number           text not null default '',
  gtin                   text not null default '',

  -- pipeline -------------------------------------------------------------
  pipeline_status      text not null default 'imported'
                       check (pipeline_status in ('imported', 'validated', 'normalized',
                                                  'deduplicated', 'pending-review', 'approved',
                                                  'published', 'rejected', 'archived', 'failed')),
  validation_status    text not null default 'not-run'
                       check (validation_status in ('not-run', 'passed', 'failed', 'skipped')),
  validation_result    text not null default '',
  normalization_status text not null default 'not-run'
                       check (normalization_status in ('not-run', 'passed', 'partial', 'failed', 'skipped')),
  normalization_result text not null default '',
  deduplication_status text not null default 'not-run'
                       check (deduplication_status in ('not-run', 'passed', 'failed', 'skipped')),
  deduplication_result text not null default '',
  /* Deterministic matching only, and never a merge: 'uncertain-match' exists
     so that an unclear case goes to a person instead of being decided. */
  dedup_match_class    text not null default 'unknown'
                       check (dedup_match_class in ('unknown', 'new-product', 'exact-match',
                                                    'probable-match', 'uncertain-match')),
  dedup_matched_deal_id uuid references public.imported_deals (id) on delete set null,

  -- admin review ---------------------------------------------------------
  review_status  text not null default 'not-required'
                 check (review_status in ('not-required', 'pending', 'approved', 'rejected', 'archived')),
  review_note    text not null default '',
  reviewed_at    timestamptz,
  reviewed_by    uuid references auth.users (id) on delete set null,
  error          text not null default '',

  /* The public deal this import became. Written when a reviewer publishes;
     the two records stay separate, and 0001's public.deals remains what the
     site reads. */
  published_deal_id text references public.deals (id) on delete set null,

  imported_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  /* An import has to be identifiable: at least one of an external id, a title
     or a source URL. A record with none of them cannot be reviewed. */
  constraint imported_deals_identifiable
    check (external_product_id <> '' or imported_title <> '' or source_url <> ''),
  constraint imported_deals_price_not_negative
    check (imported_price is null or imported_price >= 0),
  constraint imported_deals_source_url_shape
    check (source_url = '' or source_url ~* '^https?://[^[:space:]]+$'),
  constraint imported_deals_affiliate_url_shape
    check (affiliate_url = '' or affiliate_url ~* '^https?://[^[:space:]]+$'),
  /* The permanent PickVanta separation. A tracked affiliate destination and
     the place the information came from are never the same value, so the two
     can never be confused for one another — in a report, a review, or a link. */
  constraint imported_deals_source_and_affiliate_differ
    check (affiliate_url = '' or source_url = '' or affiliate_url <> source_url),
  constraint imported_deals_gtin_shape
    check (gtin = '' or gtin ~ '^[0-9]{8,14}$'),
  constraint imported_deals_review_note_length
    check (char_length(review_note) <= 500),
  /* A matched record must name what it matched, and an unmatched one must not
     pretend to have. */
  constraint imported_deals_match_recorded
    check ((dedup_match_class in ('exact-match', 'probable-match', 'uncertain-match'))
           = (dedup_matched_deal_id is not null)),
  constraint imported_deals_no_self_match
    check (dedup_matched_deal_id is null or dedup_matched_deal_id <> id),
  /* Reviewer columns belong to a decision that was actually made. */
  constraint imported_deals_review_consistent
    check ((reviewed_by is null or review_status in ('approved', 'rejected', 'archived'))
           and (reviewed_at is null or reviewed_by is not null))
);

comment on table public.imported_deals is
  'One record imported from a source, with its provenance kept intact and its position in the pipeline recorded. Never published automatically; never read by a public page.';
comment on column public.imported_deals.source_url is
  'Where the product information came from. Provenance, not a link PickVanta is paid for.';
comment on column public.imported_deals.affiliate_url is
  'The tracked destination a buyer would be sent through. Never generated here, never written by a browser, and never the same value as source_url.';
comment on column public.imported_deals.pipeline_status is
  'Where this record sits: imported, validated, normalized, deduplicated, pending-review, approved or published — or terminated as rejected, archived or failed.';
comment on column public.imported_deals.published_deal_id is
  'The public record this import became, once a reviewer published it. public.deals (0001) stays the presentation model.';
comment on column public.imported_deals.imported_metadata is
  'The record exactly as the source returned it. Kept unchanged as evidence for review.';

-- Indexes: the lookups a pipeline, a review queue and a history view need.
-- (source_id, external_product_id) is also the source-identity guard: the same
-- product from the same source is one record, while the same product from a
-- different source stays a separate record with its own provenance.
create unique index if not exists imported_deals_source_external_key
  on public.imported_deals (source_id, external_product_id)
  where external_product_id <> '';
create index if not exists imported_deals_pipeline_status_idx
  on public.imported_deals (pipeline_status);
create index if not exists imported_deals_pending_review_idx
  on public.imported_deals (created_at desc)
  where pipeline_status = 'pending-review';
create index if not exists imported_deals_created_at_idx
  on public.imported_deals (created_at desc);
create index if not exists imported_deals_updated_at_idx
  on public.imported_deals (updated_at desc);
create index if not exists imported_deals_job_idx
  on public.imported_deals (job_id) where job_id is not null;
/* A future deterministic deduplication signal. Cheap to keep, and indexed
   before it is needed rather than after. */
create index if not exists imported_deals_gtin_idx
  on public.imported_deals (gtin) where gtin <> '';

-- ---------------------------------------------------------------------------
-- 5. imported_deal_media — references, not copies
-- ---------------------------------------------------------------------------
-- PickVanta points at the media the source hosts. It does not download a
-- merchant's assets: the reference, its order and its attribution are kept,
-- and a fallback reference can be recorded for when the source one stops
-- working. Nothing here fetches, proxies, resizes or health-checks anything.
create table if not exists public.imported_deal_media (
  id               uuid primary key default gen_random_uuid(),
  imported_deal_id uuid not null references public.imported_deals (id) on delete cascade,
  source_media_url text not null,
  media_type       text not null default 'image'
                   check (media_type in ('image', 'video', 'document')),
  sort_order       integer not null default 0 check (sort_order >= 0),
  attribution      text not null default '',
  fallback_url     text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint imported_deal_media_url_shape
    check (source_media_url ~* '^https?://[^[:space:]]+$'),
  constraint imported_deal_media_fallback_shape
    check (fallback_url = '' or fallback_url ~* '^https?://[^[:space:]]+$')
);

comment on table public.imported_deal_media is
  'References to media hosted by the source, with order and attribution. PickVanta does not download merchant assets; this table stores where an asset is, not a copy of it.';

create unique index if not exists imported_deal_media_order_key
  on public.imported_deal_media (imported_deal_id, sort_order);

-- ---------------------------------------------------------------------------
-- 6. deal_engine_events — what happened, append-only
-- ---------------------------------------------------------------------------
-- The traceability a review needs: when a record was imported, what validation
-- said, whether normalization changed anything, whether it matched something
-- already here, who approved it, and what went wrong on the way. An event is a
-- fact about the past, so it can be added and read but never rewritten.
create table if not exists public.deal_engine_events (
  id               uuid primary key default gen_random_uuid(),
  imported_deal_id uuid not null references public.imported_deals (id) on delete cascade,
  stage            text not null
                   check (stage in ('imported', 'validation', 'normalization',
                                    'deduplication', 'review', 'publish', 'error')),
  outcome          text not null default '',
  detail           text not null default '',
  data             jsonb not null default '{}'::jsonb,
  /* Who or what acted. Null means the engine itself; a person's id means a
     person decided. */
  actor_id         uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint deal_engine_events_data_object check (jsonb_typeof(data) = 'object')
);

comment on table public.deal_engine_events is
  'Append-only history of what happened to an imported record. Never rewritten or deleted — a consequence worth knowing: an imported record with history cannot be deleted at all, so it is archived instead.';

create or replace function public.deal_engine_events_append_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'A Deal Engine event records what happened; it is never rewritten or removed.';
end;
$$;

drop trigger if exists deal_engine_events_append_only on public.deal_engine_events;
create trigger deal_engine_events_append_only
  before update or delete on public.deal_engine_events
  for each row execute function public.deal_engine_events_append_only();

-- ---------------------------------------------------------------------------
-- 7. updated_at — the same trigger function 0001 defines
-- ---------------------------------------------------------------------------
drop trigger if exists deal_sources_set_updated_at on public.deal_sources;
create trigger deal_sources_set_updated_at
  before update on public.deal_sources
  for each row execute function public.set_updated_at();

drop trigger if exists external_merchants_set_updated_at on public.external_merchants;
create trigger external_merchants_set_updated_at
  before update on public.external_merchants
  for each row execute function public.set_updated_at();

drop trigger if exists deal_engine_jobs_set_updated_at on public.deal_engine_jobs;
create trigger deal_engine_jobs_set_updated_at
  before update on public.deal_engine_jobs
  for each row execute function public.set_updated_at();

drop trigger if exists imported_deals_set_updated_at on public.imported_deals;
create trigger imported_deals_set_updated_at
  before update on public.imported_deals
  for each row execute function public.set_updated_at();

drop trigger if exists imported_deal_media_set_updated_at on public.imported_deal_media;
create trigger imported_deal_media_set_updated_at
  before update on public.imported_deal_media
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Row Level Security — read by an administrator, written by nobody here
-- ---------------------------------------------------------------------------
alter table public.deal_sources          enable row level security;
alter table public.external_merchants    enable row level security;
alter table public.deal_engine_jobs      enable row level security;
alter table public.imported_deals        enable row level security;
alter table public.imported_deal_media   enable row level security;
alter table public.deal_engine_events    enable row level security;

-- Nothing by default: an anonymous visitor has no business here at all.
revoke all on public.deal_sources, public.external_merchants, public.deal_engine_jobs,
              public.imported_deals, public.imported_deal_media, public.deal_engine_events
  from anon, authenticated;

/* A signed-in administrator may read these records — the review queue, the
   import history and the provenance behind a published deal all need it. */
grant select on public.deal_sources, public.external_merchants, public.deal_engine_jobs,
                public.imported_deals, public.imported_deal_media, public.deal_engine_events
  to authenticated;

drop policy if exists deal_sources_select_admin on public.deal_sources;
create policy deal_sources_select_admin on public.deal_sources
  for select to authenticated
  using (public.is_admin());

drop policy if exists external_merchants_select_admin on public.external_merchants;
create policy external_merchants_select_admin on public.external_merchants
  for select to authenticated
  using (public.is_admin());

drop policy if exists deal_engine_jobs_select_admin on public.deal_engine_jobs;
create policy deal_engine_jobs_select_admin on public.deal_engine_jobs
  for select to authenticated
  using (public.is_admin());

drop policy if exists imported_deals_select_admin on public.imported_deals;
create policy imported_deals_select_admin on public.imported_deals
  for select to authenticated
  using (public.is_admin());

drop policy if exists imported_deal_media_select_admin on public.imported_deal_media;
create policy imported_deal_media_select_admin on public.imported_deal_media
  for select to authenticated
  using (public.is_admin());

drop policy if exists deal_engine_events_select_admin on public.deal_engine_events;
create policy deal_engine_events_select_admin on public.deal_engine_events
  for select to authenticated
  using (public.is_admin());

/* No INSERT, UPDATE or DELETE policy exists for any client role, on purpose.
   Imported data is untrusted input from outside PickVanta, so no browser is
   allowed to write it — not a visitor's, and not an administrator's. The
   pipeline will write through a server-side key, or through a function that
   validates what it is given, in the step that builds it. */

-- ---------------------------------------------------------------------------
-- 9. Self-check — fail the migration rather than leave a quiet hole
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  t text;
  entry text;
  pol text;
  /* table|its select policy — named explicitly, so a renamed policy is a
     failure here rather than a silently skipped check. */
  pairs text[] := array['deal_sources|deal_sources_select_admin',
                        'external_merchants|external_merchants_select_admin',
                        'deal_engine_jobs|deal_engine_jobs_select_admin',
                        'imported_deals|imported_deals_select_admin',
                        'imported_deal_media|imported_deal_media_select_admin',
                        'deal_engine_events|deal_engine_events_select_admin'];
begin
  foreach entry in array pairs loop
    t := split_part(entry, '|', 1);
    pol := split_part(entry, '|', 2);
    if to_regclass('public.' || t) is null then
      problems := problems || ('public.' || t || ' was not created');
      continue;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      problems := problems || ('RLS is not enabled on public.' || t);
    end if;
    if exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = t and grantee = 'anon'
    ) then
      problems := problems || ('anon holds a privilege on public.' || t);
    end if;
    if exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = t and grantee = 'authenticated'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) then
      problems := problems || ('authenticated can write public.' || t || ' directly');
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
        and policyname = pol and qual like '%is_admin%'
    ) then
      problems := problems || ('the admin select policy is missing on public.' || t);
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) then
      problems := problems || ('a write policy exists on public.' || t);
    end if;
  end loop;

  /* The two distinctions this migration exists to make structural. */
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.imported_deals'::regclass
      and conname = 'imported_deals_source_and_affiliate_differ'
  ) then
    problems := problems || 'source_url and affiliate_url are not kept apart';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.imported_deals'::regclass and conname = 'imported_deals_pipeline_status_check'
  ) then
    problems := problems || 'the pipeline vocabulary is not constrained on public.imported_deals';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deal_sources'::regclass and conname = 'deal_sources_config_no_secrets'
  ) then
    problems := problems || 'a credential-shaped source configuration key would be accepted';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.deal_engine_events'::regclass and tgname = 'deal_engine_events_append_only'
  ) then
    problems := problems || 'the event log is not append-only';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'deal_engine_events_append_only' and p.prosecdef is true
  ) then
    problems := problems || 'the append-only trigger runs with privileges it does not need';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name in ('external_merchants')
      and column_name in ('owner_id', 'profile_id', 'seller_id', 'account_id')
  ) then
    problems := problems || 'an external merchant points at a PickVanta account';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Deal Engine migration self-check failed: %', array_to_string(problems, '; ');
  end if;
  raise notice 'deal engine foundation: sources, imported deals, media, jobs and the event trail verified.';
end $$;
