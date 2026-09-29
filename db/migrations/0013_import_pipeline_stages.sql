-- ============================================================================
-- 0013_import_pipeline_stages.sql — Blocker #2: the processing pipeline.
--
-- What was missing: after import_ingest() stored a record at
-- pipeline_status = 'imported', nothing advanced it. The validation and
-- normalization stages existed only as columns and vocabulary, import_dedup()
-- (0012) had no processing company, and no rule moved a clean record to
-- pending-review — so the admin review queue could never fill and the review
-- boundary could never be reached. Docs §7 (steps 5-8) assigns exactly these
-- stages to the post-ingest pipeline:
--
--   5 Validation     → validation_status/result, event 'validation',
--                      pipeline 'validated' when it passes
--   6 Normalization  → normalized_* columns, normalization_status/result,
--                      event 'normalization', pipeline 'normalized'
--   7 Deduplication  → already implemented: public.import_dedup() (0012),
--                      unchanged here
--   8 Promotion      → pipeline 'pending-review', review_status 'pending',
--                      event 'review' — the stop line before human review
--
-- This migration implements 5, 6 and 8 with two functions, using the job
-- architecture and the security pattern 0012 established (the same lifecycle
-- validation, the same row locks, the same privilege model):
--
--   public.import_normalize(p_job_id)
--     Runs under a running 'normalization' job (a job type 0005 already
--     defines). For each of the source's arrived, undecided records it
--     performs stage 5 then stage 6: validation first — the record's stored
--     evidence is re-checked against the established rules no column
--     constraint already refuses (D3's identity requirement, D7's bounds,
--     the affiliate prohibition, N4's object rule; the shapes 0005's own
--     check constraints enforce — currency, source URL, price sign — are
--     enforced by those constraints and need no second enforcement) — and,
--     when it passes, normalization:
--     deterministic derivations into the columns that already exist. A
--     record the source sent again with new evidence re-enters here through
--     0011's refresh, which resets every stage status; a record that fails
--     is marked failed with its reasons and is revived only by that refresh —
--     it is never deleted and never silently dropped.
--
--   public.import_promote(p_job_id)
--     Runs under a running 'deduplication' job, after import_dedup() on the
--     same job. A record is promoted only when every documented stage passed:
--     validation passed, normalization passed, deduplication passed with the
--     new-product class and no pointer. It moves to pending-review with
--     review_status 'pending' — the exact state the admin review queue reads
--     — and stops there. Nothing in this file approves, publishes or
--     converts: those remain the administrator's alone (0010/17A).
--
-- The recommended operator sequence for one source is therefore the three
-- runs the job vocabulary already names:
--     feed-import job:   import_job_start → import_ingest → import_job_finish
--     normalization job: import_job_start → import_normalize → import_job_finish
--     deduplication job: import_job_start → import_dedup → import_promote
--                        → import_job_finish
-- Each function is idempotent — a re-run finds nothing eligible and changes
-- nothing — so the sequence is safe to repeat, and a record the source
-- refreshed re-enters at the beginning on the next run.
--
-- Determinism and honesty rules this file follows: every rule the validation
-- stage applies is one the repository already establishes (no invented
-- product-quality bars); normalization derives only what the stored evidence
-- deterministically supports — the name (whitespace-collapsed title) and a
-- taxonomy match for the category (0005's stated mechanism: exact match
-- against the 0001 taxonomy, an unmapped category staying visible as '') —
-- and leaves brand, model, GTIN and canonical availability EMPTY for review
-- rather than fabricating them (no contract field carries them yet; an
-- availability decision is a canonical choice, not a copy of source text).
-- Provenance columns are never written here. No record is merged or deleted.
-- An uncertain dedup classification is never upgraded: such records are
-- already at pending-review through 0012 and promotion does not touch them.
--
-- One ordering note: a source processed in the older order (deduplicated
-- before validation) is still completed correctly — import_normalize fills
-- the missing stages without moving the pipeline backwards, and the next
-- deduplication run's promotion picks the record up.
--
-- No schema change: every column, state, event stage and job type this file
-- writes is the existing one. The connector's three-RPC contract is
-- untouched: these are processing-side functions for the runner's service
-- key, granted exactly like 0012's (revoked from every client role).
--
-- Re-runnable. Rollback:
--   drop function public.import_promote(uuid);
--   drop function public.import_normalize(uuid);
--
-- Apply after db/migrations/0012_import_job_start_lock.sql.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Pre-flight — the pipeline this builds on has to be there, with the
--    vocabularies this file writes to.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.import_dedup(uuid)') is null then
    raise exception 'Apply db/migrations/0012_import_job_start_lock.sql before this file: public.import_dedup() is missing.';
  end if;
  if to_regclass('public.imported_deals') is null
     or to_regclass('public.deal_engine_jobs') is null
     or to_regclass('public.deal_engine_events') is null then
    raise exception 'Apply db/migrations/0005_deal_engine_foundation.sql before this file: the Deal Engine tables are missing.';
  end if;
  if to_regclass('public.categories') is null
     or to_regclass('public.subcategories') is null then
    raise exception 'Apply db/migrations/0001_catalogue.sql before this file: the taxonomy is missing.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.deal_engine_jobs'::regclass
       and contype = 'c'
       and conname = 'deal_engine_jobs_job_type_check'
       and pg_get_constraintdef(oid) like '%normalization%'
       and pg_get_constraintdef(oid) like '%deduplication%') then
    raise exception 'The deal_engine_jobs job-type vocabulary is not the expected one: a ''normalization'' or ''deduplication'' job could not be recorded.';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.deal_engine_events'::regclass
       and contype = 'c'
       and conname = 'deal_engine_events_stage_check'
       and pg_get_constraintdef(oid) like '%validation%'
       and pg_get_constraintdef(oid) like '%normalization%'
       and pg_get_constraintdef(oid) like '%review%') then
    raise exception 'The deal_engine_events stage vocabulary is not the expected one: validation, normalization or review events could not be recorded.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Stage 5 + 6: validation, then normalization, under one running
