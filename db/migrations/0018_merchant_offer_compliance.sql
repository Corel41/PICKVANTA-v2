-- 0018_merchant_offer_compliance.sql — the compliance-profile transport
-- =============================================================================
-- PickVanta. Phase 1 of the merchant-compliance design: a read-only way for
-- an already-configured source's display rules to reach the canonical offer
-- object a page renders.
--
-- WHY THIS EXISTS
--   A source's compliance profile lives in deal_sources.config (a private,
--   admin-only table: no anon select grant, no public policy — 0005/0015).
--   A canonical page is assembled by the browser from public table reads
--   (products, product_variants, merchant_offers, external_merchants,
--   merchant_offer_media), so the rules could not reach the renderer. This
--   migration adds the one narrow, deliberate derived disclosure: a public
--   read-only function that answers, for ONE product's publicly visible
--   offers, only the sanitized compliance vocabulary each offer is governed
--   by. Migration 0015 records that "deal_sources gains nothing" from public
--   read; this function is the documented, minimal exception to that
--   sentence's spirit: what crosses the boundary is never the source's row,
--   its configuration, or its identity — only the display rules an offer's
--   page necessarily exhibits anyway (how its link behaves, whether its
--   price may show, that a program disclosure is required). No other deal_
--   _sources column, key, credential or note can leave the database through
--   this door, because the function rebuilds the answer field-by-field from
--   an explicit whitelist and never echoes the stored object.
--
-- WHAT THE FUNCTION RETURNS
--   One jsonb object keyed by merchant_offer id:
--     { "<offer uuid>": { pathway_mode, telemetry_blocking, price_display,
--                         availability_display, content_refresh,
--                         image_handling, disclosure, disclaimers,
--                         api_data_only, link_health, prohibited } }
--   Only these keys, in exactly this vocabulary, ever. An offer whose source
--   records no compliance object (the overwhelmingly common case) gets NO
--   entry — the browser's default profile then governs, which is precisely
--   the behaviour PickVanta has always had. A partial or partly invalid
--   object is completed field-by-field against the same defaults the
--   browser's js/compliance.js enforces, so the two layers agree by
--   construction. Keys are read in the database's canonical snake_case form
--   only; a producer writes camelCase at its own peril (the browser layer is
--   the more forgiving one, this one is the gate).
--
-- SECURITY SHAPE (the 0017 conventions)
--   • security definer, pinned search_path = public, pg_temp — the function
--     reads two tables the caller may not, and answers with a projection.
--   • Read-only: no insert, update, delete, or DDL anywhere in the body.
--   • Grant: EXECUTE to anon and authenticated. NOT a table grant: anon
--     still cannot SELECT from deal_sources (the self-check proves it),
--     and no RLS policy, grant or table is touched anywhere in this file.
--   • Row visibility is the offers policy of 0015 restated verbatim:
--     status in ('active', 'unavailable') — nothing pending, draft, archived
--     or expired is reachable, so the function cannot disclose an offer the
--     offers table itself would not return to the same caller.
--   • The offer ids in the answer are uuids the same caller can already read
--     publicly; the projection adds no identifier the page does not have.
--
-- Rollback: drop function public.merchant_offer_compliance(uuid);
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The function. One product in; one sanitized map out.
-- ---------------------------------------------------------------------------
create or replace function public.merchant_offer_compliance(
  p_product_id  uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result  jsonb := '{}'::jsonb;
  v_row     record;
  v_comp    jsonb;
begin
  if p_product_id is null then
    return '{}'::jsonb;
  end if;

  /* The join is the provenance the schema already guarantees: every merchant
     offer carries its originating source as a NOT NULL foreign key
     (merchant_offers.source_id → deal_sources.id, 0008), and conversion
     copies it from the imported record (0010). Row visibility is 0015's
     public offers policy, restated character for character. */
  for v_row in
    select o.id, s.config
      from public.merchant_offers o
      join public.deal_sources s on s.id = o.source_id
     where o.product_id = p_product_id
       and o.status in ('active', 'unavailable')
     order by o.id
  loop
    v_comp := case
      when v_row.config is not null and jsonb_typeof(v_row.config) = 'object'
        then v_row.config -> 'compliance'
    end;

    /* No compliance object (or a malformed one): no entry. The browser's
       default profile — historical PickVanta behaviour — governs, exactly as
       if this function had never answered. */
    if v_comp is null or jsonb_typeof(v_comp) <> 'object' then
      continue;
    end if;

    /* Field-by-field rebuild. Unknown keys cannot cross: every value below
       is read by name, validated against the approved vocabulary, and
       defaulted exactly where js/compliance.js defaults it. */
    v_result := v_result || jsonb_build_object(
      v_row.id::text,
      jsonb_build_object(
        'pathway_mode',
        case when v_comp ->> 'pathway_mode' in ('tracked-redirect', 'direct-link')
             then v_comp ->> 'pathway_mode' else 'tracked-redirect' end,

        'telemetry_blocking',
        case when jsonb_typeof(v_comp -> 'telemetry_blocking') = 'boolean'
             then v_comp -> 'telemetry_blocking' else 'true'::jsonb end,

        'price_display',
        case when v_comp ->> 'price_display' in ('source', 'never', 'api-only')
             then v_comp ->> 'price_display' else 'source' end,

        'availability_display',
        case when v_comp ->> 'availability_display' in ('source', 'never', 'api-only')
             then v_comp ->> 'availability_display' else 'source' end,

        'content_refresh',
        case when v_comp ->> 'content_refresh' in ('none', 'api-24h')
             then v_comp ->> 'content_refresh' else 'none' end,

        'image_handling',
        case when v_comp ->> 'image_handling' in ('none', 'api-links-refreshed')
             then v_comp ->> 'image_handling' else 'none' end,

        'disclosure',
        case when v_comp ->> 'disclosure' in ('none', 'associates')
             then v_comp ->> 'disclosure' else 'none' end,

        'disclaimers',
        case when jsonb_typeof(v_comp -> 'disclaimers') = 'array'
             then coalesce((select jsonb_agg(btrim(e #>> '{}'))
                              from jsonb_array_elements(v_comp -> 'disclaimers') e
                             where jsonb_typeof(e) = 'string'
                               and btrim(e #>> '{}') <> ''), '[]'::jsonb)
             else '[]'::jsonb end,

        'api_data_only',
        case when jsonb_typeof(v_comp -> 'api_data_only') = 'array'
             then coalesce((select jsonb_agg(btrim(e #>> '{}'))
                              from jsonb_array_elements(v_comp -> 'api_data_only') e
                             where jsonb_typeof(e) = 'string'
                               and btrim(e #>> '{}') <> ''), '[]'::jsonb)
             else '[]'::jsonb end,

        'link_health',
        case when v_comp ->> 'link_health' in ('none', 'api-backed')
             then v_comp ->> 'link_health' else 'none' end,

        'prohibited',
        case when jsonb_typeof(v_comp -> 'prohibited') = 'array'
             then coalesce((select jsonb_agg(btrim(e #>> '{}'))
                              from jsonb_array_elements(v_comp -> 'prohibited') e
                             where jsonb_typeof(e) = 'string'
                               and btrim(e #>> '{}') <> ''), '[]'::jsonb)
             else '[]'::jsonb end
      ));
  end loop;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Grants. Execute only — deliberately no table grant of any kind. The
--    function is the door; the tables behind it keep every lock they had.
-- ---------------------------------------------------------------------------
revoke all on function public.merchant_offer_compliance(uuid) from public, anon, authenticated;
grant execute on function public.merchant_offer_compliance(uuid) to anon, authenticated;

comment on function public.merchant_offer_compliance(uuid) is
  'Read-only compliance-profile transport: for one product''s publicly visible offers (status active/unavailable, the 0015 offers policy), returns only the sanitized compliance vocabulary each offer''s source records — rebuilt field-by-field from deal_sources.config''s "compliance" key through an explicit whitelist. Offers without a compliance object get no entry. Never returns source identity, raw configuration, credentials, or any offer the public offers policy would not return.';

-- ---------------------------------------------------------------------------
-- 3. Self-check. A migration that opens a doorway proves it is the only
--    thing that opened, that it is locked to a projection, and that the key
--    fits the hands it was cut for (the 0017 pattern).
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn      regprocedure := to_regprocedure('public.merchant_offer_compliance(uuid)');
  v_definer boolean;
  v_config  text;
begin
  if v_fn is null then
    raise exception 'merchant_offer_compliance(uuid) was not created.';
  end if;

  select p.prosecdef, p.proconfig into v_definer, v_config
    from pg_proc p where p.oid = v_fn;

  if not v_definer then
    raise exception 'merchant_offer_compliance must be SECURITY DEFINER.';
  end if;
  if v_config is null or v_config not like '%search_path=public, pg_temp%' then
    raise exception 'merchant_offer_compliance must pin search_path = public, pg_temp.';
  end if;

  if not has_function_privilege('anon', 'public.merchant_offer_compliance(uuid)', 'execute') then
    raise exception 'anon must be able to execute merchant_offer_compliance.';
  end if;
  if not has_function_privilege('authenticated', 'public.merchant_offer_compliance(uuid)', 'execute') then
    raise exception 'authenticated must be able to execute merchant_offer_compliance.';
  end if;

  /* The door stays narrow: deal_sources itself gains nothing. */
  if has_table_privilege('anon', 'public.deal_sources', 'select') then
    raise exception 'anon must not be able to select from deal_sources.';
  end if;
  if not (select relrowsecurity from pg_class
           where oid = to_regclass('public.deal_sources')) then
    raise exception 'deal_sources must keep row level security enabled.';
  end if;
end $$;
