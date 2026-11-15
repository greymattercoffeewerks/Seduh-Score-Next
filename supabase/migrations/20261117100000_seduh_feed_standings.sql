-- Seduh Score Next · T-ID2.B2: the Seduh ID feed reads the full standings, and the archive snapshot can carry them
--
-- Why (the B2 coverage audit, Handoffs and Specs/SEDUH-ID-B2-COVERAGE-AUDIT.md, owner decisions of 2026-11-15, spec 14.7):
-- the feed named only the PODIUM, so a published event of N competitors gave identities to at most three, and a person
-- outside the podium had a phone and a roster row but no identity, so no profile and nothing to claim. Now a published
-- result that carries `standings` (the organiser's full-standings publish) queues the same way, and the owner's review step
-- creates identities for everyone the standings name. Nothing is created automatically: the mode stays `queue`.
--
-- What changes (create or replace; no table, no column, no ACL changes):
--   * app.enqueue_seduh_feed        queues a result whose payload has a non-empty `podium` OR a non-empty `standings`. A stub
--                                   (neither) and a test event are still never queued. Everything else is as before (fail open,
--                                   a re-save of an identical payload asks nothing new, a changed payload on a PROCESSED result
--                                   asks for a new review, a rejected or undone one is not revived by a member).
--   * app.seduh_feed_slots_internal reads `podium` UNION `standings`, distinct by (result, trimmed name, trimmed cafe), the same
--                                   slots B4's backfill reads (app.seduh_backfill_slots_internal), so the feed's plan equals B4's
--                                   for every result: a person standing in both arrays is one slot, and a podium finisher the
--                                   standings leave out (a withdrawn one the podium always lists) is still named. The match rule
--                                   is unchanged and is the profile door's: EXACTLY ONE roster entry of the event carries that
--                                   name and cafe (trimmed, a blank cafe equals a blank one) and that entry has a person of the
--                                   event's organisation. The phone rules (is_e164, owner blocks, merged tombstones, an existing
--                                   identity reused and never overwritten, a person linked elsewhere left alone) are in
--                                   app.seduh_feed_plan_internal, which is not edited.
--   * app.seduh_feed_review         the "published but never queued" count now covers a standings result too. Its key keeps the
--                                   name `podium_results_not_queued` (the owner's SQL and test 071 read it).
--   * app.archive_snapshot_payload  also copies `standings` (and `notListed`) so the archive tick can publish a full result. Cap:
--                                   at most 200 rows, each an object with a non-blank text name, only the keys the results page
--                                   reads (place, name, cafe, round, correct, total, timeSecs). A standings array that is too
--                                   long, or has a row that is not usable, is DROPPED whole (the podium still publishes): the
--                                   database never publishes a part of a ranking. The 64 KB cap on the input is unchanged.
--                                   app.archive_stub_payload is NOT edited: a stub stays names-only.
--
-- WHAT THIS DOES NOT CLOSE. The forgery gap (a member staging a non-test event, a person holding any phone and a payload naming
-- them) now spans every standings row instead of three, so the review step matters more, not less: `queue` mode is the
-- control, and `auto` stays off. In `auto` mode the default caps (8 identities per organisation and 40 in total per 24 hours,
-- app.seduh_feed_mode) would hold a full event of more than 8 new people QUEUED, which is why the owner reviews and runs it.
-- A change of what the feed reads does not re-queue results published earlier: one published before this migration is
-- re-queued only by a changed payload (the owner may insert a queue row with SQL). The cloud holds one such result and its
-- people are already linked (B2 audit, 2.3).
--
-- rollback (verified in a transaction in test 071b, which re-runs the three definitions below from the files that hold them;
-- the review function is restored by re-running section (7) of 20261103100000_seduh_feed.sql, whose
-- `podium_results_not_queued` is podium only):
--   create or replace function app.enqueue_seduh_feed() ...          (section (3) of 20261103100000_seduh_feed.sql)
--   create or replace function app.seduh_feed_slots_internal(uuid[]) ... (section (4) of the same file)
--   create or replace function app.archive_snapshot_payload(jsonb) ...   (20261101100000_archive_tick.sql, "the key whitelist")

-- ============ (1) the enqueue trigger: a podium OR full standings ============

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
    -- `off` (the default) and a missing mode row enqueue nothing; a stub names nobody (neither a podium nor standings); a test
    -- event is never queued (the BEFORE trigger already refuses to publish one)
    if coalesce((select m.mode from app.seduh_feed_mode m), 'off') in ('queue', 'auto')
       and ((jsonb_typeof(new.payload -> 'podium') = 'array' and jsonb_array_length(new.payload -> 'podium') > 0)
         or (jsonb_typeof(new.payload -> 'standings') = 'array' and jsonb_array_length(new.payload -> 'standings') > 0))
       and exists (select 1 from public.events e where e.id = new.event_id and e.is_test is not true) then
      -- a changed payload on a PROCESSED result asks for a new review (a podium-only publish later widened to full standings is
      -- exactly that); what is recorded for undo and processed_at (which the caps read) stay, so a member cannot reset a cap by
      -- republishing. A result the owner REJECTED or UNDID is not revived by a member
      insert into app.seduh_feed_queue as q (result_id, org_id)
      values (new.id, new.org_id)
      on conflict (result_id) do update
         set state = 'queued', enqueued_at = now(), last_error = null
       where q.state = 'processed';
    end if;
  exception when others then
    null;   -- a publish must never fail because of the feed
  end;
  return null;
end;
$$;
revoke all on function app.enqueue_seduh_feed() from public, anon, authenticated, service_role;

-- ============ (2) the matching: podium union standings ============

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
    cross join lateral (
      select x as elem from jsonb_array_elements(
        case when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium' else '[]'::jsonb end) x
      union all
      select x as elem from jsonb_array_elements(
        case when jsonb_typeof(pr.payload -> 'standings') = 'array' then pr.payload -> 'standings' else '[]'::jsonb end) x
    ) s
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

-- ============ (3) the review's "not queued" count ============

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
                           from app.seduh_feed_queue q where q.processed_at > now() - interval '24 hours'),
    'queue', jsonb_build_object(
      'queued',    (select count(*) from app.seduh_feed_queue where state = 'queued'),
      'processed', (select count(*) from app.seduh_feed_queue where state = 'processed'),
      'rejected',  (select count(*) from app.seduh_feed_queue where state = 'rejected'),
      'undone',    (select count(*) from app.seduh_feed_queue where state = 'undone')),
    -- a published non-test result that names people (a podium or full standings) with no queue row: while the mode is off that is every one; in queue/auto mode a non-zero
    -- count means the (fail-open) trigger missed one or the mode was off when it was published
    'podium_results_not_queued', (
      select count(*) from public.public_results pr join public.events e on e.id = pr.event_id
       where e.is_test is not true
         and ((jsonb_typeof(pr.payload -> 'podium') = 'array' and jsonb_array_length(pr.payload -> 'podium') > 0)
           or (jsonb_typeof(pr.payload -> 'standings') = 'array' and jsonb_array_length(pr.payload -> 'standings') > 0))
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
                       where d.org_id = g.org_id and d.processed_at > now() - interval '24 hours') as created_24h
                from (select q.org_id, count(*) as results_queued, array_agg(q.result_id) as ids
                        from app.seduh_feed_queue q where q.state = 'queued' group by q.org_id) g) o)
  ) into v_report;
  return v_report;
