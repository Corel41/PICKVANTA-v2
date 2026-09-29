-- ============================================================================
-- 0012_import_job_start_lock.sql — Step 17C-H: the job-start race, and the
-- deterministic deduplication stage.
--
-- Two parts, one migration, because docs §7 assigns the deduplication
-- processor to 0012 and R5 assigns it the promotion to pending-review.
--
-- PART A — the job-start race. The "one running job per source" rule was a
-- check followed by an insert, with no lock between them, so genuinely
-- simultaneous import_job_start() calls for one source could each read "no
-- running job" and each insert one. The external verification rig measured
-- exactly that: eight calls released at the same instant opened eight running
-- jobs for one source.
--
-- The fix is the row lock the rest of this project already uses:
-- import_ingest, import_job_finish and imported_deal_convert all take
-- SELECT ... FOR UPDATE before they decide. import_job_start now locks the
-- deal_sources row for the duration of its transaction. Two starts on one
-- source serialise: the first inserts its running job and commits; the second
-- re-reads the row only after that commit, so the running-job check it then
-- runs sees the first job and refuses — with the existing 22023 code and the
-- existing message that names the running job.
--
-- PART B — import_dedup(p_job_id), the deduplication stage the schema has
-- carried since 0005 and the docs have promised since 17C-A. It is
-- deterministic only, and it never merges: under the 17C-H Option-A ruling it
-- runs on the evidence records carry today (validation and normalization are
-- NOT required and are not performed), so the one matching signal that stored
-- records can actually support is the same non-blank external_product_id at
-- another source — exactly the cross-source relationship README §"Identity
-- and deduplication" keeps separate while calling it a decision for a person.
-- A record with candidates becomes 'uncertain-match' and is routed to
-- pending-review for a human, with the oldest candidate (created_at, id)
-- recorded as a representative pointer and the complete candidate set kept in
-- the deduplication event; a record without candidates becomes 'new-product'
-- and advances to the post-dedup state docs §7 establishes. GTIN and the
-- normalized columns are normalization output and are empty until a
-- processor exists, so no class is manufactured from them; exact-match and
-- probable-match stay defined by 0005 and unreachable until then.
--
-- What the two parts deliberately do not change: the job-type vocabulary,
-- every error code and message of the functions that already existed, the
-- stuck-job recovery through import_job_finish(), the security definer
-- attribute, the pinned search path, the privilege model (no client role
-- gains EXECUTE), the 0005 dedup constraints, and the connector contract
-- (still exactly three RPCs; this stage is called by the runner, not by a
-- browser). Advisory locks and unique indexes were considered and rejected
-- in favour of the row locks this engine already uses everywhere else. All
-- locks are transaction-scoped: they die with the transaction, so a crashed
-- caller holds nothing.
--
-- Re-runnable. Rollback: recreate the 0011 import_job_start body (remove
-- `for update`) and `drop function public.import_dedup(uuid);` — there are no
-- other objects to remove.
--
-- Apply after db/migrations/0011_import_engine_ingest.sql.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Pre-flight — the objects being hardened or built on have to be there.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.import_job_start(text, uuid, text)') is null then
    raise exception 'Apply db/migrations/0011_import_engine_ingest.sql before this file: public.import_job_start() is missing.';
  end if;
  if to_regclass('public.deal_sources') is null
     or to_regclass('public.deal_engine_jobs') is null then
    raise exception 'Apply db/migrations/0005_deal_engine_foundation.sql before this file: the Deal Engine tables are missing.';
  end if;
  if to_regclass('public.imported_deals') is null
     or to_regclass('public.deal_engine_events') is null then
    raise exception 'Apply db/migrations/0005_deal_engine_foundation.sql before this file: the imported-record tables are missing.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. PART A: the function, recreated with the row lock.
--    Everything below is 0011's function verbatim, except:
--      • the source lookup gains `for update` (the concurrency fix); and
--      • the comments that explain it.
-- ---------------------------------------------------------------------------
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

  /* 17C-H: the source row is locked FOR UPDATE, and this is what makes the
     one-running-job rule below true under simultaneous starts. Without the
     lock, two calls released at the same instant could both pass the check
     and both insert; with it, the second call reads the row only after the
     first transaction has committed, so the check it runs sees the first
     job and refuses. The lock ends with the transaction, so a crashed
     caller holds nothing: a stuck RUN is still closed by a person with
     import_job_finish(), exactly as the architecture (17C-A §5) intends. */
  select * into v_source
    from public.deal_sources
   where id = p_source_id
   for update;
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
     Here the refusal names the job, and a person can finish it. The check is
     safe against simultaneous starts because the source row above is locked
     for the rest of this transaction. */
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
-- 3. Privileges — 0011's model, re-asserted for the replaced function.
-- ---------------------------------------------------------------------------
revoke all on function public.import_job_start(text, uuid, text)
  from public, anon, authenticated;

