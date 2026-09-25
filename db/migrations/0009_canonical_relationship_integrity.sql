-- ============================================================================
-- PickVanta — canonical catalogue relationship integrity (migration 0009)
-- ----------------------------------------------------------------------------
-- Step 15 created the four records of the canonical chain and the link that
-- records a conversion:
--
--     Imported Deal → Product → Variant → Merchant Offer
--                        └────── imported_deal_conversions ──────┘
--
-- It enforced the chain on the OFFER side: 0008's composite foreign key
-- `merchant_offers_variant_of_product` makes it impossible for an offer to name
-- a variant that belongs to a different product. It did not enforce it on the
-- CONVERSION side, and that is the gap this file closes.
--
-- ----------------------------------------------------------------------------
-- THE GAP, MEASURED
-- ----------------------------------------------------------------------------
-- `imported_deal_conversions` had three INDEPENDENT foreign keys — product_id,
-- variant_id, merchant_offer_id — each individually satisfied by any row of the
-- right type. Nothing tied them to each other, so all of these were accepted by
-- the database (each was confirmed against a real PostgreSQL 16 before this file
-- was written):
--
--   • Product A + a variant belonging to Product B
--   • Product A + the offer of Product B
--   • Product A + an offer that is for a variant of Product B
--
-- A conversion that says "this imported record became Product A, via the
-- configuration of Product B, and the offer I published belongs to Product C"
-- is not a provenance record at all: it is three unrelated facts in one row, and
-- the two questions this table exists to answer — which offer did this become,
-- and which product was that offer for — would have contradictory answers.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS FILE DOES
-- ----------------------------------------------------------------------------
-- The same technique 0008 used one step further down the chain: establish the
-- uniqueness a composite key needs, then let a composite foreign key do the
-- work, so PostgreSQL itself refuses a mismatched relationship. No trigger, no
-- function, no application check: three declarative keys on the conversion and
-- the two uniqueness keys they need on the offer.
--
--   1. merchant_offers (id, product_id) unique    — lets a conversion name one
--      specific offer AND the product that offer is for, so the offer cannot
--      belong to a different product than the conversion claims.
--
--   2. merchant_offers (id, variant_id) unique    — the same for the variant the
--      offer is for. Nullable by design: a product-level offer has no variant,
--      and PostgreSQL allows any number of NULLs in a unique key, so many
--      product-level offers can exist beside each other.
--
--   3. imported_deal_conversions (variant_id, product_id)
--        → product_variants (id, product_id)
--      A conversion's variant must be a variant OF that conversion's product.
--      The uniqueness this needs already exists (`product_variants_id_product_key`,
--      added by 0008 for the offer-side key), so this file adds no key for it.
--
--   4. imported_deal_conversions (merchant_offer_id, product_id)
--        → merchant_offers (id, product_id)
--      A conversion's offer must be an offer OF that conversion's product. This
--      one holds whether or not the conversion names a variant, which is what
--      makes the product-level partial state safe: a conversion may leave
--      variant_id NULL, but its offer still has to be an offer of its product.
--
--   5. imported_deal_conversions (merchant_offer_id, variant_id)
--        → merchant_offers (id, variant_id)
--      When the conversion names a variant, the offer it names must be that
--      variant's offer — which, with (3), means the offer, the variant and the
--      product form one chain and not three independent references. A variant_id
--      of NULL matches no key here, which is correct: an offer with no variant
--      is a product-level offer, and (4) is the key that governs it.
--
-- Together: a conversion can only name a product, a variant of that product,
-- and an offer of that product — and if it names a variant, that variant's
-- offer. Any part of that being wrong is now a PostgreSQL error, not something
-- an application is trusted to have checked.
--
-- ----------------------------------------------------------------------------
-- WHY `on delete set null (variant_id)`, WHY NOTHING ON THE OTHER TWO, AND WHY
-- THE REFERENTIAL ACTIONS ARE THE POINT
-- ----------------------------------------------------------------------------
-- The existing behaviour, which this file preserves exactly:
--
--     product_variants  → ON DELETE SET NULL   (a variant going away nulls the
--                                               reference, it does not delete
--                                               the record that referenced it)
--     products          → ON DELETE RESTRICT   (a product a conversion points at
--                                               cannot be deleted)
--     merchant_offers   → ON DELETE RESTRICT
--     imported_deals    → ON DELETE CASCADE
--
-- Two consequences decided the shape of the new keys, both measured on a real
-- PostgreSQL 16 rather than assumed:
--
-- (a) Key (3) needs the explicit column list `on delete set null (variant_id)`.
--     A composite key's plain SET NULL nulls EVERY column in the key, so it
--     would also try to null `product_id`, which 0008 declares NOT NULL, and
--     deleting a variant would fail with a not-null violation instead of nulling
--     the reference. Worse, it would fail *sometimes*: with 0008's older
--     single-column `variant_id` key created first, its trigger nulls variant_id
--     before the composite key is examined, so the deletion appears to work —
--     and the same schema restored in a different constraint order fails. The
--     column list says what is meant and holds in either order.
--
-- (b) Keys (4) and (5) must be plain `no action` — NOT `restrict`, and not
--     `set null`. Deleting a variant that both an offer and a conversion
--     reference has to succeed: the variant's departure nulls the offer's
--     variant and the conversion's variant, and the two new keys are then
--     satisfied by NULL. NO ACTION checks at the end of the statement, after
--     those nulls have been applied; RESTRICT would fire mid-statement and
--     refuse the deletion that 0008 documents as supported. Measured in the
--     adverse constraint order (offer-side trigger created before the
--     conversion-side ones) to be sure it does not depend on firing order.
--     An offer cannot be deleted at all while a conversion names it, because
--     0008's own `merchant_offer_id` foreign key is RESTRICT.
--
-- ----------------------------------------------------------------------------
-- NULL SEMANTICS ARE PRESERVED, INCLUDING THE PARTIAL STATES
-- ----------------------------------------------------------------------------
-- variant_id stays nullable and no column becomes NOT NULL. All the states a
-- conversion can legitimately be in remain valid:
--
--   product + offer, no variant        (variant_id NULL — the offer must still
--                                       be an offer of that product, key (4))
--   product + variant + offer          (the complete chain — keys (3), (4), (5))
--   product + variant, offer NULL      impossible, the column is NOT NULL
--
-- A conversion always has a product and an offer, because 0008 made both NOT
-- NULL; what is optional is the variant, and it stays optional here.
--
-- ----------------------------------------------------------------------------
-- EXISTING DATA
-- ----------------------------------------------------------------------------
-- All three new keys are added VALIDATED, which is the point of them.
-- PostgreSQL therefore refuses this file if any existing row contradicts the
-- chain — and the pre-flight block below runs first so the refusal names the
-- imported deal and the conversion instead of only reporting a constraint
-- violation. Nothing is deleted, reassigned or repaired automatically: an
-- inconsistent row is a decision somebody made, and only a person can say which
-- of the three references was the mistake.
--
-- Apply after db/migrations/0008_canonical_catalogue.sql. Re-runnable.
-- This file creates no table, no function and no policy, changes no existing
-- constraint, and touches no data.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Pre-flight — the objects this file depends on, and the rows it would refuse
-- ---------------------------------------------------------------------------
do $$
declare
  n_bad_variant  bigint := 0;
  n_bad_offer    bigint := 0;
  example        text;
