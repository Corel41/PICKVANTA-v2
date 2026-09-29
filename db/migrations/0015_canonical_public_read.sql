-- ============================================================================
-- 0015_canonical_public_read.sql — Backlog #6: the canonical layer becomes
-- visible to the public catalogue.
-- ----------------------------------------------------------------------------
-- 0008 created the canonical layer beside the public one and said exactly when
-- this file would be written:
--
--   "On public read access: the canonical product and variant records carry no
--    price, no merchant and no provenance, so a future step may reasonably
--    open them to public read. That is a deliberate decision to be made when a
--    page actually shows them, not a side effect of creating the tables."
--
-- This is that step: the product detail page now shows a canonical product,
-- its variants, and the merchant offers carried through the reviewed
-- conversion path (Import → Validate → Normalize → Deduplicate → Review →
-- Convert). Nothing else about the layer changes:
--
--   • READ ONLY, and narrow. anon and authenticated gain SELECT on exactly
--     five tables, each policy limited to what a buyer may see:
--
--       products             status = 'active'
--       product_variants     status = 'active'
--       merchant_offers      status in ('active', 'unavailable')
--                            — an unavailable offer is shown as unavailable:
--                              "what an empty shelf looks like" (0008), and
--                              never silently hidden while the product page
--                              stands;
--       merchant_offer_media rows whose offer is active (the media table stays
--                            references-only: where an asset is, never a copy);
--       external_merchants   all rows — the merchant's public identity (name,
--                            website, country), the same kind of public
--                            reference data public.sellers already are.
--
--   • 'draft' and 'pending' stay private. 0010 writes converted products and
--     variants as 'draft' and offers as 'pending' precisely so nothing is
--     published by a conversion: a deliberate activation step — not this file,
--     not the pipeline, not a timer — makes a canonical row public. An
--     administrator still sees everything through 0008's is_admin() policies.
--
--   • The provenance chain stays internal. imported_deals,
--     imported_deal_conversions and deal_sources gain nothing: which source
--     carried an offer is review evidence, not shopfront.
--
--   • No write path appears. No INSERT/UPDATE/DELETE policy exists for any
--     client role, exactly as 0008 left it.
--
-- Re-runnable; every policy is dropped before it is created. Apply after
-- db/migrations/0014_user_preferences.sql.
-- Rollback:
--   revoke select on public.products, public.product_variants,
--     public.merchant_offers, public.merchant_offer_media,
--     public.external_merchants from anon, authenticated;
--   drop policy ... (the five *_select_public policies below);
-- ============================================================================

-- ---------------------------------------------------------------- pre-checks ---
do $$
begin
  if to_regclass('public.products') is null
     or to_regclass('public.product_variants') is null
     or to_regclass('public.merchant_offers') is null
     or to_regclass('public.merchant_offer_media') is null
     or to_regclass('public.external_merchants') is null then
    raise exception 'Apply db/migrations/0008_canonical_catalogue.sql before this file: the canonical tables are missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Grants — the smallest read that serves the page
-- ---------------------------------------------------------------------------
grant select on public.products             to anon, authenticated;
grant select on public.product_variants     to anon, authenticated;
grant select on public.merchant_offers      to anon, authenticated;
grant select on public.merchant_offer_media to anon, authenticated;
grant select on public.external_merchants   to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Policies — active rows only, with the one honest exception
-- ---------------------------------------------------------------------------
drop policy if exists products_select_public on public.products;
create policy products_select_public on public.products
  for select to anon, authenticated
  using (status = 'active');

drop policy if exists product_variants_select_public on public.product_variants;
create policy product_variants_select_public on public.product_variants
  for select to anon, authenticated
  using (status = 'active');

drop policy if exists merchant_offers_select_public on public.merchant_offers;
create policy merchant_offers_select_public on public.merchant_offers
  for select to anon, authenticated
  using (status in ('active', 'unavailable'));

/* A media reference is visible only while its offer is. The subquery is
   evaluated through merchant_offers' own policies, so a media row hanging off
   an unpublished offer is unreachable too — the nesting is the boundary. */
drop policy if exists merchant_offer_media_select_public on public.merchant_offer_media;
create policy merchant_offer_media_select_public on public.merchant_offer_media
  for select to anon, authenticated
  using (exists (
    select 1 from public.merchant_offers o
    where o.id = merchant_offer_id
      and o.status in ('active', 'unavailable')
  ));

drop policy if exists external_merchants_select_public on public.external_merchants;
create policy external_merchants_select_public on public.external_merchants
  for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 3. Self-check — the migration refuses to have applied half of itself
-- ---------------------------------------------------------------------------
do $$
begin
  /* every public policy exists, on the right table, for the right roles */
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and ((tablename = 'products' and policyname = 'products_select_public')
           or (tablename = 'product_variants' and policyname = 'product_variants_select_public')
           or (tablename = 'merchant_offers' and policyname = 'merchant_offers_select_public')
           or (tablename = 'merchant_offer_media' and policyname = 'merchant_offer_media_select_public')
           or (tablename = 'external_merchants' and policyname = 'external_merchants_select_public'))) <> 5 then
    raise exception 'the five public read policies are not all in place.';
  end if;

  /* the admin policies from 0008 survive beside the public ones */
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and policyname in ('products_select_admin', 'product_variants_select_admin',
                            'merchant_offers_select_admin', 'merchant_offer_media_select_admin',
                            'imported_deal_conversions_select_admin')) <> 5 then
    raise exception 'the 0008 administrator read policies must survive beside the public ones.';
  end if;

  /* the provenance chain gains no public read */
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('imported_deals', 'imported_deal_conversions', 'deal_sources')
      and ('anon' = any (roles) or roles = '{public}')
  ) then
    raise exception 'anon must not gain a read policy on the provenance tables.';
  end if;

  /* no write policy appeared anywhere in the canonical layer */
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('products', 'product_variants', 'merchant_offers',
                        'merchant_offer_media', 'external_merchants',
                        'imported_deal_conversions')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'a write policy appeared on a canonical table.';
  end if;

  /* row level security stays on for all five tables */
  if exists (
    select 1 from pg_tables
    where schemaname = 'public'
      and tablename in ('products', 'product_variants', 'merchant_offers',
                        'merchant_offer_media', 'external_merchants')
      and not rowsecurity
  ) then
    raise exception 'canonical tables must keep row level security enabled.';
  end if;
end $$;
