-- ============================================================================
-- PickVanta — 0010: the reviewed conversion
--
-- Turns one imported record, sitting at PENDING REVIEW, into canonical
-- catalogue records, as an explicit decision by an administrator:
--
--   imported_deals ──→ products            (created, or an existing product)
--                  ──→ product_variants    (created, an existing one, or none)
--                  ──→ merchant_offers     (one offer, from the record's own
--                                           merchant, source and evidence)
--                  ──→ imported_deal_conversions  (the decision, recorded)
--                  ──→ pipeline/review state = approved
--                  ──→ one append-only deal_engine_event
--
-- This is the step 0008 wrote down as "a later step's design": the table that
-- records a conversion existed, with its keys, and nothing could write it.
--
-- WHAT IT IS NOT, and none of these exist anywhere in this file:
--
--   • no automatic matching of any kind — no fuzzy matching, no similarity
--     matching, no AI matching, no automatic product selection, and no
--     automatic merging. CREATE or USE EXISTING is an administrator's explicit
--     choice, carried in the call, and validated here;
--   • no automatic variant selection: none, create, or use an existing one, and
--     the variant has to belong to the product that was chosen;
--   • no publication of any kind. The conversion ends at 'approved' — 0005's
--     own meaning for the word is "reviewed and accepted, not yet public". No
--     public listing, no public deal, no public offer, no publish event;
--   • no write to public.listings and no write to public.deals;
--   • no affiliate-link generation, transformation or derivation. The offer's
--     affiliate_url is left empty; imported_deals.affiliate_url is not copied;
--     source_url is copied as provenance and stays a different column;
--   • no currency conversion: the recorded price and the recorded currency are
--     copied exactly as the source stated them, empty currency included;
--   • no availability inference, and no inventory synchronisation: the offer's
--     status is 'pending' and imported_availability is not mapped onto it;
--   • no media rows: nothing is carried into merchant_offer_media, and the
--     imported media evidence is untouched. Nothing is downloaded, proxied,
--     rewritten or copied;
--   • no normalisation engine and no matcher. brand_normalized, identity_key
--     and option_key keep their existing '' defaults — nothing in this step
--     compares two records. Those columns are what a future, deliberate
--     matching step would populate; a product's canonical fields come only
--     from what the administrator supplied in the call;
--   • no change to any table, column, policy, privilege or function that
--     already exists. 0001–0009 are untouched, and 0008's and 0009's own
--     self-checks stay true after this file runs.
--
-- ONE FUNCTION, ONE TRANSACTION. public.imported_deal_convert() is the only
-- object this file creates. It checks public.is_admin() for itself, locks the
-- imported record FOR UPDATE, validates everything, writes the canonical
-- records, records the decision, moves the reviewed record to approved and
-- appends one review event. Any failure raises, and the whole conversion rolls
-- back — there is no half-converted state to clean up.
--
-- The only statement this file makes that changes an imported record is the
-- one state transition 0005's model defines for it: pipeline_status and
-- review_status to 'approved', reviewed_by, reviewed_at and review_note. The
-- existing updated_at trigger moves updated_at. Everything else about the
-- record — what the source said, the normalised columns, the deduplication
-- columns, the metadata, the error column, published_deal_id — is left exactly
-- as it arrived.
--
-- A NOTE ON ENTRY STATE. A record must be at pipeline_status 'pending-review'
-- with review_status 'pending' before it can be converted: this file performs
-- the reviewed step PENDING REVIEW → APPROVED and nothing else, so it cannot
-- silently skip the stages before it, and it cannot convert a record that was
-- rejected, archived, failed or already published. Nothing in this build
-- advances a record to 'pending-review' yet — there is no connector and no
-- processor — so an operator sets that state deliberately, by hand, on the
-- records they mean to review. That is the honest arrangement while the
-- pipeline above this step does not exist.
--
-- Apply after db/migrations/0009_canonical_relationship_integrity.sql.
-- Re-runnable: it creates one function and sets its privileges.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Pre-flight — the objects this file depends on have to be there, and the
--    keys the conversion has to satisfy have to be the ones 0008/0009 built.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.imported_deals') is null
     or to_regclass('public.deal_engine_events') is null then
    raise exception 'Apply db/migrations/0005_deal_engine_foundation.sql before this file: the Deal Engine tables are missing.';
  end if;
  if to_regclass('public.products') is null
     or to_regclass('public.product_variants') is null
     or to_regclass('public.merchant_offers') is null
     or to_regclass('public.imported_deal_conversions') is null then
    raise exception 'Apply db/migrations/0008_canonical_catalogue.sql before this file: the canonical catalogue tables are missing.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;
  if to_regclass('public.categories') is null or to_regclass('public.subcategories') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: the taxonomy is missing.';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'This project has no auth schema. Apply 0002 on a Supabase project (or the local test double) first.';
  end if;

  /* 0009's five keys: without them a conversion could name an offer, a variant
     and a product that do not agree with one another. The conversion depends on
     every one of them, so this file refuses to install without them. */
  select coalesce(array_agg(want), '{}')
    into missing
    from unnest(array[
      'merchant_offers_id_product_key',
      'merchant_offers_id_variant_key',
      'imported_deal_conversions_variant_of_product',
      'imported_deal_conversions_offer_of_product',
      'imported_deal_conversions_offer_of_variant'
    ]) as want
   where not exists (
     select 1 from pg_constraint c
      where c.conname = want
        and c.conrelid in ('public.imported_deal_conversions'::regclass, 'public.merchant_offers'::regclass)
   );
  if array_length(missing, 1) is not null then
    raise exception 'Apply db/migrations/0009_canonical_relationship_integrity.sql before this file: missing %.',
      array_to_string(missing, ', ');
  end if;

  /* A conversion may only be recorded once per imported record. That is the
     unique key 0008 creates, and this file relies on it as the last line of
     defence against two reviewers converting the same record at once. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'imported_deal_conversions_imported_deal_id_key'
       and conrelid = 'public.imported_deal_conversions'::regclass
  ) then
    raise exception 'imported_deal_conversions is missing its unique key on imported_deal_id; 0008 has not been applied as written.';
  end if;

  /* The tables this function writes all have RLS enabled and no client write
     policy. If that ever changed, the function would be writing where a client
     could also write, so this file refuses rather than assume. */
  if exists (
    select 1 from pg_class c
     where c.oid in ('public.products'::regclass, 'public.product_variants'::regclass,
                     'public.merchant_offers'::regclass, 'public.imported_deal_conversions'::regclass,
                     'public.imported_deals'::regclass, 'public.deal_engine_events'::regclass)
       and not c.relrowsecurity
  ) then
    raise exception 'Row Level Security is disabled on a table this conversion writes: fix the schema before applying this file.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. The writer. One function, because a conversion is one decision: splitting
