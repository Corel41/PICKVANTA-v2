-- ============================================================================
-- 0011 — the import engine's ingest boundary
-- ============================================================================
-- Step 17C-C. 0005 modelled the Deal Engine, 0006 made a source writable, 0010
-- made a reviewed record convertible — and nothing could create an imported
-- record at all. This migration adds the one door through which outside data
-- enters the database, and the job records that surround it.
--
-- What it adds:
--   1. two observation columns on imported_deals (last_seen_at, raw_hash) and
--      the two constraints that keep them honest;
--   2. four indexes that ingest and the job history need;
--   3. the ingest boundary:
--        import_batch_validate(jsonb)   the envelope rules
--        import_record_validate(jsonb)  one record's rules, as a report
--        import_job_start(...)          the unit of work begins
--        import_job_finish(...)         and ends, honestly
--        import_ingest(jsonb)           the only write path for outside data
--      plus the small internal helpers they share;
--   4. privileges: the three outer functions are callable by service_role and
--      nobody else; every helper is callable by nobody but the functions that
--      use it.
--
-- What it deliberately does not do:
--   • no canonical write. The canonical tables stay reachable only through
--     imported_deal_convert() (0010) and a named administrator's decision;
--   • no promotion. A record stops at pipeline_status = 'imported'. Moving it
--     towards review is a later step, with its own migration;
--   • no affiliate link, no publishing, no AI, no fuzzy matching, no price
--     tracking, no currency conversion;
--   • no table privilege and no write policy for any client role: the posture
--     0005 and 0008 established is unchanged, and the self-check re-asserts it;
--   • no worker, no scheduler, no cron. Nothing runs these functions by
--     itself; the runner (connectors/run.js) calls them, and a person starts
--     the runner.
--
-- Applying it: apply this file, then enable the runner's --commit mode. The
-- other order is safe too: the runner is refused with "function not found", no
-- job starts, and nothing is written.
--
-- Reversing it — there is no rollback file, by project precedent (0001..0010
-- have none either). Every statement below has a reverse, and the reverse
-- removes a door, never data:
--
--   drop function public.import_ingest(jsonb);
--   drop function public.import_job_finish(uuid, text, jsonb, text, smallint);
--   drop function public.import_job_start(text, uuid, text);
--   drop function public.import_record_validate(jsonb);
--   drop function public.import_batch_validate(jsonb);
--   drop function public.import_media_replace(uuid, jsonb);
--   drop function public.import_check_keys(jsonb, text[], jsonb, text);
--   drop function public.import_text_issues(jsonb, text, boolean, integer, text, text, boolean);
--   drop index public.deal_engine_jobs_created_at_idx;
--   drop index public.deal_engine_jobs_source_created_idx;
--   drop index public.external_merchants_source_ref_key;
--   drop index public.imported_deals_merchant_idx;
--   alter table public.imported_deals drop constraint imported_deals_raw_hash_shape;
--   alter table public.imported_deals drop constraint imported_deals_price_needs_currency;
--   alter table public.imported_deals drop column last_seen_at;
--   alter table public.imported_deals drop column raw_hash;
--
-- Imported records, their media, merchants, jobs, events and conversions all
-- stay. The two dropped columns hold observations (when a record was last seen,
-- and a hash of its evidence), not facts a person decided.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. imported_deals — two observations, and the constraints that keep them true
-- ---------------------------------------------------------------------------
-- last_seen_at answers "when did we last see this record at the source", which
-- imported_at cannot (it is the first sighting) and updated_at cannot (an
-- unchanged record is not updated, but it was still seen). It moves on every
-- touch, including the unchanged one — that is the point of it.
--
-- raw_hash is md5(imported_metadata::text), computed by the database. jsonb's
-- text form is canonical (keys sorted, whitespace normalised), so the same
-- evidence cannot hash differently because a connector re-serialised it. It is
-- what makes "changed" and "unchanged" a measurement rather than a claim.
alter table public.imported_deals
  add column if not exists last_seen_at timestamptz not null default now();

alter table public.imported_deals
  add column if not exists raw_hash text not null default '';

/* The constraint name says what it refuses. `add constraint` has no
   IF NOT EXISTS form, so the guard is explicit: this migration must be
   applicable twice without error. */
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.imported_deals'::regclass
      and conname = 'imported_deals_raw_hash_shape'
  ) then
    alter table public.imported_deals
      add constraint imported_deals_raw_hash_shape
      check (raw_hash = '' or raw_hash ~ '^[0-9a-f]{32}$');
  end if;

  /* A price without a currency is not a price. 0005 already refuses a currency
     that is not three upper-case letters; this refuses the other half of the
     pair, so "never defaulted and never converted" is a rule the table keeps
     even if a future writer forgets it. */
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.imported_deals'::regclass
      and conname = 'imported_deals_price_needs_currency'
  ) then
    alter table public.imported_deals
      add constraint imported_deals_price_needs_currency
      check (imported_price is null or imported_currency <> '');
  end if;
end $$;

comment on column public.imported_deals.last_seen_at is
  'When this record was last seen at its source. Moves on every touch, including the one that changed nothing: an unchanged record was still observed, and this is where that is recorded.';
comment on column public.imported_deals.raw_hash is
  'md5 of the evidence (imported_metadata) as the database stores it. Written by the ingest boundary, never by a caller, and the reason "changed" is a measurement rather than a claim.';


-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
-- (source_id, external_product_id) is already the identity guard (0005), and
-- imported_deal_media_order_key already serves the media prefix. These four are
-- the rest of what ingest and a job history actually ask for.
create index if not exists deal_engine_jobs_created_at_idx
  on public.deal_engine_jobs (created_at desc);

create index if not exists deal_engine_jobs_source_created_idx
  on public.deal_engine_jobs (source_id, created_at desc)
  where source_id is not null;

/* The merchant upsert: one merchant per (source, the source's own id for it).
   Partial, because a merchant with no reference from the source cannot be
   matched this way and is matched by name within its source instead. */
create unique index if not exists external_merchants_source_ref_key
  on public.external_merchants (source_id, merchant_ref)
  where merchant_ref <> '' and source_id is not null;

create index if not exists imported_deals_merchant_idx
  on public.imported_deals (external_merchant_id)
  where external_merchant_id is not null;


