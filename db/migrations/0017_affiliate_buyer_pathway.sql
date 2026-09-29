-- ===========================================================================
-- 0017_affiliate_buyer_pathway.sql — Backlog #8: the tracked affiliate buyer
-- pathway.
--
-- What this file adds (and what it deliberately does not):
--
--   1. public.affiliate_clicks — an append-only record of tracked outbound
--      affiliate clicks. A click is a fact about the past, so like a Deal
--      Engine event it can be added and read but never rewritten or removed.
--      It records the offer and its context, the moment it happened, and the
--      approved destination that was served — and nothing about the visitor:
--      no account, no session, no token, no address, no user agent. An
--      anonymous click and a signed-in click are indistinguishable, on
--      purpose.
--
--   2. public.affiliate_click_track(p_offer_id uuid) RETURNS text — the one
--      tracked pathway a browser can take. The caller supplies only an offer
--      id, never a URL: the function resolves the destination from the stored,
--      approved offer itself, so no browser can use PickVanta to redirect to
--      an arbitrary address (there is no open-redirect endpoint here and
--      cannot be one). The offer must be publicly eligible — status 'active'
--      with an approved affiliate destination — or the function records
--      nothing and returns null, and the caller follows the offer's public
--      link directly without a recorded click (the honest fallback: a click
--      that was not recorded is never claimed as tracked).
--
--   3. public.affiliate_pathway_approve(p_offer_id uuid, p_affiliate_url text)
--      RETURNS uuid — the smallest approval transition the pipeline lacks.
--      The reviewed conversion (0010) deliberately writes an empty
--      affiliate_url: an imported affiliate URL never becomes a buyer pathway
--      merely because it exists in imported data. No existing action attaches
--      one, so an administrator approves (or revokes) the destination here —
--      explicitly, per offer, after inspecting the merchant, the offer and the
--      destination. This is not a second review system: the offer's existing
--      review → publish lifecycle stays the authority over whether the offer
--      is public at all; this decides only which tracked destination, if any,
--      its buyer pathway uses. The URL is never generated, never derived from
--      source_url, and never allowed to equal it.
--
--   4. Nothing else. No conversion or commission table, column or counter: no
--      verified conversion feed exists in this build, and inventing one would
--      fabricate sales. A click is a click; the schema says so by having
--      nothing else to say.
--
-- Security shape (the 0010 conventions):
--   • both functions are security definer with a pinned
--     search_path = public, pg_temp;
--   • no client role gains any table privilege on affiliate_clicks beyond
--     SELECT for administrators (RLS-gated); INSERT has no policy at all —
--     clicks are written only inside the definer function;
--   • merchant_offers gains no new client privilege: the approval runs as the
--     function owner and checks public.is_admin() for itself;
--   • the anonymous visitor is supported where the pathway needs them: the
--     click function may be executed by anon and authenticated alike.
--
-- Rollback: drop function public.affiliate_pathway_approve(uuid, text);
--           drop function public.affiliate_click_track(uuid);
--           drop table public.affiliate_clicks;
-- ===========================================================================

\set ON_ERROR_STOP 1

begin;

-- Precondition: the canonical layer and its admin gate exist.
do $pre$
begin
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'Apply db/migrations/0002_auth_profiles.sql before this file: public.is_admin() is missing.';
  end if;

  if to_regclass('public.merchant_offers') is null then
    raise exception 'Apply db/migrations/0008_canonical_catalogue.sql before this file: merchant_offers is missing.';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. The click record — append-only, minimal, visitor-free.
-- ---------------------------------------------------------------------------
create table if not exists public.affiliate_clicks (
  id                uuid primary key default gen_random_uuid(),
  /* The offer the click left through, and the context it carried: enough to
     reconstruct which merchant, source, product and configuration a click
     belongs to without joining anything to read a single record. */
  merchant_offer_id uuid not null,
  product_id        uuid,
  variant_id        uuid,
  merchant_id       uuid,
  source_id         uuid,
  /* The pathway the click used. The tracked pathway is the affiliate one;
     an ordinary source-URL visit is an ordinary visit and is not recorded. */
  pathway           text not null default 'affiliate'
                    check (pathway in ('affiliate')),
  /* The approved destination exactly as it was served for this click. The
     offer row can change later; a click's answer must not. */
  destination_url   text not null
                    check (destination_url ~* '^https?://[^[:space:]]+$'),
  created_at        timestamptz not null default now()
);

