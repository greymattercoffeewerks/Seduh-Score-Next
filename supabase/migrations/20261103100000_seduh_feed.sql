-- Seduh Score Next · T-ID.D1a: the Seduh ID archive feed (Layer 1b), in review-queue mode
--
-- Spec: Handoffs and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md section 5 and T-ID-D1-BUILD-BRIEF.md (local,
-- gitignored), owner decisions of 2026-11-01 in HANDOFF-CORRECTION-005.md (4: `queue` first, `auto` built but off, with
-- caps; 5: podium only, every non-test publish, any tier; 8: opt-out by email and owner SQL; 9: 12 months retention).
--
-- What this is: when a PODIUM is published to public_results (by an organiser, or by the archive tick), one row is put on a
-- review queue. Nothing is created by that. The platform owner reviews the queue (app.seduh_feed_review) and runs the feed
-- for CHOSEN result ids (app.seduh_identity_feed), which creates the Seduh ID identities and links the people exactly as the
-- one-time B4 backfill does. `auto` mode (off) lets a database-owned job do the same under caps.
--
--   * app.seduh_feed_mode      one owner-only row: off (default) | queue | auto, and the two `auto` caps.
--   * app.seduh_feed_queue     one row per published podium result (ids only: result, organisation, and after a run the
--                              uuids of the identities created and the people linked, which is what undo needs). No phone,
--                              no name, no cafe, no error text (last_error is a SQLSTATE or a short code).
--   * trg_public_results_seduh_feed / app.enqueue_seduh_feed()   AFTER INSERT OR UPDATE OF payload on public.public_results.
--   * app.seduh_feed_slots_internal / app.seduh_feed_plan_internal   B4's matching, PODIUM ONLY (B4's functions are pushed and
--                              are not edited; the standings array is the one deliberate difference, decision 5).
--   * app.seduh_feed_apply     the creating step for a set of queued results (internal).
--   * app.seduh_identity_feed(uuid[])   the owner's run for chosen result ids.
--   * app.seduh_feed_review()  the dry run: what each queued result would create, per result and per organisation.
--   * app.seduh_feed_auto_run()   `auto` mode's job, caps included (not scheduled by this migration).
--   * app.seduh_feed_undo(uuid[], boolean)   undoes processed queue rows (see its comment).
--
-- THE TRIGGER IS AN AFTER ROW TRIGGER, not a BEFORE ROW one. Test 045's catalog guard targets SECURITY DEFINER BEFORE ROW
-- trigger functions (a BEFORE definer trigger runs ahead of row-level security, so it must refuse a non-member first, with
-- app.refuse_non_member). This one runs after the row was written, on a table whose writers the policy public_results_org,
-- the BEFORE trigger app.check_public_results_org and the publish RPC have already authorised; it reads nothing the caller
-- supplies except the row they were allowed to write; it answers nothing to the caller. 045 is run to confirm it does not
-- match the guard.
--
-- FAIL OPEN, MUST HOLD: a publish never fails because of the feed, and the caller learns nothing. The whole body sits in
-- `begin ... exception when others then null`, so a missing table, a full disk or a bug in this file cannot stop a publish.
-- The price: a swallowed error is invisible. app.seduh_feed_review therefore reports how many published podium results have
-- NO queue row, so a silent miss is seen at the next review. (Not caught: query_canceled, which cancels the statement.)
--
-- WHY A QUEUE AT ALL (verified in the B4 header and the spec): a publish arrives through PostgREST with session user
-- `authenticator`; the identity-creating code refuses an API session by name (the v_api check, copied below), and loosening
-- that would let an API-origin session reach the one function that creates identities. So the trigger only writes ids to a
-- queue, and the creating code runs only as the database owner.
--
-- THE FORGERY GAP IS NOT CLOSED, which is why `queue` is the first live mode. Organisation members write payloads, entries
-- and people, and nothing validates a payload against the scores, so a member can stage a non-test event, a person holding
-- any phone and a podium naming them, then publish it. The queue lets the owner see, per organisation and event, what would
-- be created and run the feed only for results they recognise as real. `auto` removes that human; the caps below only bound
-- the damage (at most `org_daily_cap` identities per organisation and `global_daily_cap` in total per 24 hours; anything over
-- stays queued for review). At Layer 1 an identity is unreadable and cannot be claimed (that needs Layer 2's proof of
-- control), so the harm of a forged one is pollution and a stronger phone-existence signal, not exposure.
--
-- THE RULES ARE B4's EXACTLY (spec 5.1): a person is NAMED when exactly one entry of the event matches a podium name and cafe
-- (trimmed) and that entry has a person of the event's organisation; a test event creates nothing; a phone that fails
-- app.is_e164 is skipped; a person the owner unlinked (app.person_link_blocks holding the same phone) is skipped; an existing
-- identity for the phone is reused and never overwritten (an opted_out one is linked, inert; a merged tombstone resolves
-- through merged_into, a cycle is skipped); a person already linked elsewhere is left alone. Source 'archive', status
-- 'active', name = the published name cut to 120, country = the first valid people.country. A phone change after creation
-- nulls the link through the existing guard trigger and nothing here re-links. The public payload gains no id.
--
-- OUTPUT: counts and uuids only, never a phone, a name or a cafe.
--
-- Not pushed to the cloud by this change. Order of the owner's rollout (CONVENTIONS "Seduh ID feed"): check `app` is not an
-- exposed schema, push the migrations, leave the mode `off`, set `queue`, review, run.
--
-- rollback (verified in a transaction in test 071 against the schema this file creates):
--   drop trigger if exists trg_public_results_seduh_feed on public.public_results;
--   drop function if exists app.seduh_feed_undo(uuid[], boolean);
--   drop function if exists app.seduh_feed_auto_run();
--   drop function if exists app.seduh_feed_review();
--   drop function if exists app.seduh_identity_feed(uuid[]);
--   drop function if exists app.seduh_feed_apply(uuid[], text);
--   drop function if exists app.seduh_feed_plan_internal(uuid[]);
--   drop function if exists app.seduh_feed_slots_internal(uuid[]);
--   drop function if exists app.enqueue_seduh_feed();
--   drop table if exists app.seduh_feed_queue;
--   drop table if exists app.seduh_feed_mode;
--   drop function if exists app.forbid_seduh_feed_mode_delete();
-- (Rolling back a populated queue loses the lists undo needs for the runs it records: run the undo first, or keep the lists.)