begin
  if to_regclass('public.imported_deal_conversions') is null
     or to_regclass('public.products') is null
     or to_regclass('public.product_variants') is null
     or to_regclass('public.merchant_offers') is null then
    raise exception 'Apply db/migrations/0008_canonical_catalogue.sql before this file: the canonical catalogue tables are missing.';
  end if;

  /* 0008 granted this key. Without it the variant key below has no target
     columns, and the file would fail with a less useful message. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'product_variants_id_product_key'
       and conrelid = 'public.product_variants'::regclass
       and contype = 'u'
  ) then
    raise exception 'This file needs the key 0008 creates: product_variants (id, product_id). Apply 0008 first.';
  end if;

  /* Report before refusing: a conversion whose variant belongs to a different
     product than the one the conversion names. */
  select count(*) into n_bad_variant
    from public.imported_deal_conversions c
    join public.product_variants v on v.id = c.variant_id
   where c.variant_id is not null
     and v.product_id <> c.product_id;

  if n_bad_variant > 0 then
    /* The imported deal is named as well as the conversion row: the deal is the
       record an operator can actually look up and judge, and the conversion row
       is the one to correct. */
    select string_agg(format('imported deal %s (conversion %s): product %s, but variant %s belongs to product %s',
                             c.imported_deal_id, c.id, c.product_id, c.variant_id, v.product_id), E'\n  ')
      into example
      from public.imported_deal_conversions c
      join public.product_variants v on v.id = c.variant_id
     where c.variant_id is not null
       and v.product_id <> c.product_id;
    raise exception E'% conversion(s) name a variant belonging to a different product. This file will not guess which reference was wrong, and it will not change your data. Resolve these rows first, or re-point them at the right product or variant:\n  %',
      n_bad_variant, example;
  end if;

  /* ...and a conversion whose offer belongs to a different product, or is for a
     different variant, than the one the conversion names. */
  select count(*) into n_bad_offer
    from public.imported_deal_conversions c
    join public.merchant_offers o on o.id = c.merchant_offer_id
   where o.product_id <> c.product_id
      or (c.variant_id is not null
          and (o.variant_id is null or o.variant_id <> c.variant_id));

  if n_bad_offer > 0 then
    select string_agg(format('imported deal %s (conversion %s): product %s, variant %s, but offer %s is for product %s, variant %s',
                             c.imported_deal_id, c.id, c.product_id, c.variant_id,
                             c.merchant_offer_id, o.product_id, o.variant_id), E'\n  ')
      into example
      from public.imported_deal_conversions c
      join public.merchant_offers o on o.id = c.merchant_offer_id
     where o.product_id <> c.product_id
        or (c.variant_id is not null
            and (o.variant_id is null or o.variant_id <> c.variant_id));
    raise exception E'% conversion(s) name an offer that does not belong to the same part of the catalogue. This file will not merge, delete or reassign anything: resolve these rows first.\n  %',
      n_bad_offer, example;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. The keys a conversion needs in order to name one offer AND what it is for
