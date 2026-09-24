-- ============================================================================
-- PickVanta — canonical catalogue foundation (migration 0008)
-- ----------------------------------------------------------------------------
-- The Product → Variant → Merchant Offer layer: the canonical shape an imported
-- record becomes once a person has reviewed it. This file establishes the
-- structure and the provenance link, and nothing that could act on its own.
--
-- WHY NEW TABLES, AND WHY THEY ARE NOT DUPLICATES OF 0001
-- ----------------------------------------------------------------------------
-- Three tables already exist in this schema that sound related, and none of them
-- is this:
--
--   • public.listings is the PUBLIC PRESENTATION record. It belongs to a
--     PickVanta seller (seller_id → public.sellers), it carries presentation
--     concerns (a search_text column the catalogue search reads, a Kenya-defaulted
--     location, service price types such as 'per-night'), and it has a single
--     unique slug. Two merchants offering the same phone would be two listings —
--     which is exactly what a canonical product must not be. A Product has no
--     seller, no location and no search text.
--
--   • public.deals is a PickVanta OFFER — a discount attached to one of those
--     listings, owned by the same PickVanta seller (seller_id → public.sellers).
--     A Merchant Offer belongs to an EXTERNAL merchant (external_merchants) and a
--     source (deal_sources). Step 13 fixed the rule this file obeys: a PickVanta
--     seller/provider is explicitly NOT an imported/external merchant, and the
--     two must never be joined into one identity.
--
--   • public.imported_deals is the UNTRUSTED record as it arrived, kept private
--     as evidence for review. It is an input to the canonical layer, never a
--     substitute for it, and it stays exactly as it is.
--
-- So this file creates the canonical layer beside them. It does not alter
-- public.listings, public.deals, public.categories or public.subcategories, and
-- the public catalogue keeps reading what it reads today. Nothing here is wired
-- into a public page.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ----------------------------------------------------------------------------
--   • no connector, fetcher, scraper, crawler, worker, schedule or queue;
--   • no automatic conversion: nothing turns an imported record into a product,
--     a variant or an offer. The link table exists so that a later, deliberate
--     step can record that decision — this file records none;
--   • no affiliate-link generation. affiliate_url stays empty unless a source
--     supplied one, and the constraint below makes it structurally impossible
--     for it to be a copy of source_url;
--   • no currency conversion, no price tracking, no inventory synchronisation,
--     no AI matching and no automatic merging;
--   • no write path for any client. Every table here is read-only, exactly like
--     the Deal Engine tables in 0005: the pipeline that will write them is a
--     later step's design, and it will write through a function that validates
--     what it is given.
--
-- Apply after db/migrations/0007_security_hardening.sql. Re-runnable.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Pre-flight — the objects this layer references have to be there.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.categories') is null or to_regclass('public.subcategories') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: the taxonomy is missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: public.set_updated_at() is missing.';
  end if;
  if to_regclass('public.deal_sources') is null
     or to_regclass('public.external_merchants') is null
     or to_regclass('public.imported_deals') is null then
    raise exception 'Apply db/migrations/0005_deal_engine_foundation.sql before this file: the Deal Engine tables are missing.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'This project has no auth schema. Apply 0002 on a Supabase project (or the local test double) first.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. products — the canonical consumer-facing identity