-- ============ (1) the mode (owner-only, one row) ============

create table app.seduh_feed_mode (
  singleton        boolean primary key default true,
  mode             text not null default 'off',
  org_daily_cap    integer not null default 8,
  global_daily_cap integer not null default 40,
  updated_at       timestamptz not null default now(),
  constraint seduh_feed_mode_one_row check (singleton),
  constraint seduh_feed_mode_vocab check (mode in ('off', 'queue', 'auto')),
  constraint seduh_feed_mode_org_cap check (org_daily_cap between 0 and 1000),
  constraint seduh_feed_mode_global_cap check (global_daily_cap between 0 and 10000)
);
insert into app.seduh_feed_mode (singleton) values (true);

alter table app.seduh_feed_mode enable row level security;
revoke all on app.seduh_feed_mode from public, anon, authenticated, service_role;

create trigger trg_seduh_feed_mode_set_updated_at
  before update on app.seduh_feed_mode
  for each row execute function app.set_updated_at();

-- the row is the switch: deleting it is refused (the trigger below would read "no row" as off anyway, fail closed)
create or replace function app.forbid_seduh_feed_mode_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'seduh_feed_mode is one row and is changed, not removed' using errcode = '42501';
end;
$$;
revoke all on function app.forbid_seduh_feed_mode_delete() from public, anon, authenticated, service_role;
create trigger trg_seduh_feed_mode_no_delete
  before delete on app.seduh_feed_mode
  for each row execute function app.forbid_seduh_feed_mode_delete();
create trigger trg_seduh_feed_mode_no_truncate
  before truncate on app.seduh_feed_mode
  for each statement execute function app.forbid_seduh_feed_mode_delete();

-- ============ (2) the queue (ids only) ============