comment on table public.affiliate_clicks is
  'Append-only record of tracked outbound affiliate clicks. One row per click: the offer and its context, the approved destination served, and the moment. Deliberately nothing about the visitor — no account, session, token, address or user agent — so anonymous and signed-in clicks are indistinguishable. A click is not a conversion and records nothing about sales or commission.';

-- Append-only, exactly like the Deal Engine's own history: a click is a fact
-- about the past and is never rewritten or removed.
create or replace function public.affiliate_clicks_append_only()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'An affiliate click records what happened; it is never rewritten or removed.';
end;
$$;

drop trigger if exists affiliate_clicks_append_only on public.affiliate_clicks;
create trigger affiliate_clicks_append_only
  before update or delete on public.affiliate_clicks
  for each row execute function public.affiliate_clicks_append_only();

-- The obvious administrative read: a pathway's clicks, newest first.
create index if not exists affiliate_clicks_offer_created_idx
  on public.affiliate_clicks (merchant_offer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Privileges on the table. No client reads it but an administrator, and
--    no client writes it at all: rows are created only inside the definer
--    function below.
-- ---------------------------------------------------------------------------
alter table public.affiliate_clicks enable row level security;

revoke all on public.affiliate_clicks from public, anon, authenticated;
grant select on public.affiliate_clicks to authenticated;

drop policy if exists affiliate_clicks_select_admin on public.affiliate_clicks;
create policy affiliate_clicks_select_admin on public.affiliate_clicks
  for select to authenticated
  using (public.is_admin());

/* No INSERT, UPDATE or DELETE policy exists for any client role, on purpose:
   a browser cannot put a row here, not even an administrator's browser. The
   click function is the only door. */

-- ---------------------------------------------------------------------------
-- 3. The tracked pathway. One argument: the offer. The database decides
--    everything else.
-- ---------------------------------------------------------------------------
create or replace function public.affiliate_click_track(
  p_offer_id  uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.merchant_offers;
begin
  if p_offer_id is null then
    return null;
  end if;

  select * into v_offer
    from public.merchant_offers
    where id = p_offer_id;

  /* Publicly eligible means exactly one thing: a published offer whose
     approved affiliate destination exists. Anything else — pending, draft-era,
     unavailable, revoked, unknown — records nothing and sends back no
     destination. */
  if not found
     or v_offer.status is distinct from 'active'
     or v_offer.affiliate_url = '' then
    return null;
  end if;

  insert into public.affiliate_clicks
    (merchant_offer_id, product_id, variant_id, merchant_id, source_id,
     pathway, destination_url)
  values
    (v_offer.id, v_offer.product_id, v_offer.variant_id, v_offer.merchant_id,
     v_offer.source_id, 'affiliate', v_offer.affiliate_url);

  return v_offer.affiliate_url;
end;
$$;

revoke all on function public.affiliate_click_track(uuid) from public, anon, authenticated;
grant execute on function public.affiliate_click_track(uuid) to anon, authenticated;

comment on function public.affiliate_click_track(uuid) is
  'Records one tracked outbound affiliate click and returns the approved destination, resolved from the stored offer. The caller never supplies a URL: an unknown, unpublished or unapproved offer returns null and records nothing. Stores nothing about the visitor.';

-- ---------------------------------------------------------------------------
-- 4. The approval transition. An administrator decides, per offer, which
--    tracked destination — if any — its buyer pathway uses.
-- ---------------------------------------------------------------------------
create or replace function public.affiliate_pathway_approve(
  p_offer_id       uuid,
  p_affiliate_url  text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer public.merchant_offers;
  v_url   text;
begin
  /* Who is asking. The database decides: public.is_admin() reads the caller's
     own profile row. A definer function has to ask, or every client role
     granted execute would be an administrator. */
  if not public.is_admin() then
    raise exception 'Only an administrator can change an offer''s approved destination.'
      using errcode = '42501';
  end if;

  v_url := btrim(coalesce(p_affiliate_url, ''));

  /* '' revokes: the offer goes back to no approved destination at all. */
  if v_url <> '' and v_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'An affiliate destination must be an http(s) URL, or empty to revoke it.'
      using errcode = '23514';
  end if;

  select * into v_offer from public.merchant_offers where id = p_offer_id;
  if not found then
    raise exception 'No merchant offer with that id exists.' using errcode = '23503';
  end if;

  /* The permanent separation, restated beside the table's own check: an
     affiliate destination is never the ordinary source URL. */
  if v_url <> '' and v_url = v_offer.source_url then
    raise exception 'An affiliate destination must differ from the offer''s source URL.'
      using errcode = '23514';
  end if;

  update public.merchant_offers
     set affiliate_url = v_url,
         updated_at    = now()
   where id = p_offer_id
   returning id into v_offer.id;

  return v_offer.id;
end;
$$;

revoke all on function public.affiliate_pathway_approve(uuid, text) from public, anon, authenticated;
grant execute on function public.affiliate_pathway_approve(uuid, text) to authenticated;

comment on function public.affiliate_pathway_approve(uuid, text) is
  'Administrator approval of an offer''s tracked affiliate destination: sets it explicitly (validated, never equal to source_url), or clears it with ''''. The offer''s own review → publish lifecycle is untouched and stays the authority on whether the offer is public.';

-- ---------------------------------------------------------------------------
-- 5. Self-check. A migration that builds a doorway proves it is the only one,
--    that it is locked, and that the key fits.
-- ---------------------------------------------------------------------------
do $$
declare
  v_track   regprocedure := to_regprocedure('public.affiliate_click_track(uuid)');
  v_approve regprocedure := to_regprocedure('public.affiliate_pathway_approve(uuid, text)');
  v_proc    record;
  v_count   integer;
begin
  if v_track is null or v_approve is null then
    raise exception 'affiliate_click_track / affiliate_pathway_approve were not created.';
  end if;

  /* Both doors are definer functions with exactly the pinned search path. */
  for v_proc in
    select p.oid, p.proname, p.prosecdef, p.proconfig
      from pg_proc p where p.oid in (v_track, v_approve)
  loop
    if v_proc.prosecdef is not true then
      raise exception '% must be security definer.', v_proc.proname;
    end if;
    if v_proc.proconfig is distinct from array['search_path=public, pg_temp']::text[] then
      raise exception '% must pin exactly search_path = public, pg_temp; it pins %.',
        v_proc.proname,
        coalesce(array_to_string(v_proc.proconfig, ', '), '(nothing)');
    end if;
  end loop;

  /* The table is locked to the shape this file promises. */
  if (select relrowsecurity from pg_class where oid = 'public.affiliate_clicks'::regclass) is not true then
    raise exception 'affiliate_clicks must have row level security enabled.';
  end if;

  select count(*) into v_count from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_clicks';
  if v_count is distinct from 1 then
    raise exception 'affiliate_clicks must carry exactly one policy (the administrator read); found %.', v_count;
  end if;

  select count(*) into v_count from pg_policies
    where schemaname = 'public' and tablename = 'affiliate_clicks'
      and cmd in ('INSERT', 'UPDATE', 'DELETE');
  if v_count <> 0 then
    raise exception 'affiliate_clicks must have no write policy for any client role.';
  end if;

  if exists (select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'affiliate_clicks'
      and grantee = 'anon' and privilege_type = 'SELECT') then
    raise exception 'affiliate_clicks must not be readable by anon.';
  end if;

  /* The visitor-free record: exactly these columns, so a later column that
     quietly remembers a person cannot arrive without failing here. */
  select count(*) into v_count from information_schema.columns
    where table_schema = 'public' and table_name = 'affiliate_clicks';
  if v_count is distinct from 9 then
    raise exception 'affiliate_clicks must carry exactly the nine minimal columns; found %.', v_count;
  end if;

  select count(*) into v_count from information_schema.columns
    where table_schema = 'public' and table_name = 'affiliate_clicks'
      and column_name in ('id', 'merchant_offer_id', 'product_id', 'variant_id',
                          'merchant_id', 'source_id', 'pathway',
                          'destination_url', 'created_at');
  if v_count is distinct from 9 then
    raise exception 'affiliate_clicks is missing one of its minimal columns.';
  end if;

  /* The append-only guard is in place. */
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.affiliate_clicks'::regclass
      and tgname = 'affiliate_clicks_append_only' and not tgisinternal) then
    raise exception 'affiliate_clicks must be append-only (the guard trigger is missing).';
  end if;

  /* The offers table gained no client privilege: approval runs through the
     function, never through a table grant. */
  if exists (select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'merchant_offers'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'merchant_offers must stay write-free for every client role.';
  end if;
end;
$$;

commit;