-- ---------------------------------------------------------------------------
-- Idempotent in the same shape as the rest of the repository: the dependent
-- foreign keys are dropped first (PostgreSQL will not drop a key an existing
-- foreign key depends on), then the keys are rebuilt and the foreign keys are
-- added again below.
alter table public.imported_deal_conversions
  drop constraint if exists imported_deal_conversions_offer_of_variant;
alter table public.imported_deal_conversions
  drop constraint if exists imported_deal_conversions_offer_of_product;
alter table public.imported_deal_conversions
  drop constraint if exists imported_deal_conversions_variant_of_product;
alter table public.merchant_offers
  drop constraint if exists merchant_offers_id_variant_key;
alter table public.merchant_offers
  drop constraint if exists merchant_offers_id_product_key;

alter table public.merchant_offers
  add constraint merchant_offers_id_product_key unique (id, product_id);

comment on constraint merchant_offers_id_product_key on public.merchant_offers is
  'Lets a conversion name one specific offer together with the product that offer is for, so the two cannot disagree. Holds for every offer, including a product-level one.';

alter table public.merchant_offers
  add constraint merchant_offers_id_variant_key unique (id, variant_id);

comment on constraint merchant_offers_id_variant_key on public.merchant_offers is
  'Lets a conversion name one specific offer together with the variant that offer is for. Nullable by design: a product-level offer has no variant, and many NULLs are allowed in a unique key.';