-- result_id and org_id are bare uuids with NO foreign key (like archive_events and person_merges): the queue and the lists
-- undo needs survive an event or result delete. A result that is gone is processed as "names nobody".
create table app.seduh_feed_queue (
  result_id            uuid primary key,
  org_id               uuid not null,
  state                text not null default 'queued',
  enqueued_at          timestamptz not null default now(),
  processed_at         timestamptz,
  processed_via        text,
  created_identity_ids uuid[] not null default '{}',
  linked_person_ids    uuid[] not null default '{}',
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint seduh_feed_queue_state_vocab check (state in ('queued', 'processed', 'rejected', 'undone')),
  constraint seduh_feed_queue_via_vocab check (processed_via is null or processed_via in ('owner', 'auto')),
  -- a queued row has not been dealt with; every other state has been
  constraint seduh_feed_queue_processed_at_by_state check ((state = 'queued') = (processed_at is null)),
  -- a SQLSTATE or a short reason code, never free text (a message can carry a name or a phone)
  constraint seduh_feed_queue_last_error_shape check (last_error is null or last_error ~ '^[A-Za-z0-9_]{1,40}$')
);

-- the review reads only what is waiting; the cap counts read what was processed lately
create index seduh_feed_queue_queued on app.seduh_feed_queue (enqueued_at) where state = 'queued';
create index seduh_feed_queue_processed on app.seduh_feed_queue (org_id, processed_at) where state = 'processed';

alter table app.seduh_feed_queue enable row level security;
revoke all on app.seduh_feed_queue from public, anon, authenticated, service_role;

create trigger trg_seduh_feed_queue_set_updated_at
  before update on app.seduh_feed_queue
  for each row execute function app.set_updated_at();

-- a row never moves to another result or organisation
create trigger trg_seduh_feed_queue_parent_immutable
  before update of result_id, org_id on app.seduh_feed_queue
  for each row execute function app.forbid_parent_change('result_id', 'org_id');

-- ============ (3) the enqueue trigger (AFTER, fail open) ============