--    'normalization' job.
-- ---------------------------------------------------------------------------
create or replace function public.import_normalize(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decided text[] := array['approved', 'rejected', 'archived'];

  v_job        public.deal_engine_jobs;
  v_source     public.deal_sources;
  v_record     public.imported_deals;
  v_source_id  uuid;
  v_reasons    jsonb;
  v_name       text;
  v_cat        text;
  v_cat_id     text;
  v_note       text;
  v_prev_pipe  text;
  v_examined   integer := 0;
  v_validated  integer := 0;
  v_val_failed integer := 0;
  v_normalized integer := 0;
  v_nor_failed integer := 0;
begin
  if p_job_id is null then
    raise exception 'A job id is required' using errcode = '22023';
  end if;

  /* The run's own row, locked — 0011/0012's idiom. Two callers of one job
     serialise here; the second finds nothing left eligible. */
  select * into v_job from public.deal_engine_jobs where id = p_job_id for update;
  if not found then
    raise exception 'No job with that id' using errcode = 'P0002';
  end if;

  if v_job.job_type <> 'normalization' then
    raise exception 'A "%" job does not validate and normalize records', v_job.job_type using errcode = '22023';
  end if;

  if v_job.status <> 'running' then
    raise exception 'That job is "%", and records are processed only while a job is running',
      v_job.status using errcode = '22023';
  end if;

  if v_job.source_id is null then
    raise exception 'That job names no source, and a processing run works on one source''s records'
      using errcode = '22023';
  end if;
  v_source_id := v_job.source_id;

  select * into v_source from public.deal_sources where id = v_source_id;
  if not found then
    raise exception 'No source with that id' using errcode = 'P0002';
  end if;
  if v_source.status <> 'active' then
    raise exception 'That source is "%"; only an active source may be read', v_source.status
      using errcode = '22023';
  end if;

  /* The source's own records only, locked in id order — the deterministic
     order 0012 uses. Eligible: arrived and not decided. 'deduplicated'
     records are included so a source processed in the older order still
     receives its missing stages; the pipeline never moves backwards. */
  for v_record in
    select * from public.imported_deals
     where source_id = v_source_id
       and pipeline_status in ('imported', 'validated', 'deduplicated')
       and review_status <> all (v_decided)
     order by id
     for update
  loop
    v_examined  := v_examined + 1;
    v_prev_pipe := v_record.pipeline_status;

    /* ------------------------------------------------ stage 5: validation
       Every rule here is one the repository already establishes, and one no
       column constraint already refuses — the shapes 0005 enforces at the
       column (currency code, source-URL shape, price sign) cannot be stored
       in violation, so re-checking them here would be a rule that can never
       fire. What validation re-checks is exactly what the stored evidence
       can still violate: a missing identity, oversized text, an affiliate
       link, evidence that is not an object. Nothing is invented and nothing
       is discarded: a failed record keeps its evidence and its trail, and
       only 0011's evidence refresh returns it to the pipeline. */
    if v_record.validation_status = 'not-run' then
      v_reasons := '[]'::jsonb;
      if coalesce(v_record.external_product_id, '') = '' then
        v_reasons := v_reasons || jsonb_build_object('field', 'external_product_id',
          'reason', 'the record has no external product id, so it has no identity (17C-A D3)');
      end if;
      if char_length(v_record.imported_title) > 500 then
        v_reasons := v_reasons || jsonb_build_object('field', 'title',
          'reason', 'the title is longer than the 500 characters the ingest contract allows (17C-A D7)');
      end if;
      if char_length(v_record.imported_description) > 8000 then
        v_reasons := v_reasons || jsonb_build_object('field', 'description',
          'reason', 'the description is longer than the 8000 characters the ingest contract allows (17C-A D7)');
      end if;
      if v_record.affiliate_url <> '' then
        v_reasons := v_reasons || jsonb_build_object('field', 'affiliate_url',
          'reason', 'an affiliate link exists before any agreement does; the pipeline never carries one (17C-A)');
      end if;
      if jsonb_typeof(v_record.imported_metadata) <> 'object' then
        v_reasons := v_reasons || jsonb_build_object('field', 'raw',
          'reason', 'the stored evidence is not an object, and only an object may be (17C-A N4)');
      end if;

      if jsonb_array_length(v_reasons) > 0 then
        v_note := 'Validation failed: the stored evidence does not satisfy ' || jsonb_array_length(v_reasons)::text
                  || ' established rule(s). The record is kept, marked failed, and re-enters the pipeline only when the source sends new evidence.';
        update public.imported_deals
           set validation_status   = 'failed',
               validation_result   = v_note,
               pipeline_status     = 'failed',
               error               = v_note
         where id = v_record.id;

        insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
        values (v_record.id, 'validation', 'failed', v_note,
                jsonb_build_object(
                  'job_id',                   p_job_id,
                  'reasons',                  v_reasons,
                  'previous_pipeline_status', v_prev_pipe));
        v_val_failed := v_val_failed + 1;
        continue;  -- a failed record is not normalized
      else
        v_note := 'The stored evidence satisfies the established rules: identity present, text sizes within the ingest contract, no affiliate link, raw evidence an object.';
        update public.imported_deals
           set validation_status   = 'passed',
               validation_result   = v_note,
               pipeline_status     = case when v_record.pipeline_status = 'imported'
                                          then 'validated' else v_record.pipeline_status end
         where id = v_record.id;

        insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
        values (v_record.id, 'validation', 'passed', v_note,
                jsonb_build_object(
                  'job_id',                   p_job_id,
                  'previous_pipeline_status', v_prev_pipe));
        v_validated := v_validated + 1;
      end if;
    elsif v_record.validation_status = 'failed' then
      /* Already refused; only new evidence (0011's refresh) revives it. */
      continue;
    end if;

    /* ------------------------------------------- stage 6: normalization
       Deterministic derivations only. The name is the title with whitespace
       collapsed; the category is an exact, case-insensitive match against
       the 0001 taxonomy (subcategory preferred, then category; an unmapped
       or absent category stays ''). Brand, model number, GTIN and canonical
       availability have no established source in the stored evidence and are
       left empty for the reviewer — nothing is manufactured here. */
    if v_record.normalization_status = 'not-run' then
      v_name := btrim(regexp_replace(v_record.imported_title, '\s+', ' ', 'g'));
      if v_name = '' then
        v_note := 'Normalization failed: the record carries no title, so the one field normalization can derive — its name — does not exist. The record is kept, marked failed, and re-enters the pipeline only when the source sends new evidence.';
        update public.imported_deals
           set normalization_status   = 'failed',
               normalization_result   = v_note,
               pipeline_status        = 'failed',
               error                  = v_note
         where id = v_record.id;

        insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
        values (v_record.id, 'normalization', 'failed', v_note,
                jsonb_build_object(
                  'job_id',                   p_job_id,
                  'reasons',                  jsonb_build_array(jsonb_build_object(
                    'field', 'title', 'reason', 'no title to derive a name from')),
                  'previous_pipeline_status', v_prev_pipe));
        v_nor_failed := v_nor_failed + 1;
      else
        v_cat    := btrim(coalesce(v_record.imported_category, ''));
        v_cat_id := '';
        if v_cat <> '' then
          select coalesce(sub.id, cat.id, '')
            into v_cat_id
            from (select v_cat as needle) n
            left join lateral (
              select s.id from public.subcategories s
               where lower(s.name) = lower(n.needle) or lower(s.slug) = lower(n.needle)
               order by s.id limit 1
            ) sub on true
            left join lateral (
              select c.id from public.categories c
               where lower(c.name) = lower(n.needle) or lower(c.slug) = lower(n.needle)
               order by c.id limit 1
            ) cat on true;

          if v_cat_id = '' then
            v_note := 'Normalized from the stored evidence: the name is the record''s title with whitespace collapsed. The category "' || v_cat || '" matches nothing in the taxonomy, so it stays unmapped and visible for review. Brand, model number, GTIN and canonical availability are left empty: the evidence does not establish them, and normalization does not invent catalogue facts.';
          else
            v_note := 'Normalized from the stored evidence: the name is the record''s title with whitespace collapsed, and the category matched the taxonomy exactly. Brand, model number, GTIN and canonical availability are left empty: the evidence does not establish them, and normalization does not invent catalogue facts.';
          end if;
        else
          v_note := 'Normalized from the stored evidence: the name is the record''s title with whitespace collapsed. The record names no category, so none is mapped. Brand, model number, GTIN and canonical availability are left empty: the evidence does not establish them, and normalization does not invent catalogue facts.';
        end if;

        update public.imported_deals
           set normalized_name         = v_name,
               normalized_brand        = '',
               normalized_category_id  = v_cat_id,
               normalized_availability = '',
               model_number            = '',
               gtin                    = '',
               normalization_status    = 'passed',
               normalization_result    = v_note,
               pipeline_status         = case when v_record.pipeline_status = 'deduplicated'
                                              then 'deduplicated' else 'normalized' end
         where id = v_record.id;

        insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
        values (v_record.id, 'normalization', 'passed', v_note,
                jsonb_build_object(
                  'job_id',                   p_job_id,
                  'normalized_category_id',   v_cat_id,
                  'category_matched',         v_cat_id <> '',
                  'previous_pipeline_status', v_prev_pipe));
        v_normalized := v_normalized + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'job_id',             p_job_id,
    'source_id',          v_source_id,
    'examined',           v_examined,
    'validated',          v_validated,
    'validation_failed',  v_val_failed,
    'normalized',         v_normalized,
    'normalization_failed', v_nor_failed);