end;
$$;
revoke all on function app.seduh_feed_review() from public, anon, authenticated, service_role;

-- ============ (4) the archive whitelist carries standings, capped ============

create or replace function app.archive_snapshot_payload(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_top       jsonb;
  v_podium    jsonb;
  v_standings jsonb;
  v_n         integer;
  v_s         integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 65536 then
    return null;
  end if;
  if coalesce(jsonb_typeof(p -> 'podium'), '') <> 'array' then
    return null;
  end if;
  v_n := jsonb_array_length(p -> 'podium');
  if v_n < 1 or v_n > 8 then
    return null;
  end if;
  -- every row an object with a non-blank text name (the champion is row 1)
  if exists (
       select 1 from jsonb_array_elements(p -> 'podium') r
        where jsonb_typeof(r) <> 'object' or coalesce(jsonb_typeof(r -> 'name'), '') <> 'string' or nullif(btrim(r ->> 'name'), '') is null) then
    return null;
  end if;

  select coalesce(jsonb_object_agg(e.key,
                    case when jsonb_typeof(e.value) = 'string' then to_jsonb(left(e.value #>> '{}', 200)) else e.value end), '{}'::jsonb)
    into v_top
    from jsonb_each(p) e
   where e.key in ('format', 'eventName', 'city', 'venue', 'eventDate', 'competitors', 'rounds', 'winningTimeSecs', 'notListed')
     and jsonb_typeof(e.value) = case when e.key in ('competitors', 'rounds', 'winningTimeSecs', 'notListed') then 'number' else 'string' end;

  select jsonb_agg(jsonb_build_object(
           'rank',    case when jsonb_typeof(r.v -> 'rank')    = 'number' then r.v -> 'rank'    end,
           'name',    to_jsonb(left(r.v ->> 'name', 120)),
           'cafe',    case when jsonb_typeof(r.v -> 'cafe')    = 'string' then to_jsonb(left(r.v ->> 'cafe', 120)) end,
           'correct', case when jsonb_typeof(r.v -> 'correct') = 'number' then r.v -> 'correct' end,
           'total',   case when jsonb_typeof(r.v -> 'total')   = 'number' then r.v -> 'total'   end)
         order by r.ord)
    into v_podium
    from jsonb_array_elements(p -> 'podium') with ordinality as r(v, ord);

  -- the full standings, when there are any, there are at most 200 and every row is usable: otherwise none of them (never a part
  -- of a ranking). The same whitelist as the podium's, with the keys a standings row has.
  if jsonb_typeof(p -> 'standings') = 'array' then
    v_s := jsonb_array_length(p -> 'standings');
    if v_s between 1 and 200
       and not exists (
         select 1 from jsonb_array_elements(p -> 'standings') r
          where jsonb_typeof(r) <> 'object' or coalesce(jsonb_typeof(r -> 'name'), '') <> 'string' or nullif(btrim(r ->> 'name'), '') is null) then
      select jsonb_agg(jsonb_build_object(
               'place',    case when jsonb_typeof(r.v -> 'place')    = 'number' then r.v -> 'place'    end,
               'name',     to_jsonb(left(r.v ->> 'name', 120)),
               'cafe',     case when jsonb_typeof(r.v -> 'cafe')     = 'string' then to_jsonb(left(r.v ->> 'cafe', 120)) end,
               'round',    case when jsonb_typeof(r.v -> 'round')    = 'string' then to_jsonb(left(r.v ->> 'round', 120)) end,
               'correct',  case when jsonb_typeof(r.v -> 'correct')  = 'number' then r.v -> 'correct'  end,
               'total',    case when jsonb_typeof(r.v -> 'total')    = 'number' then r.v -> 'total'    end,
               'timeSecs', case when jsonb_typeof(r.v -> 'timeSecs') = 'number' then r.v -> 'timeSecs' end)
             order by r.ord)
        into v_standings
        from jsonb_array_elements(p -> 'standings') with ordinality as r(v, ord);
    end if;
  end if;

  -- `notListed` goes only with standings: it says how many rows the printed table leaves out
  if v_standings is null then
    v_top := v_top - 'notListed';
  end if;

  return v_top || jsonb_build_object('podium', v_podium)
               || case when v_standings is not null then jsonb_build_object('standings', v_standings) else '{}'::jsonb end;
end;
$$;