create or replace function app.enqueue_seduh_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    -- a save that left the payload as it was (the archive tick and the organiser's republish can both do that) asks nothing new
    if tg_op = 'UPDATE' and new.payload is not distinct from old.payload then
      return null;
    end if;
    -- `off` (the default) and a missing mode row enqueue nothing; a stub or a podium-less payload names nobody (decision 5:
    -- podium only); a test event is never queued (the BEFORE trigger already refuses to publish one)
    if coalesce((select m.mode from app.seduh_feed_mode m), 'off') in ('queue', 'auto')
       and jsonb_typeof(new.payload -> 'podium') = 'array'
       and jsonb_array_length(new.payload -> 'podium') > 0
       and exists (select 1 from public.events e where e.id = new.event_id and e.is_test is not true) then
      -- a changed payload on a result already dealt with asks for a new review (what is recorded for undo stays)
      insert into app.seduh_feed_queue as q (result_id, org_id)
      values (new.id, new.org_id)
      on conflict (result_id) do update
         set state = 'queued', enqueued_at = now(), processed_at = null, processed_via = null, last_error = null
       where q.state <> 'queued';
    end if;
  exception when others then
    null;   -- a publish must never fail because of the feed
  end;
  return null;
end;
$$;
revoke all on function app.enqueue_seduh_feed() from public, anon, authenticated, service_role;

create trigger trg_public_results_seduh_feed
  after insert or update of payload on public.public_results
  for each row execute function app.enqueue_seduh_feed();

-- ============ (4) B4's matching, podium only ============

create or replace function app.seduh_feed_slots_internal(p_result_ids uuid[] default null)
returns table (result_id uuid, published_at timestamptz, nm text, cf text, entry_count integer, person_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with slots as (
    select distinct
           pr.id as result_id, pr.published_at, e.id as event_id, e.org_id,
           btrim(s.elem ->> 'name') as nm,
           coalesce(btrim(s.elem ->> 'cafe'), '') as cf
    from public.public_results pr
    join public.events e on e.id = pr.event_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium' else '[]'::jsonb end) as s(elem)
    where e.is_test is not true
      and (p_result_ids is null or pr.id = any (p_result_ids))
      and nullif(btrim(s.elem ->> 'name'), '') is not null
  )
  select s.result_id, s.published_at, s.nm, s.cf,
         count(en.id)::integer as entry_count,
         case when count(en.id) = 1 then (array_agg(p.id))[1] end as person_id
  from slots s
  left join public.event_entries en
    on en.event_id = s.event_id
   and btrim(en.display_name) = s.nm
   and coalesce(btrim(en.cafe), '') = s.cf
  left join public.people p
    on p.id = en.person_id
   and p.org_id = s.org_id
  group by s.result_id, s.published_at, s.nm, s.cf;
$$;
revoke all on function app.seduh_feed_slots_internal(uuid[]) from public, anon, authenticated, service_role;

create or replace function app.seduh_feed_plan_internal(p_result_ids uuid[] default null)
returns table (
  person_id       uuid,
  result_id       uuid,
  phone           text,
  class           text,       -- eligible | bad_phone | blocked | merge_cycle
  rank            integer,
  cand_name       text,
  cand_country    text,
  identity_id     uuid,
  identity_status text,
  linked_to       uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive named as (
    select distinct on (s.person_id) s.person_id, s.published_at, s.result_id, s.nm
    from app.seduh_feed_slots_internal(p_result_ids) s
    where s.person_id is not null
    order by s.person_id, s.published_at, s.result_id, s.nm
  ),
  facts as (
    select n.person_id, n.published_at, n.result_id, n.nm, p.phone, p.global_person_id,
           case when btrim(coalesce(p.country, '')) <> '' and char_length(btrim(p.country)) <= 60
                then btrim(p.country) end as country,
           case
             when not app.is_e164(p.phone) then 'bad_phone'
             when exists (select 1 from app.person_link_blocks b where b.person_id = p.id and b.phone_e164 = p.phone) then 'blocked'
             else 'eligible'
           end as class
    from named n
    join public.people p on p.id = n.person_id
  ),
  chase as (
    select i.phone_e164 as phone, i.id, i.status, i.merged_into, 0 as hops
    from app.seduh_identities i
    where i.phone_e164 in (select f.phone from facts f where f.class = 'eligible')
    union all
    select c.phone, i.id, i.status, i.merged_into, c.hops + 1
    from chase c
    join app.seduh_identities i on i.id = c.merged_into
    where c.status = 'merged' and c.hops < 8
  ),
  resolved as (
    select distinct on (c.phone) c.phone, c.id, c.status
    from chase c
    where c.status <> 'merged'
    order by c.phone, c.hops
  ),
  has_identity as (
    select distinct c.phone from chase c where c.hops = 0
  )
  select f.person_id, f.result_id, f.phone,
         case when f.class = 'eligible' and h.phone is not null and r.phone is null then 'merge_cycle' else f.class end as class,
         case when f.class = 'eligible'
              then row_number() over (partition by f.phone, f.class order by f.published_at, f.result_id, f.person_id)::integer
         end as rank,
         f.nm as cand_name,
         f.country as cand_country,
         r.id as identity_id,
         r.status as identity_status,
         f.global_person_id as linked_to
  from facts f
  left join resolved r on r.phone = f.phone
  left join has_identity h on h.phone = f.phone;
$$;
revoke all on function app.seduh_feed_plan_internal(uuid[]) from public, anon, authenticated, service_role;

-- ============ (5) the creating step, for a set of queued results ============

-- Internal: called by app.seduh_identity_feed (the owner, for the ids they chose) and app.seduh_feed_auto_run (the job, one
-- result at a time). Refuses an API session by name, exactly as B4 does. It takes the queue rows `for update` and works only on
-- QUEUED ones (so a second caller finds them gone), and it plans the WHOLE set at once, as B4 does for its restricted run, so
-- that two chosen results naming one new phone create ONE identity named from the earlier published record, with the first
-- valid country, exactly as B4 would. What it created and linked is then recorded on the row of the result that caused it
-- (an identity on the result holding the earliest record of the phone, a person on the result that names them).
create or replace function app.seduh_feed_apply(p_result_ids uuid[], p_via text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api     text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  v_ids     uuid[];
  v_created jsonb := '[]';
  v_linked  jsonb := '[]';
begin
  if session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api)
     or p_via is null or p_via not in ('owner', 'auto') then
    raise exception 'seduh_feed_apply is run by the database owner only'
      using errcode = '42501', hint = 'seduh_feed_owner_only';
  end if;

  select coalesce(array_agg(s.result_id order by s.result_id), '{}') into v_ids
    from (select q.result_id from app.seduh_feed_queue q
           where q.result_id = any (p_result_ids) and q.state = 'queued'
           order by q.result_id for update) s;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('processed', 0, 'created_identity_ids', '[]'::jsonb, 'linked_person_ids', '[]'::jsonb);
  end if;

  -- 1. create the identities that do not exist (the unique phone is the match key; a concurrent creator is not an error)
  with pl as (select * from app.seduh_feed_plan_internal(v_ids)),
  ins as (
    insert into app.seduh_identities (phone_e164, display_name, country, source, status)
    select pl.phone,
           left((array_agg(pl.cand_name order by pl.rank))[1], 120),
           (array_agg(pl.cand_country order by pl.rank) filter (where pl.cand_country is not null))[1],
           'archive', 'active'
    from pl
    where pl.class = 'eligible' and pl.identity_id is null and pl.linked_to is null
    group by pl.phone
    on conflict (phone_e164) do nothing
    returning id, phone_e164
  )
  select coalesce(jsonb_agg(jsonb_build_object('i', ins.id, 'r',
           (select pl.result_id from pl where pl.phone = ins.phone_e164 and pl.class = 'eligible' order by pl.rank limit 1))), '[]')
    into v_created from ins;

  -- 2. decide again now that the new identities exist (also re-reads blocks and links), then link
  perform set_config('app.seduh_link_write', 'on', true);
  with pl as (select * from app.seduh_feed_plan_internal(v_ids)),
  upd as (
    update public.people p
       set global_person_id = pl.identity_id
      from pl
     where pl.person_id = p.id
       and pl.class = 'eligible'
       and pl.identity_id is not null
       and p.phone = pl.phone                  -- a number changed since the plan is left alone
       and p.global_person_id is null          -- never overwrite a link someone put there on purpose
    returning p.id, pl.result_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('p', upd.id, 'r', upd.result_id)), '[]') into v_linked from upd;
  perform set_config('app.seduh_link_write', '', true);

  update app.seduh_feed_queue q
     set state = 'processed', processed_at = now(), processed_via = p_via, last_error = null,
         created_identity_ids = q.created_identity_ids
           || coalesce((select array_agg((c ->> 'i')::uuid order by c ->> 'i') from jsonb_array_elements(v_created) c where (c ->> 'r')::uuid = q.result_id), '{}'),
         linked_person_ids = q.linked_person_ids
           || coalesce((select array_agg((l ->> 'p')::uuid order by l ->> 'p') from jsonb_array_elements(v_linked) l where (l ->> 'r')::uuid = q.result_id), '{}')
   where q.result_id = any (v_ids);

  return jsonb_build_object(
    'processed', cardinality(v_ids),
    'created_identity_ids', coalesce((select jsonb_agg(c -> 'i') from jsonb_array_elements(v_created) c), '[]'),
    'linked_person_ids', coalesce((select jsonb_agg(l -> 'p') from jsonb_array_elements(v_linked) l), '[]'));
end;
$$;
revoke all on function app.seduh_feed_apply(uuid[], text) from public, anon, authenticated, service_role;

-- ============ (6) the owner's run, for chosen ids ============

-- D1c, the second half: run the feed for the result ids the owner chose after reading app.seduh_feed_review(). There is NO
-- "all" form on purpose: a null or empty list is refused. Refused while the mode is `off` (queue and auto allow it). Ids that
-- are not waiting in the queue are counted and left alone.
create or replace function app.seduh_identity_feed(p_result_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api    text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  v_mode   text;
  v_ids    uuid[];
  v_one    jsonb;
begin
  if session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api) then
    raise exception 'seduh_identity_feed is run by the database owner only'
      using errcode = '42501', hint = 'seduh_feed_owner_only';
  end if;
  if p_result_ids is null or cardinality(p_result_ids) = 0 then
    raise exception 'seduh_identity_feed needs the result ids you chose'
      using errcode = '22023', hint = 'seduh_feed_ids_required';
  end if;
  select m.mode into v_mode from app.seduh_feed_mode m;
  if v_mode is distinct from 'queue' and v_mode is distinct from 'auto' then
    raise exception 'the Seduh ID feed is off'
      using errcode = 'P0001', hint = 'seduh_feed_mode_off';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_result_ids) as x where x is not null;
  v_one := app.seduh_feed_apply(v_ids, 'owner');

  return jsonb_build_object(
    'mode', 'apply',
    'results_processed', (v_one ->> 'processed')::integer,
    'results_not_queued', cardinality(v_ids) - (v_one ->> 'processed')::integer,
    'identities_created', jsonb_array_length(v_one -> 'created_identity_ids'),
    'people_linked', jsonb_array_length(v_one -> 'linked_person_ids'),
    -- also recorded on each queue row; kept here so the owner has them in the run's own output
    'created_identity_ids', v_one -> 'created_identity_ids',
    'linked_person_ids', v_one -> 'linked_person_ids');
end;
$$;
revoke all on function app.seduh_identity_feed(uuid[]) from public, anon, authenticated, service_role;

-- ============ (7) the dry run (D1c, the first half) ============

-- Read-only. For each QUEUED result: the organisation, the event, and what running the feed for it alone would do. Two queued
-- results that name one new phone each list it as "to create" (running both creates it once: the second reuses it); the
-- per-organisation block counts a phone once. Ids and counts only.
create or replace function app.seduh_feed_review()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_api    text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  v_report jsonb;
begin
  if session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api) then
    raise exception 'seduh_feed_review is run by the database owner only'
      using errcode = '42501', hint = 'seduh_feed_owner_only';
  end if;

  select jsonb_build_object(
    'mode', (select m.mode from app.seduh_feed_mode m),
    'caps', (select jsonb_build_object('org_daily_cap', m.org_daily_cap, 'global_daily_cap', m.global_daily_cap) from app.seduh_feed_mode m),
    'created_last_24h', (select coalesce(sum(cardinality(q.created_identity_ids)), 0)
                           from app.seduh_feed_queue q where q.state = 'processed' and q.processed_at > now() - interval '24 hours'),
    'queue', jsonb_build_object(
      'queued',    (select count(*) from app.seduh_feed_queue where state = 'queued'),
      'processed', (select count(*) from app.seduh_feed_queue where state = 'processed'),
      'rejected',  (select count(*) from app.seduh_feed_queue where state = 'rejected'),
      'undone',    (select count(*) from app.seduh_feed_queue where state = 'undone')),
    -- a published non-test podium with no queue row: while the mode is off that is every one; in queue/auto mode a non-zero
    -- count means the (fail-open) trigger missed one or the mode was off when it was published
    'podium_results_not_queued', (
      select count(*) from public.public_results pr join public.events e on e.id = pr.event_id
       where e.is_test is not true and jsonb_typeof(pr.payload -> 'podium') = 'array' and jsonb_array_length(pr.payload -> 'podium') > 0
         and not exists (select 1 from app.seduh_feed_queue q where q.result_id = pr.id)),
    'queued_results', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'result_id', q.result_id, 'org_id', q.org_id, 'event_id', pr.event_id, 'enqueued_at', q.enqueued_at,
               'identities_to_create', x.to_create, 'identities_reused', x.reused, 'people_to_link', x.to_link,
               'skipped_bad_phone', x.bad_phone, 'skipped_blocked', x.blocked, 'skipped_merge_cycle', x.cycle,
               'people_linked_elsewhere', x.elsewhere) order by q.enqueued_at, q.result_id), '[]')
        from app.seduh_feed_queue q
        left join public.public_results pr on pr.id = q.result_id
        cross join lateral (
          select count(distinct pl.phone) filter (where pl.class = 'eligible' and pl.identity_id is null and pl.linked_to is null) as to_create,
                 count(distinct pl.identity_id) filter (where pl.class = 'eligible' and pl.identity_id is not null) as reused,
                 count(*) filter (where pl.class = 'eligible' and pl.linked_to is null) as to_link,
                 count(*) filter (where pl.class = 'bad_phone') as bad_phone,
                 count(*) filter (where pl.class = 'blocked') as blocked,
                 count(*) filter (where pl.class = 'merge_cycle') as cycle,
                 count(*) filter (where pl.class = 'eligible' and pl.linked_to is not null and pl.linked_to is distinct from pl.identity_id) as elsewhere
            from app.seduh_feed_plan_internal(array[q.result_id]) pl) x
       where q.state = 'queued'),
    'by_org', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'org_id', o.org_id, 'results_queued', o.results_queued, 'identities_to_create', o.to_create,
               'created_last_24h', o.created_24h) order by o.org_id), '[]')
        from (select g.org_id, g.results_queued,
                     (select count(distinct pl.phone)
                        from app.seduh_feed_plan_internal(g.ids) pl
                       where pl.class = 'eligible' and pl.identity_id is null and pl.linked_to is null) as to_create,
                     (select coalesce(sum(cardinality(d.created_identity_ids)), 0)
                        from app.seduh_feed_queue d
                       where d.org_id = g.org_id and d.state = 'processed' and d.processed_at > now() - interval '24 hours') as created_24h
                from (select q.org_id, count(*) as results_queued, array_agg(q.result_id) as ids
                        from app.seduh_feed_queue q where q.state = 'queued' group by q.org_id) g) o)
  ) into v_report;
  return v_report;
