-- ============================================================================
-- PickVanta — catalogue schema (Step 8, migration 0001)
-- ----------------------------------------------------------------------------
-- Supabase / PostgreSQL. Implements the Step 7 domain model relationally:
--   categories ──< subcategories ──< listings ──< deals
--                                      │  └── sellers
--                                      └──< guide_listings >── guides
--
-- Design notes
--   • Ids are the stable text ids the domain model already uses (for example
--     'phone-zenith-x6-pro'); nothing is generated per load, so a frontend link
--     never depends on a row order.
--   • Structured but bounded data (specifications, images, sections, service
--     areas, tags) uses jsonb / text[] where a join table would add no value.
--     A listing is NOT one json blob: every searchable, filterable or joinable
--     value is a real column.
--   • Public read only. Every table has RLS enabled and a single SELECT policy
--     limited to published rows; there are no insert/update/delete policies for
--     anonymous or authenticated roles, so writes are denied by default.
--   • Apply with the Supabase SQL editor, `supabase db push`, or psql:
--       psql "$DATABASE_URL" -f db/migrations/0001_catalogue.sql
--     The seed (db/seed/0001_catalogue.sql) is applied the same way, after it.
-- ============================================================================

-- ---------------------------------------------------------------- helpers ---
-- Keeps updated_at honest for anything written later (seller tools, admin).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. categories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id          text primary key,
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  icon        text not null default '',
  position    integer not null default 0,
  status      text not null default 'published'
              check (status in ('draft', 'published', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists categories_status_position_idx
  on public.categories (status, position);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. subcategories — every subcategory belongs to exactly one category
-- ---------------------------------------------------------------------------
create table if not exists public.subcategories (
  id          text primary key,
  category_id text not null references public.categories (id) on delete cascade,
  slug        text not null,
  name        text not null,
  position    integer not null default 0,
  status      text not null default 'published'
              check (status in ('draft', 'published', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint subcategories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint subcategories_name_not_blank check (length(btrim(name)) > 0),
  -- a slug is unique inside its category (two categories may both have "Other")
  constraint subcategories_category_slug_key unique (category_id, slug)
);

create index if not exists subcategories_category_position_idx
  on public.subcategories (category_id, position);

drop trigger if exists subcategories_set_updated_at on public.subcategories;
create trigger subcategories_set_updated_at
  before update on public.subcategories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. sellers / providers — demo providers, no accounts, no ratings
-- ---------------------------------------------------------------------------
create table if not exists public.sellers (
  id                  text primary key,
  slug                text not null unique,
  name                text not null,
  type                text not null default 'seller'
                      check (type in ('brand-store', 'retailer', 'provider',
                                      'service-provider', 'host', 'seller')),
  description         text not null default '',
  country             text not null default 'Kenya',
  county              text not null default '',
  city                text not null default '',
  area                text not null default '',
  website             text,
  contact_email       text,
  contact_phone       text,
  verification_status text not null default 'unverified'
                      check (verification_status in ('unverified', 'demo-verified')),
  status              text not null default 'published'
                      check (status in ('draft', 'published', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sellers_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists sellers_status_idx on public.sellers (status);
create index if not exists sellers_city_idx on public.sellers (city);

drop trigger if exists sellers_set_updated_at on public.sellers;
create trigger sellers_set_updated_at
  before update on public.sellers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. listings — the central, discoverable entity
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id                text primary key,
  seller_id         text references public.sellers (id) on delete set null,
  category_id       text not null references public.categories (id) on delete restrict,
  subcategory_id    text references public.subcategories (id) on delete set null,

  -- 'product' | 'service' is data, never inferred from other columns
  type              text not null check (type in ('product', 'service')),

  name              text not null,
  slug              text not null unique,
  short_description text not null default '',
  description       text not null default '',
  brand             text not null default '',

  -- structured money: numbers plus a currency code, never a formatted string
  price_amount      numeric(12, 2),
  price_min         numeric(12, 2),
  price_max         numeric(12, 2),
  currency          char(3) not null default 'KES',
  price_type        text not null default 'fixed'
                    check (price_type in ('fixed', 'range', 'starting-from', 'quote',
                                          'per-item', 'per-person', 'per-hour', 'per-day',
                                          'per-night', 'per-week', 'per-month', 'per-year',
                                          'per-session', 'per-lesson', 'per-visit', 'per-package')),
  reference_price   numeric(12, 2),

  -- the listing's own place (Kenya-focused demo catalogue) + where it serves
  location_country  text not null default 'Kenya',
  location_county   text not null default '',
  location_city     text not null default '',
  location_area     text not null default '',
  location_format   text not null default 'local'
                    check (location_format in ('local', 'nationwide', 'online', 'unspecified')),
  service_area      text[] not null default '{}',

  availability      text not null default 'available'
                    check (availability in ('available', 'limited', 'by-appointment',
                                            'on-request', 'unavailable')),

  highlights        text[] not null default '{}',
  tags              text[] not null default '{}',
  specifications    jsonb not null default '[]'::jsonb,
  images            jsonb not null default '[]'::jsonb,

  status            text not null default 'published'
                    check (status in ('draft', 'published', 'archived')),

  -- one text column that mirrors the fields the catalogue search reads; kept in
  -- sync by trigger so search never has to scan jsonb at query time
  search_text       text not null default '',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint listings_name_not_blank check (length(btrim(name)) > 0),
  constraint listings_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint listings_money_present check (
    price_type = 'quote'
    or price_amount is not null
    or (price_min is not null and price_max is not null)
  ),
  constraint listings_price_range_ordered check (
    price_min is null or price_max is null or price_min <= price_max
  ),
  constraint listings_money_non_negative check (
    (price_amount is null or price_amount >= 0)
    and (price_min is null or price_min >= 0)
    and (price_max is null or price_max >= 0)
    and (reference_price is null or reference_price >= 0)
  )
);

create index if not exists listings_status_idx on public.listings (status);
create index if not exists listings_category_idx on public.listings (category_id, status);
create index if not exists listings_subcategory_idx on public.listings (subcategory_id, status);
create index if not exists listings_seller_idx on public.listings (seller_id);
create index if not exists listings_type_idx on public.listings (type);
create index if not exists listings_availability_idx on public.listings (availability);
create index if not exists listings_city_idx on public.listings (location_city);
create index if not exists listings_created_idx on public.listings (created_at desc);
create index if not exists listings_price_idx on public.listings (price_amount);
create index if not exists listings_tags_idx on public.listings using gin (tags);
create index if not exists listings_service_area_idx on public.listings using gin (service_area);

-- Search index. pg_trgm is available on Supabase; if it cannot be enabled the
-- column and the queries still work, just without the index speed-up.
do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm unavailable: search_text index skipped (search still works)';
end;
$$;

do $$
begin
  create index if not exists listings_search_trgm_idx
    on public.listings using gin (search_text gin_trgm_ops);
exception when others then
  raise notice 'trigram index skipped';
end;
$$;

-- Keep search_text in step with the row it describes. The columns mirror the
-- fields the interface searches over: the listing's own text, its tags and
-- specifications, its location, and the names of the taxonomy and provider it
-- references (so "laptops" or a provider name find the listing in the
-- database exactly as they do over the bundled demonstration catalogue).
-- Renaming a category, subcategory or seller does not fire this trigger for the
-- listings that point at it: re-run db/seed/0001_catalogue.sql afterwards to
-- refresh the maintained text.
create or replace function public.listings_refresh_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text = lower(concat_ws(' ',
    new.name,
    new.brand,
    new.short_description,
    new.description,
    array_to_string(new.tags, ' '),
    new.location_city,
    new.location_county,
    new.location_area,
    array_to_string(new.service_area, ' '),
    coalesce((select c.name from public.categories c where c.id = new.category_id), ''),
    coalesce((select sc.name from public.subcategories sc where sc.id = new.subcategory_id), ''),
    coalesce((select se.name from public.sellers se where se.id = new.seller_id), ''),
    coalesce((select string_agg(s.value, ' ') from jsonb_to_recordset(new.specifications) as s(label text, value text)), '')
  ));
  return new;
end;
$$;

drop trigger if exists listings_search_text_trigger on public.listings;
create trigger listings_search_text_trigger
  before insert or update of name, brand, short_description, description, tags,
    location_city, location_county, service_area, specifications
  on public.listings
  for each row execute function public.listings_refresh_search_text();

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. deals — always attached to a listing, never a product of its own
-- ---------------------------------------------------------------------------
create table if not exists public.deals (
  id               text primary key,
  listing_id       text not null references public.listings (id) on delete cascade,
  seller_id        text references public.sellers (id) on delete set null,
  title            text not null default '',
  description      text not null default '',
  deal_type        text not null default 'percentage'
                   check (deal_type in ('percentage', 'fixed-price', 'package',
                                        'bundle', 'limited', 'billing', 'introductory')),
  original_price   numeric(12, 2),
  deal_price       numeric(12, 2),
  discount_percent numeric(5, 2),
  currency         char(3) not null default 'KES',
  starts_at        date,
  ends_at          date,
  availability     text not null default 'available'
                   check (availability in ('available', 'limited', 'by-appointment',
                                           'on-request', 'unavailable')),
  status           text not null default 'active'
                   check (status in ('scheduled', 'active', 'ended', 'withdrawn')),
  conditions       text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint deals_price_ordered check (
    original_price is null or deal_price is null or deal_price <= original_price
  ),
  constraint deals_dates_ordered check (
    starts_at is null or ends_at is null or starts_at <= ends_at
  )
);

create index if not exists deals_listing_idx on public.deals (listing_id);
create index if not exists deals_status_idx on public.deals (status);
create index if not exists deals_ends_at_idx on public.deals (ends_at);

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. guides — decision support, never advertisements
-- ---------------------------------------------------------------------------
create table if not exists public.guides (
  id          text primary key,
  slug        text not null unique,
  title       text not null,
  category_id text references public.categories (id) on delete set null,
  question    text not null default '',
  summary     text not null default '',
  content     jsonb not null default '[]'::jsonb,   -- ordered outline sections
  tags        text[] not null default '{}',
  icon        text not null default '',
  level       text not null default '',
  read_time   text not null default '',
  cta         jsonb,
  status      text not null default 'published'
              check (status in ('draft', 'published', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint guides_title_not_blank check (length(btrim(title)) > 0)
);

create index if not exists guides_status_idx on public.guides (status);
create index if not exists guides_category_idx on public.guides (category_id);
create index if not exists guides_tags_idx on public.guides using gin (tags);

drop trigger if exists guides_set_updated_at on public.guides;
create trigger guides_set_updated_at
  before update on public.guides
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. guide_listings — many guides may reference many listings
-- ---------------------------------------------------------------------------
create table if not exists public.guide_listings (
  guide_id   text not null references public.guides (id) on delete cascade,
  listing_id text not null references public.listings (id) on delete cascade,
  position   integer not null default 0,
  primary key (guide_id, listing_id)
);

create index if not exists guide_listings_listing_idx
  on public.guide_listings (listing_id);

-- ---------------------------------------------------------------------------
-- 8. catalogue_settings — small key/value configuration the frontend reads
--    (price bands, sort options, compare groups, curated home selections).
--    Configuration only: no catalogue records live here.
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9. Row Level Security — public read of published catalogue data only
-- ---------------------------------------------------------------------------
alter table public.categories         enable row level security;
alter table public.subcategories      enable row level security;
alter table public.sellers            enable row level security;
alter table public.listings           enable row level security;
alter table public.deals              enable row level security;
alter table public.guides             enable row level security;
alter table public.guide_listings     enable row level security;
alter table public.catalogue_settings enable row level security;

-- Drop first so the migration can be re-applied to an existing project.
drop policy if exists categories_public_read on public.categories;
drop policy if exists subcategories_public_read on public.subcategories;
drop policy if exists sellers_public_read on public.sellers;
drop policy if exists listings_public_read on public.listings;
drop policy if exists deals_public_read on public.deals;
drop policy if exists guides_public_read on public.guides;
drop policy if exists guide_listings_public_read on public.guide_listings;
drop policy if exists catalogue_settings_public_read on public.catalogue_settings;

-- Read: an anonymous visitor sees published rows only. Draft and archived rows
-- are never returned by the API, not just filtered out by the browser.
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (status = 'published');

create policy subcategories_public_read on public.subcategories
  for select to anon, authenticated
  using (status = 'published'
         and exists (select 1 from public.categories c
                     where c.id = subcategories.category_id and c.status = 'published'));

create policy sellers_public_read on public.sellers
  for select to anon, authenticated
  using (status = 'published');

create policy listings_public_read on public.listings
  for select to anon, authenticated
  using (status = 'published'
         and exists (select 1 from public.categories c
                     where c.id = listings.category_id and c.status = 'published'));

-- A deal is public only while it is live and its listing is published.
create policy deals_public_read on public.deals
  for select to anon, authenticated
  using (status in ('scheduled', 'active')
         and exists (select 1 from public.listings l
                     where l.id = deals.listing_id and l.status = 'published'));

create policy guides_public_read on public.guides
  for select to anon, authenticated
  using (status = 'published');

create policy guide_listings_public_read on public.guide_listings
  for select to anon, authenticated
  using (exists (select 1 from public.guides g
                 where g.id = guide_listings.guide_id and g.status = 'published'));

create policy catalogue_settings_public_read on public.catalogue_settings
  for select to anon, authenticated
  using (true);

-- No insert / update / delete policies exist on any table: with RLS enabled and
-- no policy for those commands, writes are refused for anonymous and for signed
-- in users until a later step adds seller tools with their own policies.

-- Defence in depth: make sure the public roles cannot write even if a future
-- default privilege or policy is added by mistake.
revoke insert, update, delete, truncate on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 10. Read-only helper functions
--     The frontend needs tag counts, catalogue totals and the values actually
--     in use (which subcategories and cities have published listings). Doing
--     that with small aggregate functions keeps every page to one request
--     instead of downloading rows to count them in the browser.
--     Both are SECURITY INVOKER, so Row Level Security applies to the caller
--     exactly as it does to a direct select.
-- ---------------------------------------------------------------------------
create or replace function public.catalogue_stats()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'listings',      (select count(*) from public.listings where status = 'published'),
    'products',      (select count(*) from public.listings where status = 'published' and type = 'product'),
    'services',      (select count(*) from public.listings where status = 'published' and type = 'service'),
    'categories',    (select count(*) from public.categories where status = 'published'),
    'subcategories', (select count(distinct subcategory_id) from public.listings
                      where status = 'published' and subcategory_id is not null),
    'sellers',       (select count(distinct seller_id) from public.listings
                      where status = 'published' and seller_id is not null),
    'guides',        (select count(*) from public.guides where status = 'published'),
    'offers',        (select count(*) from public.deals where status in ('scheduled', 'active')),
    'tags',          (select count(distinct tag) from public.listings, unnest(tags) as tag
                      where status = 'published'),
    'subcategoryIds', (select coalesce(jsonb_agg(distinct subcategory_id), '[]'::jsonb)
                       from public.listings
                       where status = 'published' and subcategory_id is not null),
    'locationCities', (select coalesce(jsonb_agg(distinct location_city), '[]'::jsonb)
                       from public.listings
                       where status = 'published' and location_city <> '')
  );
$$;

create or replace function public.catalogue_tags()
returns table (tag text, listings bigint)
language sql
stable
as $$
  select t.tag, count(*) as listings
  from public.listings l, unnest(l.tags) as t(tag)
  where l.status = 'published'
  group by t.tag
  order by count(*) desc, t.tag asc;
$$;

-- Filter-panel counts, so a page never has to download rows to count them.
create or replace function public.catalogue_facets()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_object_agg(category_id, n) from
      (select category_id, count(*) as n from public.listings where status = 'published' group by category_id) c), '{}'::jsonb),
    'subcategories', coalesce((select jsonb_object_agg(subcategory_id, n) from
      (select subcategory_id, count(*) as n from public.listings where status = 'published' group by subcategory_id) sc), '{}'::jsonb),
    'types', coalesce((select jsonb_object_agg(type, n) from
      (select type, count(*) as n from public.listings where status = 'published' group by type) t), '{}'::jsonb),
    'availability', coalesce((select jsonb_object_agg(availability, n) from
      (select availability, count(*) as n from public.listings where status = 'published' group by availability) a), '{}'::jsonb)
  );
$$;

grant execute on function public.catalogue_facets() to anon, authenticated;
grant execute on function public.catalogue_stats() to anon, authenticated;
grant execute on function public.catalogue_tags() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Grants — the anonymous role may read the public catalogue
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.categories, public.subcategories, public.sellers, public.listings,
  public.deals, public.guides, public.guide_listings, public.catalogue_settings
  to anon, authenticated;