-- ---------------------------------------------------------------------------
-- 3. The shared rules, in one place
-- ---------------------------------------------------------------------------
-- Two small helpers, so that the same rule is written once and cannot be
-- enforced differently in two places. Both are security invoker with a pinned
-- search path, and both have their EXECUTE revoked below: a browser cannot use
-- them as an oracle, and no caller reaches them except the functions here.
--
-- They return a JSON array of {field, reason}. An empty array means the field
-- was fine — a report, not an exception, because a record with three problems
-- should be told about all three in one answer.
create or replace function public.import_text_issues(
  p_value          jsonb,
  p_field          text,
  p_required       boolean,
  p_max            integer,
  p_pattern        text default null,
  p_pattern_reason text default null,
  p_no_control     boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_text   text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    if p_required then
      v_errors := v_errors || jsonb_build_object('field', p_field, 'reason', 'is required');
    end if;
    return v_errors;
  end if;

  if jsonb_typeof(p_value) <> 'string' then
    return v_errors || jsonb_build_object('field', p_field, 'reason', 'must be a string');
  end if;

  v_text := btrim(p_value #>> '{}');

  if p_required and v_text = '' then
    v_errors := v_errors || jsonb_build_object('field', p_field, 'reason', 'must not be blank');
  end if;

  if p_max is not null and char_length(v_text) > p_max then
    v_errors := v_errors || jsonb_build_object(
      'field', p_field,
      'reason', format('must be at most %s characters (got %s)', p_max, char_length(v_text)));
  end if;

  /* Control characters are refused where the caller asks for it, and the caller
     is the identity check: a control character inside an external product id is
     how one product is made to look like another. Elsewhere they are ordinary
     text — the connector turns an HTML paragraph break into a newline, and a
     description with a newline in it is a description, not an attack. The rule
     is per call so that this function cannot be stricter than the connector's
     contract (17C-A §4), which applies `noControl` to `external_product_id`
     alone. */
  if p_no_control and v_text <> '' and v_text ~ '[[:cntrl:]]' then
    v_errors := v_errors || jsonb_build_object('field', p_field, 'reason', 'must not contain control characters');
  end if;

  /* The pattern is applied case-sensitively: a pattern that says [A-Z] means
     upper case, and ^[A-Z]{3}$ must refuse "gbp" here rather than let it
     reach the table's own check as an anonymous error. A pattern that wants
     case-insensitivity asks for it with a leading (?i). */
  if p_pattern is not null and v_text <> '' and v_text !~ p_pattern then
    v_errors := v_errors || jsonb_build_object('field', p_field, 'reason', p_pattern_reason);
  end if;

  return v_errors;
end $$;

/* The contract is closed: a key it does not define is refused, never ignored.
   A key the pipeline owns is refused with the reason it is refused — the same
   sentence the runner prints, so the two boundaries explain themselves alike. */
create or replace function public.import_check_keys(
  p_object    jsonb,
  p_allowed   text[],
  p_forbidden jsonb,
  p_prefix    text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_key    text;
  v_field  text;
begin
  if p_object is null or jsonb_typeof(p_object) <> 'object' then
    return '[]'::jsonb;
  end if;

  for v_key in
    select k.key from jsonb_object_keys(p_object) as k(key) order by k.key
  loop
    if v_key = any (p_allowed) then
      continue;
    end if;
    v_field := case when p_prefix = '' then v_key else p_prefix || '.' || v_key end;
    if p_forbidden ? v_key then
      v_errors := v_errors || jsonb_build_object(
        'field', v_field, 'reason', 'refused: ' || (p_forbidden ->> v_key));
    else
      v_errors := v_errors || jsonb_build_object(
        'field', v_field, 'reason', 'not part of the ingest contract');
    end if;
  end loop;

  return v_errors;
end $$;


-- ---------------------------------------------------------------------------
-- 4. One record, validated — as a report rather than an exception
-- ---------------------------------------------------------------------------
-- The rules are the ones approved in 17C-A §4.1 and implemented by the runner's
-- lib/contract.js: identity, provenance, mapped text, the price pair, the
-- merchant, media references, and the source's own record kept as evidence.
-- Nothing here judges quality — a missing description, an unmapped category and
-- an unusual availability phrase are all storable facts. This refuses what
-- cannot be stored, and says which field and why.
create or replace function public.import_record_validate(p_record jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed    text[] := array['external_product_id', 'source_url', 'title', 'description',
                               'price', 'availability_text', 'category_text', 'merchant',
                               'media', 'raw'];
  v_price_allowed    text[] := array['amount', 'currency'];
  v_merchant_allowed text[] := array['name', 'merchant_ref', 'website_url', 'country'];
  v_media_allowed    text[] := array['url', 'media_type', 'sort_order', 'attribution', 'fallback_url'];
  v_media_types      text[] := array['image', 'video', 'document'];

  /* The pipeline's own keys, each with the reason the boundary refuses it.
     Kept in the database as well as in the runner: a caller that skips the
     runner must still be told, and told the same thing. */
  v_forbidden jsonb := jsonb_build_object(
    'pipeline_status',      'the pipeline records its own position; a caller cannot claim one',
    'validation_status',    'written by the validation stage',
    'validation_result',    'written by the validation stage',
    'normalization_status', 'written by the normalization stage',
    'normalization_result', 'written by the normalization stage',
    'normalized_name',      'normalization output',
    'normalized_brand',     'normalization output',
    'normalized_category_id', 'normalization output',
    'normalized_availability', 'normalization output',
    'model_number',         'normalization output',
    'gtin',                 'normalization output',
    'deduplication_status', 'written by the deduplication stage',
    'deduplication_result', 'written by the deduplication stage',
    'dedup_match_class',    'written by the deduplication stage',
    'dedup_matched_deal_id', 'written by the deduplication stage',
    'review_status',        'an administrator decision',
    'review_note',          'an administrator decision',
    'reviewed_at',          'an administrator decision',
    'reviewed_by',          'an administrator decision',
    'published_deal_id',    'publication is not part of ingestion',
    'affiliate_url',        'never generated and never supplied by a source',
    'external_merchant_id', 'assigned by the ingest boundary from the merchant the record names',
    'id',                   'generated by the database',
    'imported_at',          'generated by the database',
    'created_at',           'generated by the database',
    'updated_at',           'generated by the database',
    'job_id',               'belongs to the batch envelope',
    'source_id',            'belongs to the batch envelope',
    'error',                'processing state, not a caller-supplied message',
    'last_seen_at',         'written by the ingest boundary',
    'raw_hash',             'written by the ingest boundary');

  v_errors      jsonb := '[]'::jsonb;
  v_values      jsonb;
  v_price       jsonb;
  v_media       jsonb;
  v_entry       jsonb;
  v_raw         jsonb;
  v_index       integer;
  v_order       integer;
  v_seen_orders integer[] := '{}';
  v_amount      text;
  v_currency    text;
  v_price_value numeric(14, 2);
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'errors', jsonb_build_array(jsonb_build_object('field', 'record', 'reason', 'must be a JSON object')),
      'values', null);
  end if;

  v_errors := v_errors || public.import_check_keys(p_record, v_allowed, v_forbidden, '');

  -- identity and provenance
  v_errors := v_errors || public.import_text_issues(
    p_record -> 'external_product_id', 'external_product_id', true, 200, null, null, true);
  v_errors := v_errors || public.import_text_issues(
    p_record -> 'source_url', 'source_url', true, 1000,
    '(?i)^https?://[^[:space:]]+$', 'must be an http(s) address');
  v_errors := v_errors || public.import_text_issues(
    p_record -> 'title', 'title', true, 500);
  v_errors := v_errors || public.import_text_issues(
    p_record -> 'description', 'description', false, 8000);
  v_errors := v_errors || public.import_text_issues(
    p_record -> 'availability_text', 'availability_text', false, 200);
  v_errors := v_errors || public.import_text_issues(
    p_record -> 'category_text', 'category_text', false, 300);

  -- the price pair: amount and currency together, or nothing at all
  if p_record ? 'price' and jsonb_typeof(p_record -> 'price') <> 'null' then
    v_price := p_record -> 'price';
    if jsonb_typeof(v_price) <> 'object' then
      v_errors := v_errors || jsonb_build_object(
        'field', 'price', 'reason', 'must be an object carrying amount and currency, or null');
    else
      v_errors := v_errors || public.import_check_keys(v_price, v_price_allowed, '{}'::jsonb, 'price');
      if not (v_price ? 'amount') or jsonb_typeof(v_price -> 'amount') = 'null' then
        v_errors := v_errors || jsonb_build_object(
          'field', 'price', 'reason', 'a price with no amount must be null, not an empty object');
      end if;
      v_errors := v_errors || public.import_text_issues(
        v_price -> 'amount', 'price.amount', true, 20, '^\d{1,12}(\.\d{1,2})?$',
        'must be a decimal string with at most 2 decimal places (a symbol, separator or currency conversion is not accepted)');
      v_errors := v_errors || public.import_text_issues(
        v_price -> 'currency', 'price.currency', true, 3, '^[A-Z]{3}$',
        'must be a three-letter ISO 4217 code in upper case, such as KES, USD or EUR');

      if jsonb_typeof(v_price -> 'amount') = 'string' then
        v_amount := btrim(v_price ->> 'amount');
        if v_amount ~ '^\d{1,12}(\.\d{1,2})?$' then
          v_price_value := v_amount::numeric(14, 2);
        end if;
      end if;
      if jsonb_typeof(v_price -> 'currency') = 'string' then
        v_currency := btrim(v_price ->> 'currency');
      end if;
    end if;
  end if;

  -- the merchant: identity of the source's business, never a PickVanta account
  if not (p_record ? 'merchant') or jsonb_typeof(p_record -> 'merchant') <> 'object' then
    v_errors := v_errors || jsonb_build_object(
      'field', 'merchant', 'reason', 'must be a JSON object naming the merchant the record came from');
  else
    v_errors := v_errors || public.import_check_keys(
      p_record -> 'merchant', v_merchant_allowed, '{}'::jsonb, 'merchant');
    v_errors := v_errors || public.import_text_issues(
      p_record -> 'merchant' -> 'name', 'merchant.name', true, 200);
    v_errors := v_errors || public.import_text_issues(
      p_record -> 'merchant' -> 'merchant_ref', 'merchant.merchant_ref', false, 200);
    v_errors := v_errors || public.import_text_issues(
      p_record -> 'merchant' -> 'website_url', 'merchant.website_url', false, 1000,
      '(?i)^https?://[^[:space:]]+$', 'must be an http(s) address');
    v_errors := v_errors || public.import_text_issues(
      p_record -> 'merchant' -> 'country', 'merchant.country', false, 2, '^[A-Z]{2}$',
      'must be a two-letter ISO 3166-1 code in upper case, such as KE, GB or DE');
  end if;

  -- media: references with an order, never copies and never a download
  if p_record ? 'media' and jsonb_typeof(p_record -> 'media') <> 'null' then
    if jsonb_typeof(p_record -> 'media') <> 'array' then
      v_errors := v_errors || jsonb_build_object(
        'field', 'media', 'reason', 'must be an array of references');
    else
      v_media := p_record -> 'media';
      if jsonb_array_length(v_media) > 30 then
        v_errors := v_errors || jsonb_build_object(
          'field', 'media', 'reason', 'must not exceed 30 references');
      end if;

      for v_index in 0 .. jsonb_array_length(v_media) - 1 loop
        v_entry := v_media -> v_index;
        if jsonb_typeof(v_entry) <> 'object' then
          v_errors := v_errors || jsonb_build_object(
            'field', format('media[%s]', v_index), 'reason', 'must be a JSON object');
          continue;
        end if;
        v_errors := v_errors || public.import_check_keys(
          v_entry, v_media_allowed, '{}'::jsonb, format('media[%s]', v_index));
        v_errors := v_errors || public.import_text_issues(
          v_entry -> 'url', format('media[%s].url', v_index), true, 1000,
          '(?i)^https?://[^[:space:]]+$', 'must be an http(s) address');
        v_errors := v_errors || public.import_text_issues(
          v_entry -> 'fallback_url', format('media[%s].fallback_url', v_index), false, 1000,
          '(?i)^https?://[^[:space:]]+$', 'must be an http(s) address');
        v_errors := v_errors || public.import_text_issues(
          v_entry -> 'attribution', format('media[%s].attribution', v_index), false, 200);

        if v_entry ? 'media_type' then
          if jsonb_typeof(v_entry -> 'media_type') <> 'string'
             or not (btrim(v_entry ->> 'media_type') = any (v_media_types)) then
            v_errors := v_errors || jsonb_build_object(
              'field', format('media[%s].media_type', v_index), 'reason', 'must be one of image, video, document');
          end if;
        end if;

        if v_entry ? 'sort_order' then
          if jsonb_typeof(v_entry -> 'sort_order') <> 'number'
             or (v_entry ->> 'sort_order') !~ '^\d+$' then
            v_errors := v_errors || jsonb_build_object(
              'field', format('media[%s].sort_order', v_index), 'reason', 'must be an integer of at least 0');
          else
            v_order := (v_entry ->> 'sort_order')::integer;
            if v_order = any (v_seen_orders) then
              v_errors := v_errors || jsonb_build_object(
                'field', format('media[%s].sort_order', v_index),
                'reason', format('must be unique within a record (got %s twice)', v_order));
            else
              v_seen_orders := v_seen_orders || v_order;
            end if;
          end if;
        end if;
      end loop;
    end if;
  end if;

  -- the evidence: the source's own record, an object, bounded
  if not (p_record ? 'raw') or jsonb_typeof(p_record -> 'raw') <> 'object' then
    v_errors := v_errors || jsonb_build_object(
      'field', 'raw', 'reason', 'must be the source record as a JSON object, unchanged');
  else
    v_raw := p_record -> 'raw';
    if octet_length(v_raw::text) > 20480 then
      v_errors := v_errors || jsonb_build_object(
        'field', 'raw', 'reason', format('must be at most 20480 bytes of JSON (got %s)', octet_length(v_raw::text)));
    end if;
  end if;

  if jsonb_array_length(v_errors) = 0 then
    v_values := jsonb_build_object(
      'external_product_id', btrim(p_record ->> 'external_product_id'),
      'source_url',          btrim(p_record ->> 'source_url'),
      'title',               btrim(p_record ->> 'title'),
      'description',         coalesce(btrim(p_record ->> 'description'), ''),
      'availability_text',   coalesce(btrim(p_record ->> 'availability_text'), ''),
      'category_text',       coalesce(btrim(p_record ->> 'category_text'), ''),
      'imported_price',      v_price_value,
      'imported_currency',   coalesce(v_currency, ''),
      'merchant_name',       btrim(p_record -> 'merchant' ->> 'name'),
      'merchant_ref',        coalesce(btrim(p_record -> 'merchant' ->> 'merchant_ref'), ''),
      'merchant_website',    coalesce(btrim(p_record -> 'merchant' ->> 'website_url'), ''),
      'merchant_country',    coalesce(btrim(p_record -> 'merchant' ->> 'country'), ''),
      'media',               coalesce(p_record -> 'media', '[]'::jsonb),
      'raw',                 v_raw,
      'raw_hash',            md5(v_raw::text));

    return jsonb_build_object('ok', true, 'errors', '[]'::jsonb, 'values', v_values);
  end if;

  return jsonb_build_object('ok', false, 'errors', v_errors, 'values', null);
end $$;


-- ---------------------------------------------------------------------------
-- 5. The envelope, validated — an exception, because the whole call is wrong
-- ---------------------------------------------------------------------------
-- A record problem is a report (section 4). An envelope problem is not a batch
-- at all: a version this boundary does not know, a missing source or job, more
-- records than one call may carry. It raises, and the caller learns nothing was
-- written because the call never proceeded.
create or replace function public.import_batch_validate(p_batch jsonb)
returns void
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_allowed           text[] := array['batch_version', 'source_id', 'job_id', 'connector',
                                       'fetched_at', 'records'];
  v_connector_allowed text[] := array['name', 'version', 'method'];
  v_methods           text[] := array['json-api', 'csv', 'xml', 'merchant-api'];
  v_key               text;
  v_connector         jsonb;
  v_count             integer;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'object' then
    raise exception 'The ingest payload has to be a JSON object' using errcode = '22023';
  end if;

  for v_key in
    select k.key from jsonb_object_keys(p_batch) as k(key) order by k.key
  loop
    if v_key <> all (v_allowed) then
      raise exception 'The ingest payload has a key this boundary does not define (%). The contract is closed: a value that is not part of it is refused rather than ignored',
        v_key using errcode = '22023';
    end if;
  end loop;

  if coalesce(p_batch ->> 'batch_version', '') <> '1' then
    raise exception 'Unknown batch version: % (this boundary reads version 1)',
      coalesce(nullif(p_batch ->> 'batch_version', ''), '(none)') using errcode = '22023';
  end if;

  if coalesce(p_batch ->> 'source_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A batch must name its source as a uuid' using errcode = '22023';
  end if;

  if coalesce(p_batch ->> 'job_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A batch must name the job it belongs to, as a uuid; start one with import_job_start() first'
      using errcode = '22023';
  end if;

  v_connector := p_batch -> 'connector';
  if v_connector is null or jsonb_typeof(v_connector) <> 'object' then
    raise exception 'A batch must describe the connector that produced it' using errcode = '22023';
  end if;
  for v_key in
    select k.key from jsonb_object_keys(v_connector) as k(key) order by k.key
  loop
    if v_key <> all (v_connector_allowed) then
      raise exception 'The connector description has a key this boundary does not define (%)',
        v_key using errcode = '22023';
    end if;
  end loop;
  if coalesce(btrim(v_connector ->> 'name'), '') = '' or char_length(btrim(v_connector ->> 'name')) > 120 then
    raise exception 'A connector needs a name of at most 120 characters' using errcode = '22023';
  end if;
  if coalesce(btrim(v_connector ->> 'version'), '') = '' or char_length(btrim(v_connector ->> 'version')) > 120 then
    raise exception 'A connector needs a version of at most 120 characters' using errcode = '22023';
  end if;
  if not (coalesce(v_connector ->> 'method', '') = any (v_methods)) then
    raise exception 'Unknown connector method: % (one of json-api, csv, xml, merchant-api)',
      coalesce(nullif(v_connector ->> 'method', ''), '(none)') using errcode = '22023';
  end if;

  if coalesce(p_batch ->> 'fetched_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'A batch must record when it was fetched, as an ISO 8601 timestamp with an offset (for example 2026-09-26T10:00:00Z)'
      using errcode = '22023';
  end if;

  if p_batch -> 'records' is null or jsonb_typeof(p_batch -> 'records') <> 'array' then
    raise exception 'A batch must carry its records as an array' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_batch -> 'records');
  if v_count = 0 then
    raise exception 'A batch must carry at least one record' using errcode = '22023';
  end if;
  if v_count > 500 then
    raise exception 'A batch may carry at most 500 records (this one carries %)', v_count using errcode = '22001';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 6. Media, replaced as a set
-- ---------------------------------------------------------------------------
-- References, order and attribution; nothing is downloaded, proxied or
-- resized. A refresh replaces the set rather than merging it: the source is
-- the authority on its own gallery, and a reference it stopped publishing
-- should stop being shown.
create or replace function public.import_media_replace(
  p_imported_deal_id uuid,
  p_media            jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.imported_deal_media where imported_deal_id = p_imported_deal_id;

  if p_media is null or jsonb_typeof(p_media) <> 'array' or jsonb_array_length(p_media) = 0 then
    return;
  end if;

  insert into public.imported_deal_media
    (imported_deal_id, source_media_url, media_type, sort_order, attribution, fallback_url)
  select
    p_imported_deal_id,
    entry.value ->> 'url',
    coalesce(nullif(btrim(entry.value ->> 'media_type'), ''), 'image'),
    coalesce(nullif(entry.value ->> 'sort_order', '')::integer, (entry.ordinality - 1)::integer),
    coalesce(btrim(entry.value ->> 'attribution'), ''),
    coalesce(btrim(entry.value ->> 'fallback_url'), '')
  from jsonb_array_elements(p_media) with ordinality as entry(value, ordinality);
end $$;


-- ---------------------------------------------------------------------------
-- 7. The job begins
-- ---------------------------------------------------------------------------
-- One row, written before anything is fetched, so that a run that dies has
-- still said it started. The vocabulary is 0005's; nothing here invents a job
-- type or a status.
create or replace function public.import_job_start(
  p_job_type  text,
  p_source_id uuid,
  p_detail    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_types text[] := array['source-scan', 'feed-import', 'url-discovery', 'extraction',
                              'normalization', 'deduplication', 'price-check',
                              'availability-check', 'deal-expiry', 'link-health'];
  v_source    public.deal_sources;
  v_running   public.deal_engine_jobs;
  v_job       public.deal_engine_jobs;
begin
  if p_source_id is null then
    raise exception 'A job needs a source' using errcode = '22023';
  end if;

  if p_job_type is null or not (btrim(p_job_type) = any (v_job_types)) then
    raise exception 'Unknown job type: %. The vocabulary is 0005''s, and a run outside it cannot be recorded',
      coalesce(nullif(btrim(p_job_type), ''), '(none)') using errcode = '22023';
  end if;

  if char_length(coalesce(p_detail, '')) > 500 then
    raise exception 'A job description is limited to 500 characters' using errcode = '22001';
  end if;

  select * into v_source from public.deal_sources where id = p_source_id;
  if not found then
    raise exception 'No source with that id' using errcode = 'P0002';
  end if;
  if v_source.status <> 'active' then
    raise exception 'That source is "%", and only an active source may be read. Set it active deliberately, then start the run',
      v_source.status using errcode = '22023';
  end if;

  /* One running job per source. A function check rather than a unique index on
     purpose: an index would also block every future run of a source whose run
     died without finishing it, and the only way out would be database surgery.
     Here the refusal names the job, and a person can finish it. */
  select * into v_running
    from public.deal_engine_jobs
   where source_id = p_source_id and status = 'running'
   order by started_at desc nulls last
   limit 1;
  if found then
    raise exception 'A job for that source is already running (%, started %). Finish it with import_job_finish() before starting another: a run that is stuck is closed by a person, not overwritten',
      v_running.id, v_running.started_at using errcode = '22023';
  end if;

  insert into public.deal_engine_jobs (source_id, job_type, status, progress, detail, started_at)
  values (p_source_id, btrim(p_job_type), 'running', 0, coalesce(btrim(p_detail), ''), now())
  returning * into v_job;

  return jsonb_build_object(
    'job_id',     v_job.id,
    'job_type',   v_job.job_type,
    'source_id',  v_job.source_id,
    'status',     v_job.status,
    'started_at', v_job.started_at);
end $$;


-- ---------------------------------------------------------------------------
-- 8. The job ends — and a failure has to say why
-- ---------------------------------------------------------------------------
create or replace function public.import_job_finish(
  p_job_id   uuid,
  p_status   text,
  p_stats    jsonb default '{}'::jsonb,
  p_error    text default '',
  p_progress smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job      public.deal_engine_jobs;
  v_status   text := btrim(coalesce(p_status, ''));
  v_stats    jsonb := coalesce(p_stats, '{}'::jsonb);
  v_progress smallint;
  v_error    text := coalesce(btrim(p_error), '');
begin
  select * into v_job from public.deal_engine_jobs where id = p_job_id for update;
  if not found then
    raise exception 'No job with that id' using errcode = 'P0002';
  end if;

  if v_job.status <> 'running' then
    raise exception 'That job is already "%", and a finished run is not rewritten', v_job.status
      using errcode = '22023';
  end if;

  if v_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'Unknown outcome: %. A run ends as succeeded, failed or cancelled',
      coalesce(nullif(v_status, ''), '(none)') using errcode = '22023';
  end if;

  if v_status = 'failed' and v_error = '' then
    raise exception 'A failed job has to say why' using errcode = '22023';
  end if;

  if jsonb_typeof(v_stats) <> 'object' then
    raise exception 'Job statistics have to be a JSON object' using errcode = '22023';
  end if;
  if octet_length(v_stats::text) > 8192 then
    raise exception 'Job statistics are limited to 8192 bytes of JSON (got %)', octet_length(v_stats::text)
      using errcode = '22001';
  end if;
  if char_length(v_error) > 2000 then
    raise exception 'A failure reason is limited to 2000 characters' using errcode = '22001';
  end if;

  if p_progress is null then
    v_progress := case when v_status = 'succeeded' then 100 else 0 end;
  else
    if p_progress < 0 or p_progress > 100 then
      raise exception 'Progress is a percentage from 0 to 100' using errcode = '22023';
    end if;
    v_progress := p_progress;
  end if;

  update public.deal_engine_jobs
     set status      = v_status,
         progress    = v_progress,
         stats       = v_stats,
         error       = v_error,
         finished_at = now()
   where id = p_job_id
   returning * into v_job;

  return jsonb_build_object(
    'job_id',      v_job.id,
    'status',      v_job.status,
    'progress',    v_job.progress,
    'started_at',  v_job.started_at,
    'finished_at', v_job.finished_at);
end $$;


-- ---------------------------------------------------------------------------
-- 9. The boundary itself — the only way outside data becomes a record
-- ---------------------------------------------------------------------------
-- One call, one batch, one transaction. Inside it, each record stands or falls
-- on its own: a record that cannot be stored is refused with its reasons and
-- the rest of the batch still commits, because one bad row in a merchant feed
-- must not discard the other four hundred.
--
-- What it writes: external_merchants, imported_deals, imported_deal_media,
-- deal_engine_events (one per touched record). What it never writes: a pipeline
-- status above 'imported', a review decision, a normalized value, an affiliate
-- link, or anything in the canonical layer.
create or replace function public.import_ingest(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  /* The job types that produce records. A "price-check" or a "deal-expiry" run
     re-reads what is already recorded; it does not pour new records in. */
  v_record_types text[] := array['feed-import', 'source-scan', 'extraction', 'url-discovery'];
  /* The pipeline states a human has decided. A re-import never overwrites a
     decision; it records that the source sent the record again. */
  v_locked_statuses text[] := array['approved', 'published', 'rejected', 'archived'];

  v_source      public.deal_sources;
  v_job         public.deal_engine_jobs;
  v_source_id   uuid;
  v_job_id      uuid;
  v_records     jsonb;
  v_count       integer;
  v_index       integer;
  v_record      jsonb;
  v_report      jsonb;
  v_values      jsonb;
  v_result      jsonb;
  v_event_data  jsonb;
  v_merchant_id uuid;
  v_deal        public.imported_deals;
  v_existed     boolean;
  v_new_id      uuid;
  v_event_id    uuid;
  v_hash        text;
  v_title       text;
  v_price       numeric(14, 2);
  v_currency    text;
  v_media       jsonb;
  v_note        text;

  v_imported  integer := 0;
  v_updated   integer := 0;
  v_unchanged integer := 0;
  v_skipped   integer := 0;
  v_rejected  integer := 0;
  v_results   jsonb := '[]'::jsonb;
begin
  /* 9a. The envelope, before anything is read or written. */
  perform public.import_batch_validate(p_batch);

  v_source_id := (p_batch ->> 'source_id')::uuid;
  v_job_id    := (p_batch ->> 'job_id')::uuid;

  select * into v_source from public.deal_sources where id = v_source_id;
  if not found then
    raise exception 'No source with that id' using errcode = 'P0002';
  end if;
  if v_source.status <> 'active' then
    raise exception 'That source is "%"; only an active source may be read', v_source.status
      using errcode = '22023';
  end if;

  select * into v_job from public.deal_engine_jobs where id = v_job_id;
  if not found then
    raise exception 'No job with that id' using errcode = 'P0002';
  end if;
  if v_job.status <> 'running' then
    raise exception 'That job is "%", and records are accepted only while a job is running', v_job.status
      using errcode = '22023';
  end if;
  if v_job.source_id is distinct from v_source_id then
    raise exception 'That job belongs to a different source; one batch cannot mix sources'
      using errcode = '22023';
  end if;
  if not (v_job.job_type = any (v_record_types)) then
    raise exception 'A "%" job does not ingest records', v_job.job_type using errcode = '22023';
  end if;

  v_records := p_batch -> 'records';
  v_count   := jsonb_array_length(v_records);

  /* The run's own facts, recorded with every event this call appends. */
  v_event_data := jsonb_build_object(
    'batch_version', p_batch -> 'batch_version',
    'fetched_at',    p_batch ->> 'fetched_at',
    'job_id',        v_job_id,
    'connector',     p_batch -> 'connector');

  /* 9b. One record at a time. The inner block is the isolation: a database
     error on this record rolls back this record's writes only, becomes its
     rejection reason, and the loop continues. */
  for v_index in 0 .. v_count - 1 loop
    v_record := v_records -> v_index;
    v_result := null;

    begin
      v_report := public.import_record_validate(v_record);

      if not (v_report ->> 'ok')::boolean then
        v_result := jsonb_build_object(
          'index', v_index,
          'external_product_id', coalesce(v_record ->> 'external_product_id', ''),
          'outcome', 'rejected',
          'imported_deal_id', null,
          'event_id', null,
          'raw_hash', '',
          'errors', v_report -> 'errors');
      else
        v_values   := v_report -> 'values';
        v_hash     := v_values ->> 'raw_hash';
        v_title    := v_values ->> 'title';
        v_currency := coalesce(v_values ->> 'imported_currency', '');
        v_media    := coalesce(v_values -> 'media', '[]'::jsonb);
        v_price    := case
                        when jsonb_typeof(v_values -> 'imported_price') = 'number'
                          then (v_values ->> 'imported_price')::numeric(14, 2)
                        else null
                      end;

        /* 9b-i. The merchant: this source's business, upserted by the source's
           own reference for it, or by name within the source when it has none.
           Nothing here touches a PickVanta account, and nothing ever will. */
        if coalesce(v_values ->> 'merchant_ref', '') <> '' then
          insert into public.external_merchants (name, merchant_ref, website_url, country, source_id)
          values (v_values ->> 'merchant_name',
                  v_values ->> 'merchant_ref',
                  coalesce(v_values ->> 'merchant_website', ''),
                  coalesce(v_values ->> 'merchant_country', ''),
                  v_source_id)
          on conflict (source_id, merchant_ref) where merchant_ref <> '' and source_id is not null
          do update set name        = excluded.name,
                        website_url = excluded.website_url,
                        country     = excluded.country
          returning id into v_merchant_id;
        else
          select id into v_merchant_id
            from public.external_merchants
           where source_id = v_source_id
             and merchant_ref = ''
             and name = v_values ->> 'merchant_name'
           limit 1;
          if v_merchant_id is null then
            insert into public.external_merchants (name, merchant_ref, website_url, country, source_id)
            values (v_values ->> 'merchant_name', '', coalesce(v_values ->> 'merchant_website', ''),
                    coalesce(v_values ->> 'merchant_country', ''), v_source_id)
            returning id into v_merchant_id;
          end if;
        end if;

        /* 9b-ii. The identity: one record per (source, the source's own
           product id). Locked here so two runs cannot both create it. */
        select * into v_deal
          from public.imported_deals
         where source_id = v_source_id
           and external_product_id = v_values ->> 'external_product_id'
         for update;
        v_existed := found;
        v_new_id  := null;

        if not v_existed then
          insert into public.imported_deals
            (source_id, job_id, external_merchant_id,
             external_product_id, merchant_name, merchant_ref, source_url,
             imported_title, imported_description, imported_price, imported_currency,
             imported_availability, imported_category, imported_metadata,
             raw_hash, last_seen_at)
          values
            (v_source_id, v_job_id, v_merchant_id,
             v_values ->> 'external_product_id', v_values ->> 'merchant_name',
             coalesce(v_values ->> 'merchant_ref', ''), v_values ->> 'source_url',
             v_title, coalesce(v_values ->> 'description', ''), v_price, v_currency,
             coalesce(v_values ->> 'availability_text', ''), coalesce(v_values ->> 'category_text', ''),
             v_values -> 'raw', v_hash, now())
          on conflict (source_id, external_product_id) where external_product_id <> ''
          do nothing
          returning id into v_new_id;

          if v_new_id is null then
            /* Another run inserted the same identity first. Take the row it
               wrote and treat this as a re-import; nothing is duplicated. */
            select * into v_deal
              from public.imported_deals
             where source_id = v_source_id
               and external_product_id = v_values ->> 'external_product_id'
             for update;
            v_existed := true;
          end if;
        end if;

        if v_new_id is not null then
          perform public.import_media_replace(v_new_id, v_media);
          insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
          values (v_new_id, 'imported', 'imported',
                  'The record arrived from the source and is kept as it arrived.', v_event_data)
          returning id into v_event_id;

          v_result := jsonb_build_object(
            'index', v_index,
            'external_product_id', v_values ->> 'external_product_id',
            'outcome', 'imported',
            'imported_deal_id', v_new_id,
            'event_id', v_event_id,
            'raw_hash', v_hash,
            'errors', '[]'::jsonb);

        elsif v_deal.pipeline_status = any (v_locked_statuses) then
          /* A person decided this record. The source re-sending it is a fact
             worth recording, not a reason to overwrite the decision. */
          insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
          values (v_deal.id, 'imported', 'skipped-locked',
                  format('The source sent this record again while it stands at "%s". A human decision is not overwritten by an import.',
                         v_deal.pipeline_status),
                  v_event_data || jsonb_build_object('previous_job_id', v_deal.job_id,
                                                     'previous_raw_hash', v_deal.raw_hash))
          returning id into v_event_id;

          v_result := jsonb_build_object(
            'index', v_index,
            'external_product_id', v_values ->> 'external_product_id',
            'outcome', 'skipped',
            'imported_deal_id', v_deal.id,
            'event_id', v_event_id,
            'raw_hash', v_deal.raw_hash,
            'errors', '[]'::jsonb);

        elsif v_deal.raw_hash = v_hash then
          /* The same evidence again. The record moves; the log does not need a
             row to say that nothing happened. */
          update public.imported_deals set last_seen_at = now() where id = v_deal.id;

          v_result := jsonb_build_object(
            'index', v_index,
            'external_product_id', v_values ->> 'external_product_id',
            'outcome', 'unchanged',
            'imported_deal_id', v_deal.id,
            'event_id', null,
            'raw_hash', v_hash,
            'errors', '[]'::jsonb);

        elsif v_deal.pipeline_status = 'pending-review' then
          /* Waiting for a reviewer. The source data behind the record is
             refreshed in place and the review state is kept, so the person
             decides on what the source says now — and the event says it moved. */
          v_note := 'The record is waiting for review; the source data behind it was refreshed in place and the review state was kept.';

          update public.imported_deals
             set job_id               = v_job_id,
                 external_merchant_id = v_merchant_id,
                 merchant_name        = v_values ->> 'merchant_name',
                 merchant_ref         = coalesce(v_values ->> 'merchant_ref', ''),
                 source_url           = v_values ->> 'source_url',
                 imported_title       = v_title,
                 imported_description = coalesce(v_values ->> 'description', ''),
                 imported_price       = v_price,
                 imported_currency    = v_currency,
                 imported_availability = coalesce(v_values ->> 'availability_text', ''),
                 imported_category    = coalesce(v_values ->> 'category_text', ''),
                 imported_metadata    = v_values -> 'raw',
                 raw_hash             = v_hash,
                 last_seen_at         = now()
           where id = v_deal.id;

          perform public.import_media_replace(v_deal.id, v_media);

          insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
          values (v_deal.id, 'imported', 'refreshed', v_note,
                  v_event_data || jsonb_build_object('previous_job_id', v_deal.job_id,
                                                     'previous_raw_hash', v_deal.raw_hash))
          returning id into v_event_id;

          v_result := jsonb_build_object(
            'index', v_index,
            'external_product_id', v_values ->> 'external_product_id',
            'outcome', 'updated',
            'imported_deal_id', v_deal.id,
            'event_id', v_event_id,
            'raw_hash', v_hash,
            'errors', '[]'::jsonb);

        else
          /* The evidence changed before any decision was made, so the earlier
             processing no longer applies to what the record now says. It goes
             back to the beginning rather than looking processed while holding
             stale values. Nothing a person decided is touched here. */
          v_note := 'The source data changed, so the earlier processing no longer applies and the record starts again at imported.';

          update public.imported_deals
             set job_id               = v_job_id,
                 external_merchant_id = v_merchant_id,
                 merchant_name        = v_values ->> 'merchant_name',
                 merchant_ref         = coalesce(v_values ->> 'merchant_ref', ''),
                 source_url           = v_values ->> 'source_url',
                 imported_title       = v_title,
                 imported_description = coalesce(v_values ->> 'description', ''),
                 imported_price       = v_price,
                 imported_currency    = v_currency,
                 imported_availability = coalesce(v_values ->> 'availability_text', ''),
                 imported_category    = coalesce(v_values ->> 'category_text', ''),
                 imported_metadata    = v_values -> 'raw',
                 raw_hash             = v_hash,
                 last_seen_at         = now(),
                 pipeline_status      = 'imported',
                 validation_status    = 'not-run',
                 validation_result    = '',
                 normalization_status = 'not-run',
                 normalization_result = '',
                 deduplication_status = 'not-run',
                 deduplication_result = '',
                 dedup_match_class    = 'unknown',
                 dedup_matched_deal_id = null,
                 normalized_name      = '',
                 normalized_brand     = '',
                 normalized_category_id = '',
                 normalized_availability = '',
                 model_number         = '',
                 gtin                 = '',
                 error                = ''
           where id = v_deal.id;

          perform public.import_media_replace(v_deal.id, v_media);

          insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
          values (v_deal.id, 'imported', 'refreshed', v_note,
                  v_event_data || jsonb_build_object('previous_job_id', v_deal.job_id,
                                                     'previous_raw_hash', v_deal.raw_hash))
          returning id into v_event_id;

          v_result := jsonb_build_object(
            'index', v_index,
            'external_product_id', v_values ->> 'external_product_id',
            'outcome', 'updated',
            'imported_deal_id', v_deal.id,
            'event_id', v_event_id,
            'raw_hash', v_hash,
            'errors', '[]'::jsonb);
        end if;
      end if;

    exception when others then
      /* The record failed for a reason the rules above did not name — a
         constraint, a deadlock victim, an arithmetic edge. It is refused, with
         what the database said, and the batch carries on. */
      v_result := jsonb_build_object(
        'index', v_index,
        'external_product_id', coalesce(v_record ->> 'external_product_id', ''),
        'outcome', 'rejected',
        'imported_deal_id', null,
        'event_id', null,
        'raw_hash', '',
        'errors', jsonb_build_array(jsonb_build_object(
          'field', 'record',
          'reason', 'the database refused this record: ' || SQLERRM,
          'sqlstate', SQLSTATE)));
    end;

    if v_result is null then
      v_result := jsonb_build_object(
        'index', v_index,
        'external_product_id', coalesce(v_record ->> 'external_product_id', ''),
        'outcome', 'rejected',
        'imported_deal_id', null,
        'event_id', null,
        'raw_hash', '',
        'errors', jsonb_build_array(jsonb_build_object('field', 'record', 'reason', 'the record produced no outcome')));
    end if;

    case v_result ->> 'outcome'
      when 'imported'  then v_imported := v_imported + 1;
      when 'updated'   then v_updated := v_updated + 1;
      when 'unchanged' then v_unchanged := v_unchanged + 1;
      when 'skipped'   then v_skipped := v_skipped + 1;
      else v_rejected := v_rejected + 1;
    end case;

    v_results := v_results || v_result;
  end loop;

  return jsonb_build_object(
    'batch_version', p_batch -> 'batch_version',
    'source_id',     v_source_id,
    'job_id',        v_job_id,
    'received',      v_count,
    'imported',      v_imported,
    'updated',       v_updated,
    'unchanged',     v_unchanged,
    'skipped',       v_skipped,
    'rejected',      v_rejected,
    'results',       v_results);
end $$;


-- ---------------------------------------------------------------------------
-- 10. Privileges — one door, one key
-- ---------------------------------------------------------------------------
-- Nothing here is callable from a browser. The three outer functions are the
-- boundary the runner uses; the helpers are callable by nobody at all (they run
-- inside the definer functions, under the definer's rights). This is the
-- project's existing pattern, applied to the one new door: 0006 revoked its
-- validator from clients so it could not be used as an oracle, and 0010 granted
-- its conversion to authenticated alone because an administrator makes that
-- decision. An import is not a decision; it is a machine writing untrusted
-- data, and the only role that may do it is the runner's.
revoke all on function public.import_text_issues(jsonb, text, boolean, integer, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.import_check_keys(jsonb, text[], jsonb, text)
  from public, anon, authenticated;
revoke all on function public.import_record_validate(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_batch_validate(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_media_replace(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.import_job_start(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.import_job_finish(uuid, text, jsonb, text, smallint)
  from public, anon, authenticated;
revoke all on function public.import_ingest(jsonb)
  from public, anon, authenticated;

/* service_role exists on Supabase and not in a bare local PostgreSQL, so the
   grant is guarded: the revokes above are not. A local rig without the role
   still applies this migration and still holds no client-executable door. */
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.import_job_start(text, uuid, text) to service_role;
    grant execute on function public.import_job_finish(uuid, text, jsonb, text, smallint) to service_role;
    grant execute on function public.import_ingest(jsonb) to service_role;
  end if;
end $$;

comment on function public.import_ingest(jsonb) is
  'The only path by which data from outside PickVanta becomes records: one batch, one transaction, one event per touched record. Writes merchants, imported records, their media references and the event trail; never a pipeline status above imported, a review decision, a normalized value, an affiliate link or anything in the canonical layer. Service-role only.';
comment on function public.import_job_start(text, uuid, text) is
  'Starts one Deal Engine run: a job row at running, with the vocabulary 0005 defined. Refuses a source that is not active, and refuses a second running job for the same source by naming it, so a stuck run is closed by a person rather than overwritten.';
comment on function public.import_job_finish(uuid, text, jsonb, text, smallint) is
  'Ends a run as succeeded, failed or cancelled, with its statistics. A failure must carry a reason; a finished run is never rewritten. Statistics are a bounded JSON object, because the job record is what an operator reads when a source changes shape.';
comment on function public.import_batch_validate(jsonb) is
  'The envelope rules of the ingest contract (17C-A): a closed key set, batch version 1, a source and job uuid, a described connector and an ISO 8601 fetch time, at most 500 records. Raises, because an envelope that is wrong means the call never proceeded. Internal: EXECUTE is revoked from every client role.';
comment on function public.import_record_validate(jsonb) is
  'One record against the ingest contract, returned as a report of {field, reason} rather than an exception, so a record with three problems is told about all three. Refuses what cannot be stored and refuses the pipeline''s own keys by name; it does not judge quality, because an unmapped category is a storable fact. Internal: EXECUTE is revoked from every client role.';


-- ---------------------------------------------------------------------------
-- 11. Self-check — fail the migration rather than leave a quiet hole
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  entry    record;
  v_oid    oid;
  v_name   text;
  v_def    text;
begin
  /* 11a. The functions exist, with the security attributes they claim. */
  for entry in
    select * from (values
      ('public.import_ingest(jsonb)', true),
      ('public.import_job_start(text, uuid, text)', true),
      ('public.import_job_finish(uuid, text, jsonb, text, smallint)', true),
      ('public.import_batch_validate(jsonb)', false),
      ('public.import_record_validate(jsonb)', false),
      ('public.import_media_replace(uuid, jsonb)', false),
      ('public.import_check_keys(jsonb, text[], jsonb, text)', false),
      ('public.import_text_issues(jsonb, text, boolean, integer, text, text, boolean)', false)
    ) as t(signature, definer)
  loop
    v_oid := to_regprocedure(entry.signature)::oid;
    if v_oid is null then
      problems := problems || (entry.signature || ' was not created');
      continue;
    end if;
    if entry.definer and not (select prosecdef from pg_proc where oid = v_oid) then
      problems := problems || (entry.signature || ' must be security definer');
    end if;
    if not entry.definer and (select prosecdef from pg_proc where oid = v_oid) then
      problems := problems || (entry.signature || ' must not run with privileges it does not need');
    end if;
    if not ((select proconfig from pg_proc where oid = v_oid) @> array['search_path=public, pg_temp']) then
      problems := problems || (entry.signature || ' does not pin its search path');
    end if;
  end loop;

  /* 11b. No client role can reach any of them. */
  if exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in ('import_ingest', 'import_job_start', 'import_job_finish',
                           'import_batch_validate', 'import_record_validate',
                           'import_media_replace', 'import_check_keys', 'import_text_issues')
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type = 'EXECUTE'
  ) then
    problems := problems || 'a client role holds EXECUTE on an import function';
  end if;

  /* 11c. Where the runner's role exists, the boundary is reachable by it. */
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if (select count(*) from information_schema.routine_privileges
        where routine_schema = 'public'
          and routine_name in ('import_ingest', 'import_job_start', 'import_job_finish')
          and grantee = 'service_role'
          and privilege_type = 'EXECUTE') <> 3 then
      problems := problems || 'service_role cannot call the whole ingest boundary';
    end if;
  end if;

  /* 11d. The columns, constraints and indexes this migration promised. */
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'imported_deals'
      and column_name = 'last_seen_at' and is_nullable = 'NO'
  ) then
    problems := problems || 'imported_deals.last_seen_at was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'imported_deals'
      and column_name = 'raw_hash' and is_nullable = 'NO'
  ) then
    problems := problems || 'imported_deals.raw_hash was not created';
  end if;

  foreach v_name in array array['imported_deals_raw_hash_shape', 'imported_deals_price_needs_currency'] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.imported_deals'::regclass and conname = v_name
    ) then
      problems := problems || ('the constraint ' || v_name || ' is missing');
    end if;
  end loop;

  foreach v_name in array array['deal_engine_jobs_created_at_idx', 'deal_engine_jobs_source_created_idx',
                                'external_merchants_source_ref_key', 'imported_deals_merchant_idx'] loop
    if to_regclass('public.' || v_name) is null then
      problems := problems || ('the index ' || v_name || ' is missing');
    end if;
  end loop;

  /* 11e. The posture 0005 and 0008 established is unchanged: no write policy on
     any of these tables, and no write privilege for a client role. */
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('deal_sources', 'external_merchants', 'deal_engine_jobs',
                        'imported_deals', 'imported_deal_media', 'deal_engine_events')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    problems := problems || 'a write policy exists on a deal-engine table';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('deal_sources', 'external_merchants', 'deal_engine_jobs',
                         'imported_deals', 'imported_deal_media', 'deal_engine_events')
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    problems := problems || 'a client role can write a deal-engine table directly';
  end if;

  /* 11f. The boundary mentions nothing it must not write. A blunt textual guard
     in the spirit of 0005's structural assertions: if a later edit reaches for
     the canonical layer or an affiliate link from inside this function, the
     migration says so rather than trusting a reviewer to notice. */
  v_def := pg_get_functiondef(to_regprocedure('public.import_ingest(jsonb)'));
  if v_def ~* '(public\.products|public\.product_variants|public\.merchant_offers|public\.merchant_offer_media|public\.imported_deal_conversions|affiliate_url|published_deal_id|review_status|insert into public\.deal_sources)' then
    problems := problems || 'the ingest boundary mentions something it must not write';
  end if;

  if array_length(problems, 1) > 0 then
    raise exception 'Import engine migration self-check failed: %', array_to_string(problems, '; ');
  end if;

  raise notice 'import engine: the ingest boundary is in place, callable by service_role alone, and writes nothing it was not given.';
end $$;