end;
$$;
revoke all on function app.seduh_feed_review() from public, anon, authenticated, service_role;

-- ============ (8) `auto` mode's job, caps included ============

-- Does nothing unless the mode is `auto`. Works the oldest queued results first, one at a time, each in its own
-- sub-transaction. A result whose new identities would take its organisation over org_daily_cap, or the platform over
-- global_daily_cap, within the last 24 hours STAYS QUEUED (the used figure counts the identities the processed rows recorded in
-- that window, so a row processed twice can over-count and never under-count). A result that alone exceeds the org cap stays
-- queued until the owner raises the cap or runs it by hand. An error rolls that result back, records only the SQLSTATE,
-- and the job moves on.
-- NOT scheduled by this migration (and archive_tick is not edited): the owner adds the job when switching to `auto`.
create or replace function app.seduh_feed_auto_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api      text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  v_m        app.seduh_feed_mode;
  r          record;
  v_n        integer;
  v_org_used integer;
  v_all_used integer;
  v_done     integer := 0;
  v_deferred integer := 0;
  v_errored  integer := 0;
begin
  if session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api) then
    raise exception 'seduh_feed_auto_run is run by the database owner only'
      using errcode = '42501', hint = 'seduh_feed_owner_only';
  end if;

  select * into v_m from app.seduh_feed_mode;
  if not found or v_m.mode is distinct from 'auto' then
    return jsonb_build_object('ran', false, 'mode', coalesce(v_m.mode, 'off'));
  end if;

  for r in
    select q.result_id, q.org_id
      from app.seduh_feed_queue q
     where q.state = 'queued'
     order by q.enqueued_at, q.result_id
     limit 50
       for update skip locked
  loop
    begin
      select count(distinct pl.phone)::integer into v_n
        from app.seduh_feed_plan_internal(array[r.result_id]) pl
       where pl.class = 'eligible' and pl.identity_id is null and pl.linked_to is null;
      select coalesce(sum(cardinality(d.created_identity_ids)), 0)::integer into v_org_used
        from app.seduh_feed_queue d
       where d.org_id = r.org_id and d.state = 'processed' and d.processed_at > now() - interval '24 hours';
      select coalesce(sum(cardinality(d.created_identity_ids)), 0)::integer into v_all_used
        from app.seduh_feed_queue d
       where d.state = 'processed' and d.processed_at > now() - interval '24 hours';

      if v_n > 0 and (v_org_used + v_n > v_m.org_daily_cap or v_all_used + v_n > v_m.global_daily_cap) then
        v_deferred := v_deferred + 1;
      else
        perform app.seduh_feed_apply(array[r.result_id], 'auto');
        v_done := v_done + 1;
      end if;
    exception when others then
      v_errored := v_errored + 1;
      perform set_config('app.seduh_link_write', '', true);
      update app.seduh_feed_queue set last_error = sqlstate where result_id = r.result_id;
    end;
  end loop;

  return jsonb_build_object('ran', true, 'mode', 'auto', 'processed', v_done, 'deferred_over_cap', v_deferred, 'errored', v_errored);