end $$;


-- ---------------------------------------------------------------------------
-- 3. Stage 8: promotion — the stop line. Runs under the same running
--    'deduplication' job that import_dedup() classified the source with.
-- ---------------------------------------------------------------------------
create or replace function public.import_promote(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decided text[] := array['approved', 'rejected', 'archived'];

  v_job       public.deal_engine_jobs;
  v_source    public.deal_sources;
  v_record    public.imported_deals;
  v_source_id uuid;
  v_examined  integer := 0;
  v_promoted  integer := 0;
  v_withheld  integer := 0;
begin
  if p_job_id is null then
    raise exception 'A job id is required' using errcode = '22023';
  end if;

  select * into v_job from public.deal_engine_jobs where id = p_job_id for update;
  if not found then
    raise exception 'No job with that id' using errcode = 'P0002';
  end if;

  if v_job.job_type <> 'deduplication' then
    raise exception 'A "%" job does not promote records', v_job.job_type using errcode = '22023';
  end if;

  if v_job.status <> 'running' then
    raise exception 'That job is "%", and records are promoted only while a job is running',
      v_job.status using errcode = '22023';
  end if;

  if v_job.source_id is null then
    raise exception 'That job names no source, and a promotion pass works on one source''s records'
      using errcode = '22023';
  end if;
  v_source_id := v_job.source_id;

  select * into v_source from public.deal_sources where id = v_source_id;
  if not found then
    raise exception 'No source with that id' using errcode = 'P0002';
  end if;
  if v_source.status <> 'active' then
    raise exception 'That source is "%"; only an active source may be read', v_source.status
      using errcode = '22023';
  end if;

  for v_record in
    select * from public.imported_deals
     where source_id = v_source_id
       and pipeline_status = 'deduplicated'
       and review_status <> all (v_decided)
     order by id
     for update
  loop
    v_examined := v_examined + 1;

    /* Every documented stage passed, and dedup said new-product with no
       pointer. Anything else stays at deduplicated: an uncertain match is
       already at pending-review through 0012 and is never re-decided here,
       and a record with a missing stage waits for the run that completes it. */
    if v_record.validation_status = 'passed'
       and v_record.normalization_status = 'passed'
       and v_record.deduplication_status = 'passed'
       and v_record.dedup_match_class = 'new-product'
       and v_record.dedup_matched_deal_id is null then

      update public.imported_deals
         set pipeline_status = 'pending-review',
             review_status   = 'pending'
       where id = v_record.id;

      insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
      values (v_record.id, 'review', 'submitted',
              'Every processing stage passed, so the record is submitted for review. This is the stop line: a person decides what happens next, and nothing publishes itself.',
              jsonb_build_object(
                'job_id',                   p_job_id,
                'previous_pipeline_status', v_record.pipeline_status,
                'dedup_match_class',        v_record.dedup_match_class));
      v_promoted := v_promoted + 1;
    else
      v_withheld := v_withheld + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'job_id',     p_job_id,
    'source_id',  v_source_id,
    'examined',   v_examined,
    'promoted',   v_promoted,
    'withheld',   v_withheld);