/* service_role exists on Supabase and not in a bare local PostgreSQL, so the
   grant is guarded: the revokes above are not. */
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.import_job_start(text, uuid, text) to service_role;
  end if;
end $$;

comment on function public.import_job_start(text, uuid, text) is
  'Starts one Deal Engine run: a job row at running, with the vocabulary 0005 defined. Refuses a source that is not active, and refuses a second running job for the same source by naming it, so a stuck run is closed by a person rather than overwritten. The source row is locked FOR UPDATE, so simultaneous starts serialise and exactly one job opens (17C-H). Service-role only.';


-- ---------------------------------------------------------------------------
-- 4. Self-check — the migration refuses to have applied half of itself.
-- ---------------------------------------------------------------------------
do $$
declare
  v_problems text[] := '{}';
  v_prosrc   text;
begin
  v_prosrc := (select prosrc from pg_proc
                where oid = to_regprocedure('public.import_job_start(text, uuid, text)'));
  if v_prosrc is null then
    v_problems := v_problems || 'import_job_start was not created';
  else
    if position('for update' in lower(v_prosrc)) = 0 then
      v_problems := v_problems || 'import_job_start does not lock the source row (no FOR UPDATE in the body)';
    end if;
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.import_job_start(text, uuid, text)')
       and p.prosecdef) then
    v_problems := v_problems || 'import_job_start must be security definer';
  end if;

  if exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.import_job_start(text, uuid, text)')
       and coalesce(array_to_string(p.proconfig, ' '), '')
           not like '%search_path=public, pg_temp%') then
    v_problems := v_problems || 'import_job_start does not pin its search path';
  end if;

  if has_function_privilege('public', 'public.import_job_start(text, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.import_job_start(text, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.import_job_start(text, uuid, text)', 'EXECUTE') then
    v_problems := v_problems || 'a client role holds EXECUTE on import_job_start';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and not has_function_privilege('service_role',
              'public.import_job_start(text, uuid, text)', 'EXECUTE') then
    v_problems := v_problems || 'service_role cannot call import_job_start';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'deal_sources'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')) then
    v_problems := v_problems || 'a write policy appeared on deal_sources';
  end if;

  if array_length(v_problems, 1) > 0 then
    raise exception 'Import job-start hardening self-check failed: %',
      array_to_string(v_problems, '; ');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 5. PART B: the deduplication stage.