-- ---------------------------------------------------------------------------
-- 3. The conversion must sit on one chain, not three references
-- ---------------------------------------------------------------------------
-- Key (3) cast as a key: the variant the conversion names must belong to the
-- product the conversion names. Deleting a variant nulls the conversion's
-- variant reference and leaves the product reference — the behaviour 0008
-- already documented.
alter table public.imported_deal_conversions
  add constraint imported_deal_conversions_variant_of_product
  foreign key (variant_id, product_id)
  references public.product_variants (id, product_id)
  on delete set null (variant_id);

comment on constraint imported_deal_conversions_variant_of_product on public.imported_deal_conversions is
  'A conversion''s variant must be a variant of that conversion''s product. Paired with imported_deal_conversions_offer_of_variant this makes the conversion a single canonical chain rather than three independent references.';

-- Key (4): the offer the conversion names must be an offer of that product.
-- Plain `no action` on purpose — see the header on why RESTRICT would refuse the
-- variant deletion 0008 supports.
alter table public.imported_deal_conversions
  add constraint imported_deal_conversions_offer_of_product
  foreign key (merchant_offer_id, product_id)
  references public.merchant_offers (id, product_id);

comment on constraint imported_deal_conversions_offer_of_product on public.imported_deal_conversions is
  'A conversion''s offer must be an offer of that conversion''s product. This key holds whether or not the conversion names a variant, which is what keeps a product-level conversion (variant_id NULL) coherent.';

-- Key (5): and if the conversion names a variant, the offer must be that
-- variant's offer. An offer with no variant matches no key here, which is
-- exactly right: key (4) governs it instead.
alter table public.imported_deal_conversions
  add constraint imported_deal_conversions_offer_of_variant
  foreign key (merchant_offer_id, variant_id)
  references public.merchant_offers (id, variant_id);

comment on constraint imported_deal_conversions_offer_of_variant on public.imported_deal_conversions is
  'When a conversion names a variant, the offer it names must be that variant''s offer. A product-level offer (variant_id NULL) is not constrained here: key (4) is the one that applies.';


-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
declare
  offender text;
  variant_attnum smallint;
  product_attnum smallint;
  offer_attnum   smallint;