end $$;


-- ---------------------------------------------------------------------------
-- 4. Privileges — 0012's model exactly: the runner's key, nobody else.
-- ---------------------------------------------------------------------------
revoke all on function public.import_normalize(uuid)
  from public, anon, authenticated;
revoke all on function public.import_promote(uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.import_normalize(uuid) to service_role;
    grant execute on function public.import_promote(uuid) to service_role;
  end if;
end $$;

comment on function public.import_normalize(uuid) is
  'The validation and normalization stages (docs §7 steps 5-6), under one running ''normalization'' job: re-checks each arrived, undecided record against the rules the project already establishes, then derives the normalized fields the evidence deterministically supports — the name (whitespace-collapsed title) and an exact taxonomy match for the category — leaving brand, model, GTIN and canonical availability empty for review rather than inventing them. A record that fails a stage is kept, marked failed with its reasons, and re-enters only through 0011''s evidence refresh. Idempotent; per-record row locks in id order; never touches provenance. Service-role only; the run is closed by import_job_finish().';

comment on function public.import_promote(uuid) is
  'The promotion stage (docs §7 step 8 — the stop line), under the running ''deduplication'' job after import_dedup(): a record whose validation, normalization and deduplication all passed with the new-product class and no pointer moves to pending-review with review_status pending — the state the admin review queue reads. Nothing is approved, published or converted here, and an uncertain match is never re-decided. Idempotent. Service-role only.';


-- ---------------------------------------------------------------------------
-- 5. Self-check — the migration refuses to have applied half of itself.
-- ---------------------------------------------------------------------------
do $$
declare
  v_problems text[] := '{}';
begin
  if (select count(*) from pg_proc where proname = 'import_normalize') <> 1 then
    v_problems := v_problems || 'import_normalize must be exactly one function';
  end if;
  if (select count(*) from pg_proc where proname = 'import_promote') <> 1 then
    v_problems := v_problems || 'import_promote must be exactly one function';
  end if;

  if exists (
    select 1 from pg_proc p
     where p.oid in ('public.import_normalize(uuid)'::regprocedure,
                     'public.import_promote(uuid)'::regprocedure)
       and (not p.prosecdef
            or coalesce(array_to_string(p.proconfig, ' '), '') not like '%search_path=public, pg_temp%'
            or p.prorettype <> 'jsonb'::regtype)) then
    v_problems := v_problems || 'both new functions must be security definer, pinned search path, returning jsonb';
  end if;

  if has_function_privilege('public', 'public.import_normalize(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.import_normalize(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.import_normalize(uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.import_promote(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.import_promote(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.import_promote(uuid)', 'EXECUTE') then
    v_problems := v_problems || 'a client role holds EXECUTE on a processing function';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and (not has_function_privilege('service_role', 'public.import_normalize(uuid)', 'EXECUTE')
          or not has_function_privilege('service_role', 'public.import_promote(uuid)', 'EXECUTE')) then
    v_problems := v_problems || 'service_role cannot call the processing functions';
  end if;

  if (select count(*) from pg_proc where proname like 'import_dedup%') <> 1 then
    v_problems := v_problems || 'import_dedup must remain exactly one function';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('imported_deals', 'deal_engine_jobs', 'deal_engine_events')
       and cmd in ('INSERT', 'UPDATE', 'DELETE')) then
    v_problems := v_problems || 'a write policy appeared on a Deal Engine table';
  end if;

  /* The stage boundary this file must never cross: no auto-approve, no
     auto-publish anywhere in the new bodies. (The eligibility arrays name
     the decided states they must skip; the check below is for an
     assignment, which would be a write.) */
  if exists (
    select 1 from pg_proc p
     where p.oid in ('public.import_normalize(uuid)'::regprocedure,
                     'public.import_promote(uuid)'::regprocedure)
       and (position('= ''approved''' in prosrc) > 0
            or position('= ''published''' in prosrc) > 0
            or position('= ''rejected''' in prosrc) > 0)) then
    v_problems := v_problems || 'a processing function writes a decided state';
  end if;

  if array_length(v_problems, 1) > 0 then
    raise exception 'Pipeline stages self-check failed: %',
      array_to_string(v_problems, '; ');
  end if;
end $$;