--
-- One call classifies the running job's source records; import_job_finish()
-- closes the run — this function creates no second lifecycle. A record is
-- eligible when it has arrived and nobody has decided anything about it:
-- pipeline 'imported'/'validated'/'normalized'/'deduplicated' with no decided
-- review. Records a person decided (approved, published, rejected, archived —
-- 0011's locked vocabulary), records waiting for a person (pending-review)
-- and failed records are never re-classified here; a failed record returns
-- to imported through 0011's evidence refresh, not through this stage.
--
-- The match is deterministic and evidence-bound: the same non-blank
-- external_product_id at another source. Nothing fuzzy, nothing scored, and
-- nothing manufactured from the normalized columns (empty until a processor
-- exists). Candidates are read, never written, whatever their own state:
-- they are evidence of a possible duplicate, and hiding one because of its
-- status would decide by omission what this stage exists to leave to a
-- person. No record is merged, deleted or rewritten; only the dedup columns,
-- the pipeline position and the event trail move.
-- ---------------------------------------------------------------------------
create or replace function public.import_dedup(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eligible text[] := array['imported', 'validated', 'normalized', 'deduplicated'];
  v_decided  text[] := array['approved', 'rejected', 'archived'];

  v_job        public.deal_engine_jobs;
  v_source     public.deal_sources;
  v_record     public.imported_deals;
  v_source_id  uuid;
  v_candidates jsonb;
  v_rep_id     uuid;
  v_count      integer;
  v_prev_class text;
  v_prev_pipe  text;
  v_note       text;
  v_examined   integer := 0;
  v_new        integer := 0;
  v_review     integer := 0;
  v_unchanged  integer := 0;
begin
  if p_job_id is null then
    raise exception 'A job id is required' using errcode = '22023';
  end if;

  /* The run's own row, locked — the engine's existing idiom (import_job_finish
     locks it the same way). Two callers of one job serialise here, and the
     second finds every record already classified and changes nothing. */
  select * into v_job from public.deal_engine_jobs where id = p_job_id for update;
  if not found then
    raise exception 'No job with that id' using errcode = 'P0002';
  end if;

  if v_job.job_type <> 'deduplication' then
    raise exception 'A "%" job does not deduplicate records', v_job.job_type using errcode = '22023';
  end if;

  if v_job.status <> 'running' then
    raise exception 'That job is "%", and records are classified only while a job is running',
      v_job.status using errcode = '22023';
  end if;

  if v_job.source_id is null then
    raise exception 'That job names no source, and a deduplication run classifies one source''s records'
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

  /* The classification's update writes a pointer at another source's record,
     and the foreign-key check that follows it takes a share lock on that
     row. Two runs classifying against each other at the same instant — A's
     record pointing at B's while B's points at A's — could each end up
     waiting for the other's uncommitted write, a deadlock the verification
     rig's concurrency suite measured (40P01, deterministic). The engine's
     existing answer — row locks taken in one deterministic order — removes
     the cycle: before classifying anything, this run locks its own source
     row and the source row of every source that holds a candidate value, in
     a single pass ordered by id. Overlapping runs therefore request the same
     rows in the same order: the second waits at its first contested row for
     the first to commit, instead of the two interlocking. The lock is
     transaction-scoped, like every lock here, so a crashed caller holds
     nothing. */
  perform s.id
    from public.deal_sources s
   where s.id = v_source_id
      or exists (
           select 1
             from public.imported_deals m
             join public.imported_deals o
               on o.source_id = s.id
              and o.source_id <> v_source_id
              and o.external_product_id = m.external_product_id
            where m.source_id = v_source_id
              and m.external_product_id <> '')
   order by s.id
   for update;

  /* One record at a time, locked in id order — a deterministic lock order,
     the same FOR UPDATE the ingest identity lookup takes. Only this job's
     source's records are ever written; other sources' records are evidence. */
  for v_record in
    select * from public.imported_deals
     where source_id = v_source_id
       and pipeline_status = any (v_eligible)
       and review_status <> all (v_decided)
     order by id
     for update
  loop
    v_examined   := v_examined + 1;
    v_prev_class := v_record.dedup_match_class;
    v_prev_pipe  := v_record.pipeline_status;

    /* The one deterministic signal stored records carry today: the same
       non-blank external_product_id at another source. Titles and URLs are
       display provenance, not identity (docs §6.1), and are not matched on. */
    if coalesce(v_record.external_product_id, '') = '' then
      v_candidates := '[]'::jsonb;
      v_count      := 0;
      v_rep_id     := null;
    else
      /* The complete candidate set, ordered by the representative rule:
         oldest created_at, then id. The first element is the pointer. */
      select coalesce(jsonb_agg(id order by created_at asc, id asc), '[]'::jsonb),
             count(*),
             (array_agg(id order by created_at asc, id asc))[1]
        into v_candidates, v_count, v_rep_id
        from public.imported_deals
       where source_id <> v_source_id
         and external_product_id = v_record.external_product_id;
    end if;

    if v_count = 0 then
      /* No candidate: the record stands as its own product and advances to
         the established post-dedup state (0005's vocabulary, docs §7). */
      if v_record.deduplication_status = 'passed'
         and v_record.dedup_match_class = 'new-product'
         and v_record.dedup_matched_deal_id is null
         and v_record.pipeline_status = 'deduplicated' then
        v_unchanged := v_unchanged + 1;  -- already classified exactly so: a re-run changes nothing
      else
        v_note := case
          when coalesce(v_record.external_product_id, '') = ''
          then 'The record carries no external product id, so no deterministic match signal exists; it stands as its own product.'
          else 'No record in another source carries the same external product id; the record stands as its own product.'
        end;
        update public.imported_deals
           set deduplication_status  = 'passed',
               deduplication_result  = v_note,
               dedup_match_class     = 'new-product',
               dedup_matched_deal_id = null,
               pipeline_status       = 'deduplicated'
         where id = v_record.id;

        insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
        values (v_record.id, 'deduplication', 'new-product', v_note,
                jsonb_build_object(
                  'job_id',                   p_job_id,
                  'match_class',              'new-product',
                  'candidate_ids',            '[]'::jsonb,
                  'candidate_count',          0,
                  'matched_deal_id',          null,
                  'previous_match_class',     v_prev_class,
                  'previous_pipeline_status', v_prev_pipe));
        v_new := v_new + 1;
      end if;
    else
      /* Candidate(s): an uncertain-match, routed to the review queue with
         review left open. The oldest candidate (created_at, id) is recorded
         as the representative — a pointer for a person to start from, not a
         verdict that it is more correct than the others; the complete
         candidate set travels in this event, so nothing is silently
         discarded from the audit trail. Nothing is merged or deleted. */
      if v_record.deduplication_status = 'passed'
         and v_record.dedup_match_class = 'uncertain-match'
         and v_record.dedup_matched_deal_id = v_rep_id
         and v_record.pipeline_status = 'pending-review' then
        v_unchanged := v_unchanged + 1;  -- already routed exactly so (defensive: pending-review is not eligible today)
      else
        v_note := format(
          'Records in %s other source(s) carry the same external product id. Nothing is merged or decided here: the oldest record (%s) is recorded as the representative, the complete candidate set is listed in this event, and a person decides.',
          v_count, v_rep_id);

        update public.imported_deals
           set deduplication_status  = 'passed',
               deduplication_result  = v_note,
               dedup_match_class     = 'uncertain-match',
               dedup_matched_deal_id = v_rep_id,
               pipeline_status       = 'pending-review',
               review_status         = 'pending'
         where id = v_record.id;

        insert into public.deal_engine_events (imported_deal_id, stage, outcome, detail, data)
        values (v_record.id, 'deduplication', 'uncertain-match', v_note,
                jsonb_build_object(
                  'job_id',                   p_job_id,
                  'match_class',              'uncertain-match',
                  'candidate_ids',            v_candidates,
                  'candidate_count',          v_count,
                  'matched_deal_id',          v_rep_id,
                  'previous_match_class',     v_prev_class,
                  'previous_pipeline_status', v_prev_pipe));
        v_review := v_review + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'job_id',           p_job_id,
    'source_id',        v_source_id,
    'examined',         v_examined,
    'new_product',      v_new,
    'routed_to_review', v_review,
    'unchanged',        v_unchanged);
end $$;


-- ---------------------------------------------------------------------------
-- 6. Privileges — 0011's model, applied to the one new door. An import run is
--    not a review decision; it is the runner's to call, and nobody else's.
-- ---------------------------------------------------------------------------
revoke all on function public.import_dedup(uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.import_dedup(uuid) to service_role;
  end if;
end $$;

comment on function public.import_dedup(uuid) is
  'The deduplication stage (17C-H): classifies the running deduplication job''s source records deterministically and never merges. The only signal is the same non-blank external_product_id at another source; a record with candidates becomes uncertain-match routed to pending-review for a person — the oldest candidate by created_at and id is recorded as the representative pointer and the complete candidate set is kept in the deduplication event — and a record without candidates becomes new-product at deduplicated. Idempotent: a re-run changes nothing. Locks its own source row and every candidate source''s row in one id-ordered pass, so overlapping runs serialise instead of deadlocking. No validation, normalization, fuzzy matching, merging or deletion; the run is closed by import_job_finish(). Service-role only.';


-- ---------------------------------------------------------------------------
-- 7. Self-check for the new function — same standard as part A's.
-- ---------------------------------------------------------------------------
do $$
declare
  v_problems text[] := '{}';
  v_prosrc   text;
begin
  if (select count(*) from pg_proc where proname like 'import_dedup%') <> 1 then
    v_problems := v_problems || 'import_dedup must be exactly one function';
  end if;

  v_prosrc := (select prosrc from pg_proc
                where oid = to_regprocedure('public.import_dedup(uuid)'));
  if v_prosrc is null then
    v_problems := v_problems || 'import_dedup(uuid) was not created with the intended signature';
  else
    if position('for update' in lower(v_prosrc)) = 0 then
      v_problems := v_problems || 'import_dedup does not take row locks (no FOR UPDATE in the body)';
    end if;
    if position('gtin' in lower(v_prosrc)) > 0
       or position('normalized_' in lower(v_prosrc)) > 0 then
      v_problems := v_problems || 'import_dedup reaches into normalization output that does not exist yet';
    end if;
  end if;

  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.import_dedup(uuid)')
       and p.prosecdef
       and p.prorettype = 'jsonb'::regtype) then
    v_problems := v_problems || 'import_dedup must be a security definer returning jsonb';
  end if;

  if exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.import_dedup(uuid)')
       and coalesce(array_to_string(p.proconfig, ' '), '')
           not like '%search_path=public, pg_temp%') then
    v_problems := v_problems || 'import_dedup does not pin its search path';
  end if;

  if has_function_privilege('public', 'public.import_dedup(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.import_dedup(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.import_dedup(uuid)', 'EXECUTE') then
    v_problems := v_problems || 'a client role holds EXECUTE on import_dedup';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role')
     and not has_function_privilege('service_role',
              'public.import_dedup(uuid)', 'EXECUTE') then
    v_problems := v_problems || 'service_role cannot call import_dedup';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('imported_deals', 'deal_engine_events')
       and cmd in ('INSERT', 'UPDATE', 'DELETE')) then
    v_problems := v_problems || 'a write policy appeared on imported_deals or deal_engine_events';
  end if;

  if (select count(*) from pg_constraint
       where conrelid = 'public.imported_deals'::regclass
         and conname in ('imported_deals_match_recorded', 'imported_deals_no_self_match')) <> 2 then
    v_problems := v_problems || 'the 0005 dedup constraints are missing or altered';
  end if;

  if array_length(v_problems, 1) > 0 then
    raise exception 'Deduplication stage self-check failed: %',
      array_to_string(v_problems, '; ');
  end if;
end $$;