begin
  select attnum into variant_attnum from pg_attribute
   where attrelid = 'public.imported_deal_conversions'::regclass and attname = 'variant_id';
  select attnum into product_attnum from pg_attribute
   where attrelid = 'public.imported_deal_conversions'::regclass and attname = 'product_id';
  select attnum into offer_attnum from pg_attribute
   where attrelid = 'public.imported_deal_conversions'::regclass and attname = 'merchant_offer_id';

  /* 4a. All three new keys exist, are real foreign keys, are VALIDATED, and are
         composite — a single-column key would not do this job. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'imported_deal_conversions_variant_of_product'
       and conrelid = 'public.imported_deal_conversions'::regclass
       and contype = 'f' and convalidated
       and conkey = array[variant_attnum, product_attnum]::smallint[]
  ) then
    raise exception 'imported_deal_conversions_variant_of_product is missing, unvalidated, or not on (variant_id, product_id).';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'imported_deal_conversions_offer_of_product'
       and conrelid = 'public.imported_deal_conversions'::regclass
       and contype = 'f' and convalidated
       and conkey = array[offer_attnum, product_attnum]::smallint[]
  ) then
    raise exception 'imported_deal_conversions_offer_of_product is missing, unvalidated, or not on (merchant_offer_id, product_id).';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'imported_deal_conversions_offer_of_variant'
       and conrelid = 'public.imported_deal_conversions'::regclass
       and contype = 'f' and convalidated
       and conkey = array[offer_attnum, variant_attnum]::smallint[]
  ) then
    raise exception 'imported_deal_conversions_offer_of_variant is missing, unvalidated, or not on (merchant_offer_id, variant_id).';
  end if;

  /* 4b. The referential actions are the documented ones. `a` is NO ACTION,
         `r` RESTRICT, `n` SET NULL: the variant key must be SET NULL on delete
         and must null only the variant column; the two offer keys must be
         NO ACTION so that a variant deletion, which nulls both the offer's and
         the conversion's variant, is not refused mid-statement. */
  select string_agg(conname || ' (confdeltype=' || confdeltype::text || ')', ', ') into offender
    from pg_constraint
   where conname in ('imported_deal_conversions_offer_of_product',
                     'imported_deal_conversions_offer_of_variant')
     and (confdeltype <> 'a' or confdelsetcols is not null);
  if offender is not null then
    raise exception 'A new offer key does not use NO ACTION on delete: %', offender;
  end if;

  select string_agg(conname, ', ') into offender
    from pg_constraint
   where conname = 'imported_deal_conversions_variant_of_product'
     and (confdeltype <> 'n'
          or confdelsetcols <> array[variant_attnum]::smallint[]);
  if offender is not null then
    raise exception 'The variant key must null exactly the variant column on delete: %', offender;
  end if;

  /* 4c. The keys the offer keys point at are unique and are on the columns
         named, or the foreign keys above would be meaningless. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'merchant_offers_id_product_key'
       and conrelid = 'public.merchant_offers'::regclass and contype = 'u'
  ) or not exists (
    select 1 from pg_constraint
     where conname = 'merchant_offers_id_variant_key'
       and conrelid = 'public.merchant_offers'::regclass and contype = 'u'
  ) then
    raise exception 'A uniqueness key on merchant_offers is missing: the conversion keys would have no target.';
  end if;

  /* 4d. variant_id is still nullable, and no conversion column that must never
         be null became nullable. The partial states have to remain possible. */
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.imported_deal_conversions'::regclass
       and attname in ('product_id', 'merchant_offer_id', 'imported_deal_id')
       and not attnotnull
  ) then
    raise exception 'A conversion column that must never be null became nullable.';
  end if;
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.imported_deal_conversions'::regclass
       and attname = 'variant_id' and not attnotnull
  ) then
    raise exception 'imported_deal_conversions.variant_id must stay nullable: a product-level conversion is a valid state.';
  end if;

  /* 4e. 0008's own keys are untouched, so the chain is enforced on both sides. */
  if not exists (
    select 1 from pg_constraint
     where conname = 'merchant_offers_variant_of_product'
       and conrelid = 'public.merchant_offers'::regclass and contype = 'f' and convalidated
  ) or not exists (
    select 1 from pg_constraint
     where conname = 'product_variants_id_product_key'
       and conrelid = 'public.product_variants'::regclass and contype = 'u'
  ) then
    raise exception 'A key 0008 created is missing: the canonical chain would be enforced on one side only.';
  end if;

  /* 4f. Security is unchanged: RLS on, one policy each, no client write
         privilege, and no function added by this file (0007's invariant). */
  select string_agg(c.relname, ', ' order by c.relname) into offender
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('products', 'product_variants', 'merchant_offers',
                       'merchant_offer_media', 'imported_deal_conversions')
     and (not c.relrowsecurity
          or (select count(*) from pg_policy p where p.polrelid = c.oid) <> 1);
  if offender is not null then
    raise exception 'A canonical catalogue table lost RLS or gained a policy: %', offender;
  end if;

  select string_agg(c.relname || '/' || r.role_name || '/' || a.privilege_type, ', ' order by c.relname)
    into offender
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) as r(role_name)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as a(privilege_type)
   where n.nspname = 'public'
     and c.relname in ('products', 'product_variants', 'merchant_offers',
                       'merchant_offer_media', 'imported_deal_conversions')
     and has_table_privilege(r.role_name, c.oid, a.privilege_type);
  if offender is not null then
    raise exception 'A client holds a write privilege on a canonical catalogue table: %', offender;
  end if;

  select string_agg(p.proname, ', ' order by p.proname) into offender
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not (p.proconfig @> array['search_path=public, pg_temp']);
  if offender is not null then
    raise exception 'A public function does not pin public, pg_temp: %', offender;
  end if;

  raise notice 'canonical catalogue relationship integrity: a conversion''s variant must belong to its product, its offer must be an offer of its product, and an offer that serves a variant must be that variant''s offer; partial and product-level states preserved; RLS, privileges and search paths unchanged';
end $$;