--    it would let a caller create a canonical product and then fail to record
--    what it was converted from, which is exactly the orphan this step must not
--    produce.
-- ---------------------------------------------------------------------------
create or replace function public.imported_deal_convert(
  p_imported_deal_id    uuid,
  p_product             jsonb,
  p_variant             jsonb,
  p_review_note         text default '',
  p_normalization_note  text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  /* The record under review, locked for the whole transaction. */
  v_deal          public.imported_deals;
  /* Canonical records, as the database returns them. */
  v_product       public.products;
  v_variant       public.product_variants;
  v_offer         public.merchant_offers;
  v_conversion    public.imported_deal_conversions;
  v_event_id      uuid;

  v_product_mode  text;
  v_variant_mode  text;

  /* Was each canonical record created here, or chosen? Recorded in the event
     and returned, so a reader never has to guess. */
  v_product_created boolean := false;
  v_variant_created boolean := false;

  v_uuid_shape    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_slug_shape    constant text := '^[a-z0-9]+(-[a-z0-9]+)*$';
  v_gtin_shape    constant text := '^[0-9]{8,14}$';

  v_text          text;
  v_uuid          uuid;
  v_gtin          text;
  v_name          text;
  v_slug          text;
  v_category      text;
  v_subcategory   text;
  v_options       jsonb;
  v_offenders     text[];
  v_review_note   text := coalesce(p_review_note, '');
  v_norm_note     text := coalesce(p_normalization_note, '');
begin
  /* ------------------------------------------------------------------------
     2a. Who is asking. The database decides: public.is_admin() reads the
     caller's own profile row and nothing the caller sent is consulted. A
     refusal says only that the caller is not an administrator.
     ------------------------------------------------------------------------ */
  if not public.is_admin() then
    raise exception 'Only an administrator can convert an imported record into canonical catalogue records'
      using errcode = '42501';
  end if;

  /* A conversion is a decision a person makes, and both the conversion row and
     the event have to name who made it. */
  if auth.uid() is null then
    raise exception 'A conversion is recorded against the person who decided it, and no signed-in user was found'
      using errcode = '42501';
  end if;

  /* ------------------------------------------------------------------------
     2b. The shape of the request. Everything below is validated before a
     single row is written.
     ------------------------------------------------------------------------ */
  if p_imported_deal_id is null then
    raise exception 'A conversion needs the imported record it is about' using errcode = '22023';
  end if;
  if p_product is null or jsonb_typeof(p_product) <> 'object' then
    raise exception 'The product argument must be an object naming a mode' using errcode = '22023';
  end if;
  if p_variant is null or jsonb_typeof(p_variant) <> 'object' then
    raise exception 'The variant argument must be an object naming a mode' using errcode = '22023';
  end if;
  if char_length(v_review_note) > 500 then
    raise exception 'The review note is longer than 500 characters' using errcode = '22001';
  end if;
  if char_length(v_norm_note) > 1000 then
    raise exception 'The normalization note is longer than 1000 characters' using errcode = '22001';
  end if;

  v_product_mode := p_product->>'mode';
  v_variant_mode := p_variant->>'mode';

  if v_product_mode is null or v_product_mode not in ('create', 'existing') then
    raise exception 'The product mode must be exactly ''create'' or ''existing''; it is the reviewer''s explicit choice'
      using errcode = '22023';
  end if;
  if v_variant_mode is null or v_variant_mode not in ('none', 'create', 'existing') then
    raise exception 'The variant mode must be exactly ''none'', ''create'' or ''existing''; it is the reviewer''s explicit choice'
      using errcode = '22023';
  end if;

  /* ------------------------------------------------------------------------
     2c. Lock the imported record first, and decide from what the database
     holds — not from what the caller believes is true. FOR UPDATE is what
     stops two reviewers converting the same record at the same time; 0008's
     unique key on imported_deal_id is the backstop behind it.
     ------------------------------------------------------------------------ */
  select * into v_deal
    from public.imported_deals
   where id = p_imported_deal_id
     for update;

  if not found then
    raise exception 'No imported record with that id' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.imported_deal_conversions c where c.imported_deal_id = v_deal.id) then
    raise exception 'That imported record has already been converted. One imported record becomes one offer, and the conversion that recorded it is not rewritten.'
      using errcode = '22023';
  end if;

  if v_deal.pipeline_status <> 'pending-review' or v_deal.review_status <> 'pending' then
    raise exception 'Only a record at pending review can be converted. This one is at pipeline status ''%'' and review status ''%''; the conversion records the step from pending review to approved, and does not perform the steps before it.',
      v_deal.pipeline_status, v_deal.review_status
      using errcode = '22023';
  end if;

  /* An offer needs a merchant, and the merchant is the one the record came
     from. The caller cannot supply one, so a record with no merchant recorded
     cannot be converted at all rather than gaining an invented one. */
  if v_deal.external_merchant_id is null then
    raise exception 'This imported record names no merchant, and a merchant offer cannot exist without one. Record the merchant the record came from, then convert it.'
      using errcode = '22023';
  end if;

  /* ------------------------------------------------------------------------
     2d. The product: created, or an existing one that is not touched.
     ------------------------------------------------------------------------ */
  if v_product_mode = 'create' then

    if nullif(btrim(coalesce(p_product->>'product_id', '')), '') is not null then
      raise exception 'Product mode ''create'' must not also name a product_id; choose one or the other'
        using errcode = '22023';
    end if;

    v_name := btrim(coalesce(p_product->>'name', ''));
    v_slug := btrim(coalesce(p_product->>'slug', ''));

    if v_name = '' then
      raise exception 'A new canonical product needs a name' using errcode = '22023';
    end if;
    if v_slug = '' then
      raise exception 'A new canonical product needs a slug' using errcode = '22023';
    end if;
    if v_slug !~ v_slug_shape then
      raise exception 'A product slug may contain only lower-case letters, digits and single hyphens (for example ''demo-phone-8-128'')'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.products p where p.slug = v_slug) then
      raise exception 'Another product already uses the slug ''%''. Canonical identity is never merged or suffixed automatically: choose the existing product, or a different slug.',
        v_slug
        using errcode = '23505';
    end if;

    /* The taxonomy, if the reviewer supplied one. Both columns may stay empty:
       a product whose category is not known yet is not a broken product.
       The schema does not tie a subcategory to its category, so when both are
       supplied that relationship is checked here. */
    v_category := nullif(btrim(coalesce(p_product->>'category_id', '')), '');
    v_subcategory := nullif(btrim(coalesce(p_product->>'subcategory_id', '')), '');
    if v_category is not null
       and not exists (select 1 from public.categories c where c.id = v_category) then
      raise exception 'No category with the id ''%''', v_category using errcode = 'P0002';
    end if;
    if v_subcategory is not null
       and not exists (select 1 from public.subcategories s where s.id = v_subcategory) then
      raise exception 'No subcategory with the id ''%''', v_subcategory using errcode = 'P0002';
    end if;
    if v_category is not null and v_subcategory is not null
       and not exists (
         select 1 from public.subcategories s
          where s.id = v_subcategory and s.category_id = v_category
       ) then
      raise exception 'The subcategory ''%'' does not belong to the category ''%''',
        v_subcategory, v_category
        using errcode = '22023';
    end if;

    /* 0008 states the rule and cannot express it: a GTIN belongs to the
       product when the product has no variants, and to the variant when it
       has. Both are refused here — the database would accept both. */
    v_gtin := nullif(btrim(coalesce(p_product->>'gtin', '')), '');
    if v_gtin is not null and v_gtin !~ v_gtin_shape then
      raise exception 'A GTIN is 8 to 14 digits, and nothing else' using errcode = '22023';
    end if;
    if v_gtin is not null and v_variant_mode <> 'none' then
      raise exception 'A product with variants carries no GTIN of its own: the GTIN belongs on the variant. This conversion names a variant.'
        using errcode = '22023';
    end if;
    if v_gtin is not null and exists (select 1 from public.products p where p.gtin = v_gtin) then
      raise exception 'Another product already carries the GTIN ''%''. A GTIN identifies one purchasable unit, so this is an error rather than an uncertainty, and nothing is merged automatically.',
        v_gtin
        using errcode = '23505';
    end if;

    /* Canonical fields come from the reviewed payload and nowhere else. The
       merchant's own words never land in these columns; brand_normalized and
       identity_key keep their defaults because nothing in this step matches. */
    insert into public.products
      (slug, name, brand, model_number, mpn, gtin, category_id, subcategory_id, status)
    values
      (v_slug,
       v_name,
       btrim(coalesce(p_product->>'brand', '')),
       btrim(coalesce(p_product->>'model_number', '')),
       btrim(coalesce(p_product->>'mpn', '')),
       coalesce(v_gtin, ''),
       v_category,
       v_subcategory,
       'draft')
    returning * into v_product;

    v_product_created := true;

  else

    /* Choosing an existing product writes nothing to it. A canonical identity
       is not an output of this step, and a reviewer selecting the wrong row
       must not be able to quietly rewrite one. */
    v_offenders := array[]::text[];
    if nullif(btrim(coalesce(p_product->>'name', '')), '') is not null then v_offenders := array_append(v_offenders, 'name'); end if;
    if nullif(btrim(coalesce(p_product->>'slug', '')), '') is not null then v_offenders := array_append(v_offenders, 'slug'); end if;
    if nullif(btrim(coalesce(p_product->>'brand', '')), '') is not null then v_offenders := array_append(v_offenders, 'brand'); end if;
    if nullif(btrim(coalesce(p_product->>'model_number', '')), '') is not null then v_offenders := array_append(v_offenders, 'model_number'); end if;
    if nullif(btrim(coalesce(p_product->>'mpn', '')), '') is not null then v_offenders := array_append(v_offenders, 'mpn'); end if;
    if nullif(btrim(coalesce(p_product->>'gtin', '')), '') is not null then v_offenders := array_append(v_offenders, 'gtin'); end if;
    if nullif(btrim(coalesce(p_product->>'category_id', '')), '') is not null then v_offenders := array_append(v_offenders, 'category_id'); end if;
    if nullif(btrim(coalesce(p_product->>'subcategory_id', '')), '') is not null then v_offenders := array_append(v_offenders, 'subcategory_id'); end if;
    if array_length(v_offenders, 1) is not null then
      raise exception 'Product mode ''existing'' must not send product fields: nothing on an existing product is overwritten. Remove: %',
        array_to_string(v_offenders, ', ')
        using errcode = '22023';
    end if;

    v_text := btrim(coalesce(p_product->>'product_id', ''));
    if v_text = '' then
      raise exception 'Product mode ''existing'' needs the product_id it refers to' using errcode = '22023';
    end if;
    if v_text !~* v_uuid_shape then
      raise exception 'product_id must be a uuid' using errcode = '22023';
    end if;
    v_uuid := v_text::uuid;

    select * into v_product
      from public.products
     where id = v_uuid
       for share;

    if not found then
      raise exception 'No product with that id. This step does not match records automatically: choose the product from the catalogue, or create a new one.'
        using errcode = 'P0002';
    end if;

    if v_product.status = 'archived' then
      raise exception 'That product is archived, and an archived product is not a target for a new offer'
        using errcode = '22023';
    end if;

    /* A product that already carries a GTIN is a product sold in a single
       configuration. Naming a variant for it would put a GTIN on the product
       and on a variant, which 0008 states must never happen. */
    if v_variant_mode <> 'none' and v_product.gtin <> '' then
      raise exception 'The product already carries the GTIN ''%'', so it is a single-configuration product and cannot gain a variant. Choose no variant, or a product without a GTIN.',
        v_product.gtin
        using errcode = '22023';
    end if;

  end if;

  /* ------------------------------------------------------------------------
     2e. The variant: none, created, or an existing one that is not touched.
     ------------------------------------------------------------------------ */
  if v_variant_mode = 'none' then

    v_offenders := array[]::text[];
    if nullif(btrim(coalesce(p_variant->>'variant_id', '')), '') is not null then v_offenders := array_append(v_offenders, 'variant_id'); end if;
    if nullif(btrim(coalesce(p_variant->>'name', '')), '') is not null then v_offenders := array_append(v_offenders, 'name'); end if;
    if nullif(btrim(coalesce(p_variant->>'slug', '')), '') is not null then v_offenders := array_append(v_offenders, 'slug'); end if;
    if nullif(btrim(coalesce(p_variant->>'sku', '')), '') is not null then v_offenders := array_append(v_offenders, 'sku'); end if;
    if nullif(btrim(coalesce(p_variant->>'gtin', '')), '') is not null then v_offenders := array_append(v_offenders, 'gtin'); end if;
    if p_variant ? 'option_values' and jsonb_typeof(p_variant->'option_values') <> 'null' then
      v_offenders := array_append(v_offenders, 'option_values');
    end if;
    if array_length(v_offenders, 1) is not null then
      raise exception 'Variant mode ''none'' describes a product-level offer and must not send variant fields. Remove: %',
        array_to_string(v_offenders, ', ')
        using errcode = '22023';
    end if;

  elsif v_variant_mode = 'create' then

    if nullif(btrim(coalesce(p_variant->>'variant_id', '')), '') is not null then
      raise exception 'Variant mode ''create'' must not also name a variant_id; choose one or the other'
        using errcode = '22023';
    end if;

    v_name := btrim(coalesce(p_variant->>'name', ''));
    v_slug := btrim(coalesce(p_variant->>'slug', ''));
    if v_name = '' then
      raise exception 'A new variant needs a name' using errcode = '22023';
    end if;
    if v_slug = '' then
      raise exception 'A new variant needs a slug' using errcode = '22023';
    end if;
    if v_slug !~ v_slug_shape then
      raise exception 'A variant slug may contain only lower-case letters, digits and single hyphens'
        using errcode = '22023';
    end if;
    if exists (
      select 1 from public.product_variants v
       where v.product_id = v_product.id and v.slug = v_slug
    ) then
      raise exception 'That product already has a variant with the slug ''%''', v_slug using errcode = '23505';
    end if;

    if p_variant ? 'option_values' then
      if jsonb_typeof(p_variant->'option_values') <> 'object' then
        raise exception 'option_values must be an object of option names and values (for example {"storage": "128GB"})'
          using errcode = '22023';
      end if;
      v_options := p_variant->'option_values';
    else
      v_options := '{}'::jsonb;
    end if;

    v_gtin := nullif(btrim(coalesce(p_variant->>'gtin', '')), '');
    if v_gtin is not null and v_gtin !~ v_gtin_shape then
      raise exception 'A GTIN is 8 to 14 digits, and nothing else' using errcode = '22023';
    end if;
    if v_gtin is not null and exists (select 1 from public.product_variants v where v.gtin = v_gtin) then
      raise exception 'Another variant already carries the GTIN ''%''. A GTIN identifies one purchasable unit, so this is an error rather than an uncertainty, and nothing is merged automatically.',
        v_gtin
        using errcode = '23505';
    end if;

    /* option_key keeps its default: it is the normalised identity a future
       matching step would write, and no matching happens here. */
    insert into public.product_variants
      (product_id, slug, name, option_values, sku, gtin, status)
    values
      (v_product.id,
       v_slug,
       v_name,
       v_options,
       btrim(coalesce(p_variant->>'sku', '')),
       coalesce(v_gtin, ''),
       'draft')
    returning * into v_variant;

    v_variant_created := true;

  else

    v_offenders := array[]::text[];
    if nullif(btrim(coalesce(p_variant->>'name', '')), '') is not null then v_offenders := array_append(v_offenders, 'name'); end if;
    if nullif(btrim(coalesce(p_variant->>'slug', '')), '') is not null then v_offenders := array_append(v_offenders, 'slug'); end if;
    if nullif(btrim(coalesce(p_variant->>'sku', '')), '') is not null then v_offenders := array_append(v_offenders, 'sku'); end if;
    if nullif(btrim(coalesce(p_variant->>'gtin', '')), '') is not null then v_offenders := array_append(v_offenders, 'gtin'); end if;
    if p_variant ? 'option_values' and jsonb_typeof(p_variant->'option_values') <> 'null' then
      v_offenders := array_append(v_offenders, 'option_values');
    end if;
    if array_length(v_offenders, 1) is not null then
      raise exception 'Variant mode ''existing'' must not send variant fields: nothing on an existing variant is overwritten. Remove: %',
        array_to_string(v_offenders, ', ')
        using errcode = '22023';
    end if;

    v_text := btrim(coalesce(p_variant->>'variant_id', ''));
    if v_text = '' then
      raise exception 'Variant mode ''existing'' needs the variant_id it refers to' using errcode = '22023';
    end if;
    if v_text !~* v_uuid_shape then
      raise exception 'variant_id must be a uuid' using errcode = '22023';
    end if;
    v_uuid := v_text::uuid;

    select * into v_variant
      from public.product_variants
     where id = v_uuid
       for share;

    if not found then
      raise exception 'No variant with that id' using errcode = 'P0002';
    end if;

    /* Checked here for a readable refusal; 0008's composite key
       merchant_offers_variant_of_product is what makes it impossible. */
    if v_variant.product_id <> v_product.id then
      raise exception 'That variant belongs to a different product. An offer''s variant must be a variant of the product the offer names.'
        using errcode = '22023';
    end if;

    if v_variant.status = 'archived' then
      raise exception 'That variant is archived, and an archived variant is not a target for a new offer'
        using errcode = '22023';
    end if;

  end if;

  /* ------------------------------------------------------------------------
     2f. The offer. Merchant, source and evidence come from the imported record
     itself — never from the caller, who cannot name a merchant here at all.
     ------------------------------------------------------------------------ */
  if v_deal.merchant_ref <> '' and exists (
    select 1 from public.merchant_offers o
     where o.merchant_id = v_deal.external_merchant_id
       and o.merchant_offer_ref = v_deal.merchant_ref
  ) then
    raise exception 'Another offer already records the merchant reference ''%'' for this merchant. Two offers cannot share one merchant reference.',
      v_deal.merchant_ref
      using errcode = '23505';
  end if;

  if v_deal.external_product_id <> '' and exists (
    select 1 from public.merchant_offers o
     where o.source_id = v_deal.source_id
       and o.merchant_id = v_deal.external_merchant_id
       and o.merchant_product_ref = v_deal.external_product_id
  ) then
    raise exception 'Another offer already records the product reference ''%'' for this source and merchant.',
      v_deal.external_product_id
      using errcode = '23505';
  end if;

  insert into public.merchant_offers
    (product_id, variant_id, merchant_id, source_id,
     title, merchant_product_ref, merchant_offer_ref,
     price_amount, currency, status, source_url, affiliate_url,
     price_observed_at, imported_at)
  values
    (v_product.id,
     v_variant.id,
     v_deal.external_merchant_id,
     v_deal.source_id,
     /* The merchant's own title, kept as the merchant supplied it. Never the
        canonical name, which lives only on the product. */
     v_deal.imported_title,
     v_deal.external_product_id,
     v_deal.merchant_ref,
     v_deal.imported_price,
     v_deal.imported_currency,
     /* Recorded, not published, and not a claim about the shelf: nothing here
        checked availability, so nothing claims it. */
     'pending',
     v_deal.source_url,
     /* Never set here. A tracked destination is a separate, later, explicit
        decision, and it is never derived from the source URL or from the
        imported record's own affiliate column. */
     '',
     v_deal.imported_at,
     v_deal.imported_at)
  returning * into v_offer;

  /* ------------------------------------------------------------------------
     2g. The decision, recorded — after every canonical record above exists and
     its relationships have been checked by the database itself. The row is a
     separate, additive fact: the imported record is never rewritten to become
     the offer.
     ------------------------------------------------------------------------ */
  insert into public.imported_deal_conversions
    (imported_deal_id, product_id, variant_id, merchant_offer_id,
     normalization_note, converted_by)
  values
    (v_deal.id, v_product.id, v_variant.id, v_offer.id,
     v_norm_note, auth.uid())
  returning * into v_conversion;

  /* ------------------------------------------------------------------------
     2h. The one state transition 0005 defines for the reviewed record:
     PENDING REVIEW → APPROVED, with who decided it and what they said. The
     updated_at trigger moves updated_at; nothing else about the record moves.
     ------------------------------------------------------------------------ */
  update public.imported_deals
     set pipeline_status = 'approved',
         review_status   = 'approved',
         reviewed_by     = auth.uid(),
         reviewed_at     = now(),
         review_note     = v_review_note
   where id = v_deal.id
   returning * into v_deal;

  /* ------------------------------------------------------------------------
     2i. One append-only event. It records the decision and the canonical
     records it produced, with the ids the database assigned. The merchant's
     own words stay out of it: detail is a sentence, not a place to paste
     untrusted text.
     ------------------------------------------------------------------------ */
  insert into public.deal_engine_events
    (imported_deal_id, stage, outcome, detail, data, actor_id)
  values
    (v_deal.id,
     'review',
     'approved',
     'An administrator converted this imported record into canonical catalogue records.',
     jsonb_build_object(
       'conversion_id',     v_conversion.id,
       'product_id',        v_product.id,
       'variant_id',        v_variant.id,
       'merchant_offer_id', v_offer.id,
       'product_mode',      case when v_product_created then 'created' else 'existing' end,
       'variant_mode',      case when v_variant.id is null then 'none'
                                 when v_variant_created then 'created'
                                 else 'existing' end
     ),
     auth.uid())
  returning id into v_event_id;

  /* ------------------------------------------------------------------------
     2j. What comes back is what the database holds, not what was asked for.
     ------------------------------------------------------------------------ */
  return jsonb_build_object(
    'conversion_id',   v_conversion.id,
    'imported_deal_id', v_deal.id,
    'product', jsonb_build_object(
      'id',     v_product.id,
      'slug',   v_product.slug,
      'name',   v_product.name,
      'mode',   case when v_product_created then 'created' else 'existing' end,
      'status', v_product.status
    ),
    'variant', case when v_variant.id is null then null else jsonb_build_object(
      'id',   v_variant.id,
      'slug', v_variant.slug,
      'name', v_variant.name,
      'mode', case when v_variant_created then 'created' else 'existing' end
    ) end,
    'merchant_offer', jsonb_build_object(
      'id',           v_offer.id,
      'title',        v_offer.title,
      'price_amount', v_offer.price_amount,
      'currency',     v_offer.currency,
      'status',       v_offer.status,
      'source_url',   v_offer.source_url
    ),
    'pipeline_status', v_deal.pipeline_status,
    'review_status',   v_deal.review_status,
    'converted_at',    v_conversion.converted_at
  );