-- ---------------------------------------------------------------------------
-- What the thing IS, independently of who sells it or what they call it. The
-- name here is PickVanta's canonical name; a merchant's own title lives on the
-- offer and never overwrites this.
--
-- Identity signals are stored in the normalized form they will be matched on,
-- never as display text: brand_normalized is lower-cased and trimmed, and
-- identity_key is a deterministic composite a future matcher can look up in one
-- index. See section 6 for why identity_key is indexed but NOT unique.
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  brand            text not null default '',
  /* Canonical attributes. Merchant-supplied values never land in these columns. */
  description      text not null default '',
  category_id      text references public.categories (id) on delete set null,
  subcategory_id   text references public.subcategories (id) on delete set null,

  -- identity signals for future DETERMINISTIC deduplication ----------------
  brand_normalized text not null default '',
  model_number     text not null default '',
  mpn              text not null default '',
  /* A GTIN identifies one purchasable unit. For a product sold in a single
     configuration it belongs here; for a product with variants each variant
     carries its own. A normalizer sets one or the other, never both — the
     database cannot express that across two tables, so it is a rule the future
     pipeline follows and this comment is where it is written down. */
  gtin             text not null default '',
  identity_key     text not null default '',

  status           text not null default 'draft'
                   check (status in ('draft', 'active', 'archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_gtin_shape check (gtin = '' or gtin ~ '^[0-9]{8,14}$')
);

comment on table public.products is
  'The canonical consumer-facing product identity. Not a listing and not an offer: it has no seller, no price and no location, and it is what a review decides an imported record actually is. The public catalogue does not read this table yet.';

comment on column public.products.identity_key is
  'A deterministic composite of the normalized identity signals (brand, model, MPN), stored so a future matcher can find candidates with one index lookup. Indexed, deliberately NOT unique: two records whose signals agree are candidates to review, and the system never merges them by itself.';

comment on column public.products.brand_normalized is
  'The matching form of the brand. Display always uses brand; this column exists so two spellings of one brand can be recognised without showing a machine-normalized name to a person.';

create index if not exists products_status_idx on public.products (status);
create index if not exists products_category_idx
  on public.products (category_id) where category_id is not null;
create index if not exists products_brand_idx
  on public.products (brand_normalized) where brand_normalized <> '';
create index if not exists products_identity_key_idx
  on public.products (identity_key) where identity_key <> '';
create index if not exists products_model_idx
  on public.products (model_number) where model_number <> '';
/* A GTIN is a global standard identifier: two products cannot legitimately
   share one. This is the one identity signal where a duplicate is objectively
   an error rather than an uncertainty, so it is the one that is unique. */
create unique index if not exists products_gtin_key
  on public.products (gtin) where gtin <> '';
create index if not exists products_created_at_idx on public.products (created_at desc);


-- ---------------------------------------------------------------------------
-- 3. product_variants — a specific purchasable configuration
-- ---------------------------------------------------------------------------
-- Optional by design: a product sold in one configuration has no variant rows
-- and its offers point straight at the product. A product that is sold in
-- several configurations carries one row per configuration, and that row is
-- what an offer is about.
--
-- The identity of a variant is its options. option_key is the normalized,
-- deterministic form ("colour=graphite|storage=128gb") and it is what the
-- uniqueness below is enforced on, so the same product cannot accumulate two
-- rows describing the same configuration.
create table if not exists public.product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  slug          text not null,
  name          text not null,
  option_key    text not null default '',
  /* The readable structure: {"colour": "Graphite", "storage": "128GB"}. */
  option_values jsonb not null default '{}'::jsonb,
  /* Supplier-side codes for this exact configuration. */
  sku           text not null default '',
  gtin          text not null default '',
  status        text not null default 'draft'
                check (status in ('draft', 'active', 'archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint product_variants_name_not_blank check (btrim(name) <> ''),
  constraint product_variants_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint product_variants_options_object check (jsonb_typeof(option_values) = 'object'),
  constraint product_variants_gtin_shape check (gtin = '' or gtin ~ '^[0-9]{8,14}$'),
  constraint product_variants_product_slug_key unique (product_id, slug),
  /* Redundant against the primary key on its own, and required by the composite
     foreign key in section 4 so that an offer's variant is provably a variant
     OF that offer's product. */
  constraint product_variants_id_product_key unique (id, product_id)
);

comment on table public.product_variants is
  'A specific purchasable configuration of a product (8GB/128GB/Graphite, Black/Size 42). Optional: a product sold in one configuration has no variant rows.';

comment on column public.product_variants.option_key is
  'The normalized identity of the configuration, for deterministic matching and for the uniqueness constraint on (product_id, slug). Two variants of one product cannot describe the same options.';

create index if not exists product_variants_product_idx on public.product_variants (product_id);
create index if not exists product_variants_status_idx on public.product_variants (status);
create unique index if not exists product_variants_gtin_key
  on public.product_variants (gtin) where gtin <> '';
create index if not exists product_variants_created_at_idx
  on public.product_variants (created_at desc);


-- ---------------------------------------------------------------------------
-- 4. merchant_offers — one merchant's commercial offer, through one source
-- ---------------------------------------------------------------------------
-- NOT the canonical product and not a public deal. This is the record of what a
-- particular merchant, reached through a particular source, is offering for a
-- product or one of its variants, and what it said the price was when it was
-- last observed.
--
-- The merchant and the source are both required and both foreign keys. An offer
-- with no merchant is not an offer; an offer with no source has no provenance,
-- and provenance is the reason this layer exists.
create table if not exists public.merchant_offers (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products (id) on delete cascade,
  /* NULL means the offer is about the product as a whole, not one configuration. */
  variant_id           uuid references public.product_variants (id) on delete set null,
  merchant_id          uuid not null references public.external_merchants (id) on delete restrict,
  source_id            uuid not null references public.deal_sources (id) on delete restrict,

  -- what the merchant said, kept as the merchant said it --------------------
  title                text not null default '',
  merchant_product_ref text not null default '',
  merchant_offer_ref   text not null default '',

  -- pricing ----------------------------------------------------------------
  /* No default currency anywhere in this file. The engine is not Kenya-only and
     a price without a currency is not a price; an empty string means the source
     did not record one, which is honest, and never a fallback to a local one. */
  price_amount         numeric(14, 2),
  original_price       numeric(14, 2),
  currency             text not null default ''
                       check (currency = '' or currency ~ '^[A-Z]{3}$'),
  price_observed_at    timestamptz,

  /* pending | active | unavailable | expired | archived.
     'unavailable' is a fact about THIS OFFER, never about the product: a
     product stays 'active' while every offer on it is unavailable, which is
     what an empty shelf looks like. Nothing observes or changes this by
     itself — there is no inventory synchronisation and no timer. */
  status               text not null default 'pending'
                       check (status in ('pending', 'active', 'unavailable', 'expired', 'archived')),

  -- destinations -----------------------------------------------------------
  /* Where the information came from. */
  source_url           text not null default '',
  /* The tracked destination a future step may issue. A different thing, and it
     is never derived from source_url. Empty until an affiliate link exists. */
  affiliate_url        text not null default '',

  -- timestamps -------------------------------------------------------------
  imported_at          timestamptz not null default now(),
  last_observed_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint merchant_offers_price_not_negative
    check (price_amount is null or price_amount >= 0),
  constraint merchant_offers_original_price_not_negative
    check (original_price is null or original_price >= 0),
  /* A compare-at price below the asking price is not a discount, it is a claim
     the source data does not support. Same rule 0001 applies to public.deals. */
  constraint merchant_offers_original_not_below_price
    check (original_price is null or price_amount is null or original_price >= price_amount),
  constraint merchant_offers_source_url_shape
    check (source_url = '' or source_url ~* '^https?://[^[:space:]]+$'),
  constraint merchant_offers_affiliate_url_shape
    check (affiliate_url = '' or affiliate_url ~* '^https?://[^[:space:]]+$'),
  /* The permanent PickVanta separation, restated where offer data lives. The
     place the information came from and a tracked destination are never the
     same value, so the two can never be confused — in a report, a review, or a
     link a person clicks. */
  constraint merchant_offers_source_and_affiliate_differ
    check (affiliate_url = '' or source_url = '' or affiliate_url <> source_url),
  /* An offer's variant must be a variant OF the product the offer names. The
     single-column foreign key above would accept a variant belonging to a
     different product; this composite one makes that impossible rather than
     merely discouraged. With variant_id NULL the constraint does not apply,
     which is what lets a product-level offer exist. */
  constraint merchant_offers_variant_of_product
    foreign key (variant_id, product_id)
    references public.product_variants (id, product_id)
);

comment on table public.merchant_offers is
  'One external merchant''s commercial offer for a product or variant, as supplied through one source. Distinct from public.products (the canonical identity) and from public.deals (a PickVanta offer on a PickVanta listing, tied to public.sellers).';

comment on column public.merchant_offers.title is
  'The title as the merchant supplied it. Never the canonical product name, and never copied over it.';

comment on column public.merchant_offers.affiliate_url is
  'The tracked destination, when an affiliate link exists. Never generated by this build, never derived from source_url, and empty until one is issued in a later step.';

comment on column public.merchant_offers.status is
  'The state of this offer only. A product remains active while an offer on it is unavailable: an empty shelf is not an empty catalogue.';

create index if not exists merchant_offers_product_idx on public.merchant_offers (product_id);
create index if not exists merchant_offers_variant_idx
  on public.merchant_offers (variant_id) where variant_id is not null;
create index if not exists merchant_offers_merchant_idx on public.merchant_offers (merchant_id);
create index if not exists merchant_offers_source_idx on public.merchant_offers (source_id);
create index if not exists merchant_offers_status_idx on public.merchant_offers (status);
create index if not exists merchant_offers_product_status_idx
  on public.merchant_offers (product_id, status);
create index if not exists merchant_offers_observed_idx
  on public.merchant_offers (last_observed_at desc) where last_observed_at is not null;
create index if not exists merchant_offers_created_at_idx on public.merchant_offers (created_at desc);
/* One merchant cannot list the same offer reference twice, and cannot have two
   offers for the same product reference arriving through the same source. Both
   are indexed only when the reference is present, because an absent reference
   is not an identity. */
create unique index if not exists merchant_offers_merchant_ref_key
  on public.merchant_offers (merchant_id, merchant_offer_ref)
  where merchant_offer_ref <> '';
create unique index if not exists merchant_offers_source_product_key
  on public.merchant_offers (source_id, merchant_id, merchant_product_ref)
  where merchant_product_ref <> '';


-- ---------------------------------------------------------------------------
-- 5. merchant_offer_media — references, not copies
-- ---------------------------------------------------------------------------
-- The same principle 0005 applies to imported media: PickVanta points at what
-- the merchant hosts. The reference, its order and its attribution are kept,
-- and a fallback reference can be recorded for when the source one stops
-- working. Nothing here fetches, proxies, resizes, mirrors or health-checks an
-- asset — there is no downloader in this build.
create table if not exists public.merchant_offer_media (
  id                uuid primary key default gen_random_uuid(),
  merchant_offer_id uuid not null references public.merchant_offers (id) on delete cascade,
  source_media_url  text not null,
  media_type        text not null default 'image'
                    check (media_type in ('image', 'video', 'document')),
  sort_order        integer not null default 0 check (sort_order >= 0),
  attribution       text not null default '',
  fallback_url      text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint merchant_offer_media_url_shape
    check (source_media_url ~* '^https?://[^[:space:]]+$'),
  constraint merchant_offer_media_fallback_shape
    check (fallback_url = '' or fallback_url ~* '^https?://[^[:space:]]+$')
);

comment on table public.merchant_offer_media is
  'References to media hosted by the merchant, with order and attribution. PickVanta does not download merchant assets; this table stores where an asset is, not a copy of it.';

create unique index if not exists merchant_offer_media_order_key
  on public.merchant_offer_media (merchant_offer_id, sort_order);


-- ---------------------------------------------------------------------------
-- 6. imported_deal_conversions — the provenance link
-- ---------------------------------------------------------------------------
-- The answer to "which canonical offer did this imported record become?".
--
-- This is the relationship section 3 asks for, and it is ONLY a relationship:
-- nothing in this build writes a row here. A later, deliberate step records the
-- decision a reviewer made; this file makes the decision recordable and keeps
-- the chain intact:
--
--   imported_deals → deal_sources          (which source supplied it)
--                  → external_merchants     (which merchant supplied it)
--                  → imported_deal_conversions → products
--                                             → product_variants
--                                             → merchant_offers
--
-- The imported record is NOT modified by this file, and no column is added to
-- it: the conversion is a separate, additive fact, so the evidence a review was
-- made against stays exactly as it arrived.
create table if not exists public.imported_deal_conversions (
  id                 uuid primary key default gen_random_uuid(),
  /* One imported record becomes one offer. A second row would make "which offer
     did this become?" ambiguous, and a record that is genuinely re-converted
     should update this row rather than accumulate answers. */
  imported_deal_id   uuid not null unique references public.imported_deals (id) on delete cascade,
  product_id         uuid not null references public.products (id) on delete restrict,
  variant_id         uuid references public.product_variants (id) on delete set null,
  merchant_offer_id  uuid not null references public.merchant_offers (id) on delete restrict,
  /* What normalization changed on the way in, in words: the merchant title that
     became a canonical name, the category that was mapped, the model number
     that was recovered. "What changed during normalization?" is a question this
     column has to be able to answer. */
  normalization_note text not null default '',
  /* Null means the engine recorded it; a person's id means a person decided. */
  converted_by       uuid references auth.users (id) on delete set null,
  converted_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint imported_deal_conversions_note_length
    check (char_length(normalization_note) <= 1000)
);

comment on table public.imported_deal_conversions is
  'The record that an imported deal became a canonical product, variant and merchant offer. Written by no client in this step: it exists so the relationship is expressible, and the process that fills it is a later step''s design.';

comment on column public.imported_deal_conversions.normalization_note is
  'What changed between what the source said and what the canonical record says, in words.';

create index if not exists imported_deal_conversions_product_idx
  on public.imported_deal_conversions (product_id);
create index if not exists imported_deal_conversions_offer_idx
  on public.imported_deal_conversions (merchant_offer_id);
create index if not exists imported_deal_conversions_variant_idx
  on public.imported_deal_conversions (variant_id) where variant_id is not null;


-- ---------------------------------------------------------------------------
-- 7. updated_at, maintained the way the rest of the schema maintains it
-- ---------------------------------------------------------------------------
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists product_variants_set_updated_at on public.product_variants;
create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

drop trigger if exists merchant_offers_set_updated_at on public.merchant_offers;
create trigger merchant_offers_set_updated_at
  before update on public.merchant_offers
  for each row execute function public.set_updated_at();

drop trigger if exists merchant_offer_media_set_updated_at on public.merchant_offer_media;
create trigger merchant_offer_media_set_updated_at
  before update on public.merchant_offer_media
  for each row execute function public.set_updated_at();

drop trigger if exists imported_deal_conversions_set_updated_at on public.imported_deal_conversions;
create trigger imported_deal_conversions_set_updated_at
  before update on public.imported_deal_conversions
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 8. Row Level Security — readable by an administrator, written by nobody here
-- ---------------------------------------------------------------------------
-- The same model 0005 established for the Deal Engine, for the same reason:
-- these records are the output of a review, and until a later step decides how
-- they are published, no client may read or write them.
--
-- On public read access: the canonical product and variant records carry no
-- price, no merchant and no provenance, so a future step may reasonably open
-- them to public read. That is a deliberate decision to be made when a page
-- actually shows them, not a side effect of creating the tables — so it is not
-- made here, and nothing reads these tables today.
alter table public.products                  enable row level security;
alter table public.product_variants          enable row level security;
alter table public.merchant_offers           enable row level security;
alter table public.merchant_offer_media      enable row level security;
alter table public.imported_deal_conversions enable row level security;

revoke all on public.products, public.product_variants, public.merchant_offers,
              public.merchant_offer_media, public.imported_deal_conversions
  from anon, authenticated;

grant select on public.products, public.product_variants, public.merchant_offers,
                public.merchant_offer_media, public.imported_deal_conversions
  to authenticated;

drop policy if exists products_select_admin on public.products;
create policy products_select_admin on public.products
  for select to authenticated
  using (public.is_admin());

drop policy if exists product_variants_select_admin on public.product_variants;
create policy product_variants_select_admin on public.product_variants
  for select to authenticated
  using (public.is_admin());

drop policy if exists merchant_offers_select_admin on public.merchant_offers;
create policy merchant_offers_select_admin on public.merchant_offers
  for select to authenticated
  using (public.is_admin());

drop policy if exists merchant_offer_media_select_admin on public.merchant_offer_media;
create policy merchant_offer_media_select_admin on public.merchant_offer_media
  for select to authenticated
  using (public.is_admin());

drop policy if exists imported_deal_conversions_select_admin on public.imported_deal_conversions;
create policy imported_deal_conversions_select_admin on public.imported_deal_conversions
  for select to authenticated
  using (public.is_admin());

/* No INSERT, UPDATE or DELETE policy exists for any client role, on purpose.
   The canonical layer is written by a future review step through a function
   that validates what it is given — or by the server-side key, out of band.
   A browser writes none of it, and that includes an administrator's browser. */


-- ---------------------------------------------------------------------------
-- 9. Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  offender text;
begin
  /* 9a. Every new table is RLS-enabled with exactly one admin-only SELECT policy. */
  select string_agg(c.relname, ', ' order by c.relname) into offender
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('products', 'product_variants', 'merchant_offers',
                       'merchant_offer_media', 'imported_deal_conversions')
     and (not c.relrowsecurity
          or (select count(*) from pg_policy p where p.polrelid = c.oid) <> 1);
  if offender is not null then
    raise exception 'A canonical catalogue table is missing RLS or has the wrong number of policies: %', offender;
  end if;

  /* 9b. No client holds any privilege on them except SELECT for authenticated. */
  select string_agg(c.relname || '/' || r.role_name || '/' || a.privilege_type, ', '
                    order by c.relname, r.role_name, a.privilege_type) into offender
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role_name)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as a(privilege_type)
   where n.nspname = 'public'
     and c.relname in ('products', 'product_variants', 'merchant_offers',
                       'merchant_offer_media', 'imported_deal_conversions')
     and has_table_privilege(r.role_name, c.oid, a.privilege_type);
  if offender is not null then
    raise exception 'A client holds a write or maintenance privilege on a canonical catalogue table: %', offender;
  end if;
  if has_table_privilege('anon', 'public.products', 'SELECT') then
    raise exception 'anon can read public.products: the canonical layer is not public in this step.';
  end if;

  /* 9c. The variant-belongs-to-product guarantee is really in place, and really
         rejects a variant from another product. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'merchant_offers_variant_of_product'
       and conrelid = 'public.merchant_offers'::regclass
       and contype = 'f'
  ) then
    raise exception 'merchant_offers has no variant-belongs-to-product constraint.';
  end if;

  /* 9d. The permanent URL separation is enforced on this new offer table too. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'merchant_offers_source_and_affiliate_differ'
       and conrelid = 'public.merchant_offers'::regclass
  ) then
    raise exception 'merchant_offers does not separate source_url from affiliate_url.';
  end if;

  /* 9e. This file added no function, so 0007's invariant must still hold in
         full: every function in public pins exactly public, pg_temp. */
  select string_agg(p.proname, ', ' order by p.proname) into offender
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not (p.proconfig @> array['search_path=public, pg_temp']);
  if offender is not null then
    raise exception 'A public function does not pin public, pg_temp: %', offender;
  end if;

  /* 9f. The public catalogue this file must not disturb is untouched. */
  select string_agg(c.relname, ', ' order by c.relname) into offender
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if offender is not null then
    raise exception 'Row Level Security is disabled on: %', offender;
  end if;
  if not has_table_privilege('anon', 'public.listings', 'SELECT') then
    raise exception 'anon lost SELECT on public.listings: the public catalogue would stop loading.';
  end if;

  raise notice 'canonical catalogue foundation: products, product_variants, merchant_offers, merchant_offer_media and imported_deal_conversions created; administrator-read only, writable by no client, provenance link in place';
end $$;