end;
$$;
revoke all on function app.seduh_feed_auto_run() from public, anon, authenticated, service_role;

-- ============ (9) undo ============

-- Undoes PROCESSED queue rows (B4's undo pattern, spec 5.7). For the chosen rows: (1) unlink the people they recorded, but only
-- those still linked to an identity that one of the chosen rows CREATED (a person linked later to anything else, or to an
-- identity from elsewhere, is left alone); (2) delete a created identity only if it is still archive/active, no person is
-- linked to it any more and no tombstone points at it. An identity that gained a person since is KEPT and counted. Then the
-- row becomes 'undone' (kept for the record; run again, it finds nothing left). p_apply false = report only.
-- Deleting an identity cannot be undone; `queue` mode exists so the common case is to reject before creation.
create or replace function app.seduh_feed_undo(p_result_ids uuid[], p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api       text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  v_unlink    uuid[];
  v_delete    uuid[];
  v_all_ids   uuid[];
  v_unlinked  uuid[] := '{}';
  v_deleted   uuid[] := '{}';
begin
  if p_apply is null or session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api) then
    raise exception 'seduh_feed_undo is run by the database owner only'
      using errcode = '42501', hint = 'seduh_feed_owner_only';
  end if;
  if p_result_ids is null or cardinality(p_result_ids) = 0 then
    raise exception 'seduh_feed_undo needs the result ids you chose'
      using errcode = '22023', hint = 'seduh_feed_ids_required';
  end if;

  select coalesce(array_agg(distinct ci.id), '{}') into v_all_ids
    from app.seduh_feed_queue q cross join lateral unnest(q.created_identity_ids) as ci(id)
   where q.result_id = any (p_result_ids) and q.state = 'processed';

  -- people to unlink: recorded on a chosen processed row AND still linked to an identity that a chosen row created
  select coalesce(array_agg(distinct p.id), '{}') into v_unlink
    from app.seduh_feed_queue q
    cross join lateral unnest(q.linked_person_ids) as lp(person_id)
    join public.people p on p.id = lp.person_id and p.global_person_id = any (v_all_ids)
   where q.result_id = any (p_result_ids) and q.state = 'processed';

  -- identities to delete: created by a chosen row, archive/active, nobody linked after the unlink, no tombstone points at them
  select coalesce(array_agg(i.id), '{}') into v_delete
    from app.seduh_identities i
   where i.id = any (v_all_ids)
     and i.source = 'archive' and i.status = 'active'
     and not exists (select 1 from public.people p where p.global_person_id = i.id and p.id <> all (v_unlink))
     and not exists (select 1 from app.seduh_identities t where t.merged_into = i.id);

  if p_apply then
    perform set_config('app.seduh_link_write', 'on', true);
    with u as (
      update public.people p set global_person_id = null where p.id = any (v_unlink) returning p.id
    ) select coalesce(array_agg(id), '{}') into v_unlinked from u;
    perform set_config('app.seduh_link_write', '', true);

    with d as (
      delete from app.seduh_identities i where i.id = any (v_delete) returning i.id
    ) select coalesce(array_agg(id), '{}') into v_deleted from d;

    update app.seduh_feed_queue set state = 'undone'
     where result_id = any (p_result_ids) and state = 'processed';
  end if;

  return jsonb_build_object(
    'mode', case when p_apply then 'apply' else 'dry_run' end,
    'people_to_unlink', cardinality(v_unlink),
    'identities_to_delete', cardinality(v_delete),
    'identities_kept', cardinality(v_all_ids) - cardinality(v_delete),
    'people_unlinked', cardinality(v_unlinked),
    'identities_deleted', cardinality(v_deleted));
end;
$$;
revoke all on function app.seduh_feed_undo(uuid[], boolean) from public, anon, authenticated, service_role;