end;
$$;

comment on function public.imported_deal_convert(uuid, jsonb, jsonb, text, text) is
  'The reviewed conversion: turns one imported record at pending review into a canonical product (created or chosen), an optional variant, one merchant offer built from the record''s own provenance, and the conversion row that records the decision — then moves the record to approved and appends one review event. Administrator only, one transaction, nothing published.';


-- ---------------------------------------------------------------------------
-- 3. Privileges. A signed-in administrator may call this one function; nobody
--    else may call anything, and no client role gains a table privilege. The
--    function runs as its owner to be able to write at all.
-- ---------------------------------------------------------------------------
revoke all on function public.imported_deal_convert(uuid, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.imported_deal_convert(uuid, jsonb, jsonb, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Self-check. A migration that creates a door should prove it is the only
--    one, that it is locked, and that whoever holds the key is able to open it.
-- ---------------------------------------------------------------------------
do $$
declare
  fn           regprocedure := to_regprocedure('public.imported_deal_convert(uuid, jsonb, jsonb, text, text)');
  fn_owner     oid;
  table_owner  oid;
  t            text;
  bad          text[] := '{}';
  offender     text;
  is_definer   boolean;
begin
  if fn is null then
    raise exception 'public.imported_deal_convert() was not created.';
  end if;

  /* The authorization gate is a security definer function, or it cannot read
     the caller's profile row, and a pinned search path, or a caller could
     influence how names inside it resolve. */
  select p.prosecdef, p.proowner into is_definer, fn_owner
    from pg_proc p where p.oid = fn;
  if is_definer is not true then
    raise exception 'imported_deal_convert must be security definer.';
  end if;

  if (select p.proconfig from pg_proc p where p.oid = fn)
     is distinct from array['search_path=public, pg_temp']::text[] then
    raise exception 'imported_deal_convert must pin exactly search_path = public, pg_temp; it pins %.',
      (select coalesce(array_to_string(p.proconfig, ', '), '(nothing)') from pg_proc p where p.oid = fn);
  end if;

  /* It writes tables it does not own unless it is owned by the same role that
     applied 0001–0009. A function owned by a role with no USAGE on schema
     public, or no privilege on these tables, would fail at the first write —
     loudly, but later, and in front of an operator. Refuse here instead. */
  foreach t in array array['products', 'product_variants', 'merchant_offers',
                           'imported_deal_conversions', 'imported_deals', 'deal_engine_events']
  loop
    select c.relowner into table_owner from pg_class c where c.oid = ('public.' || t)::regclass;
    if table_owner is distinct from fn_owner then
      bad := array_append(bad, format('%s is owned by %s, not by the function''s owner %s', t, pg_get_userbyid(table_owner), pg_get_userbyid(fn_owner)));
    end if;
  end loop;
  if not has_schema_privilege(fn_owner, 'public', 'USAGE') then
    bad := array_append(bad, format('%s has no USAGE on schema public', pg_get_userbyid(fn_owner)));
  end if;
  if array_length(bad, 1) is not null then
    raise exception E'imported_deal_convert() could not write what it is for:\n  %',
      array_to_string(bad, E'\n  ');
  end if;

  /* Exactly one caller may reach it: a signed-in account. Anonymous visitors
     get nothing, and PUBLIC gets nothing, even if a later grant were added by
     accident. */
  if not has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception 'authenticated cannot execute imported_deal_convert.';
  end if;
  if has_function_privilege('anon', fn, 'EXECUTE') then
    raise exception 'anon can execute imported_deal_convert.';
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid = fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute imported_deal_convert.';
  end if;

  /* And no client role holds a write privilege on anything it writes: the
     canonical layer stays read-only to every client, administrator included,
     exactly as 0008 made it. */
  foreach t in array array['products', 'product_variants', 'merchant_offers',
                           'imported_deal_conversions', 'imported_deals', 'deal_engine_events']
  loop
    foreach offender in array array['anon', 'authenticated']
    loop
      if has_table_privilege(offender, 'public.' || t, 'INSERT')
         or has_table_privilege(offender, 'public.' || t, 'UPDATE')
         or has_table_privilege(offender, 'public.' || t, 'DELETE')
         or has_table_privilege(offender, 'public.' || t, 'TRUNCATE') then
        bad := array_append(bad, format('%s holds a write privilege on %s', offender, t));
      end if;
    end loop;
  end loop;
  if array_length(bad, 1) is not null then
    raise exception E'A client can write what this step is supposed to make write-once:\n  %',
      array_to_string(bad, E'\n  ');
  end if;
end $$;
