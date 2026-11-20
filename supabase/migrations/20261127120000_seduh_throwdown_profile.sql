-- Seduh Score Next · T-ID2.TD: Throwdown on the Seduh ID profile
-- (Step 2 of "Throwdown joins Seduh ID": #527 phones, #528 publishing, this: the profile side. Owner answers 2026-11-20.)
--
-- WHAT CHANGES. A claimed person's profile now shows their published THROWDOWN result (place, round reached) and their knockout
-- record (won, lost, and per opponent when that opponent may be named). Nothing else about the door changes: Cup Taster's output is
-- identical, and the door still reads the PUBLISHED PAYLOAD only (public_results), never a td_* table.
--   * app.seduh_recorded_rows and app.seduh_published_matches accept format 'throwdown' beside 'cup_taster': a Throwdown payload's
--     `podium` and `standings` have the same shape for the keys read (rank/place, round, name, cafe). A Throwdown row has no
--     correct, total or time, so those come back null. The same rule decides who a row belongs to, the same dispute
--     ("This isn't mine") hides it, the same test-event rule excludes it. As a result the results-page profile links and the
--     discovery search also cover Throwdown.
--   * app.seduh_knockout_record (new, internal, no grant): reads the `matches` list that Throwdown publishing now adds to the payload
--     (full standings scope only), counting only decided, played, two-competitor matches (the publisher leaves out byes and
--     walkovers; a 3rd place match counts; owner decisions 2026-11-20). Rules and the opponent-naming conditions are in its header.
--   * public.public_seduh_profile calls it when the person's vis_knockout_record is 'public' (a hidden setting keeps zeros, the
--     same shape as a person with no matches). The door's shape is unchanged. The function is a copy of the one in
--     20261126120000_seduh_result_disputes.sql with only the knockout lines and two comments changed.
--
-- DECISION FOR THE OWNER TO CONFIRM AT REVIEW (not asked separately): "This isn't mine" on a Throwdown result also hides that
-- event's knockout matches (and stops the person being named as an opponent in other people's records for that event).
--
-- NEVER RETURNED: phone, email, user_id, any uuid or internal id, org_id, a score, or the name of an opponent who is not claimed,
-- open, active and public for both vis_identity and vis_knockout_record.
--
-- ROLLBACK (nothing stored: functions only; safe at any time). Restore the previous bodies, then drop the new function:
-- rollback:
--   -- re-run, as `create or replace`, from 20261126120000_seduh_result_disputes.sql: app.seduh_recorded_rows,
--   -- app.seduh_published_matches and public.public_seduh_profile (the latest definitions there; seduh_recorded_rows is a plain
--   -- `create function` there), then:
--   drop function if exists app.seduh_knockout_record(uuid, uuid);
--   -- (drop it only after public_seduh_profile is restored: the new profile body calls it.)

-- ============ the recorded-results query (moved out of public_seduh_profile, unchanged rule) ============

-- Every Cup Taster or Throwdown payload row of a published, non-test event that names this identity (exactly one roster entry with that name
-- and cafe, linked to the identity, exactly one payload row with that name and cafe: the rule of the archive feed), WITH the
-- account's dispute on it, if any. Internal: callers choose what to show. `pos` is the profile's order (newest event first).
create or replace function app.seduh_recorded_rows(p_account uuid, p_identity uuid)
returns table (event_id uuid, result_key text, dispute_id bigint, dispute_status text, dispute_at timestamptz, pos bigint, j jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select c.event_id, k.key, d.id, d.status, d.created_at,
         row_number() over (order by c.event_date desc nulls last, c.published_at desc, c.ord),
         jsonb_build_object(
           'event_name',     coalesce(nullif(left(btrim(c.payload ->> 'eventName'), 120), ''), c.event_name),
           'format',         c.format,
           'organiser_name', c.org_name,
           'event_date',     c.event_date,
           'placing',        case when c.place_txt ~ '^[0-9]{1,4}$' then c.place_txt::integer end,
           'stage',          nullif(left(btrim(c.stage_txt), 60), ''),
           -- the page shows a score only when BOTH figures are there
           'correct',        case when c.correct_txt ~ '^[0-9]{1,4}$' and c.total_txt ~ '^[0-9]{1,4}$' then c.correct_txt::integer end,
           'total',          case when c.correct_txt ~ '^[0-9]{1,4}$' and c.total_txt ~ '^[0-9]{1,4}$' then c.total_txt::integer end,
           'time_secs',      case when c.time_txt ~ '^[0-9]{1,6}$' then c.time_txt::integer end,
           'provenance',     'seduh_score')
    from (
      select e.id as event_id, pr.published_at, pr.payload, e.format, e.name as event_name, e.event_date, o.name as org_name,
             x.ord, x.nm, x.cf,
             -- only the keys the results page itself reads: a podium row has rank, correct and total (no round, no
             -- time); a standings row has place, round, correct, total and timeSecs
             case when x.is_standings then x.elem ->> 'place' else x.elem ->> 'rank' end as place_txt,
             case when x.is_standings then x.elem ->> 'round' end as stage_txt,
             x.elem ->> 'correct' as correct_txt, x.elem ->> 'total' as total_txt,
             case when x.is_standings then x.elem ->> 'timeSecs' end as time_txt,
             -- the same name and cafe twice in one publication names nobody
             count(*) over (partition by pr.id, x.nm, x.cf) as same_rows,
             -- the feed's rule: exactly one roster entry of the event carries that name and cafe
             (select count(*) from public.event_entries en2
               where en2.event_id = e.id and btrim(en2.display_name) = x.nm
                 and coalesce(btrim(en2.cafe), '') = x.cf) as same_entries
        from public.people pe
        join public.event_entries en on en.person_id = pe.id
        join public.events e on e.id = en.event_id and e.org_id = pe.org_id
        join public.orgs o on o.id = e.org_id
        join public.public_results pr on pr.event_id = e.id
        cross join lateral (
          select s.elem, s.ord, btrim(s.elem ->> 'name') as nm, coalesce(btrim(s.elem ->> 'cafe'), '') as cf,
                 (jsonb_typeof(pr.payload -> 'standings') = 'array' and jsonb_array_length(pr.payload -> 'standings') > 0) as is_standings
            from jsonb_array_elements(
                   case when jsonb_typeof(pr.payload -> 'standings') = 'array'
                             and jsonb_array_length(pr.payload -> 'standings') > 0
                        then pr.payload -> 'standings'
                        when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium'
                        else '[]'::jsonb end) with ordinality as s(elem, ord)
           where jsonb_typeof(s.elem) = 'object' and nullif(btrim(s.elem ->> 'name'), '') is not null
        ) x
       where pe.global_person_id = p_identity
         and e.is_test is not true
         -- SEAM is_shadow: when MARCH-2027-BOARD-PLAN P1 adds events.is_shadow, add `and e.is_shadow is not true`
         -- here AND in app.seduh_published_matches. A shadow-run result must never reach a profile.
         and e.format in ('cup_taster', 'throwdown')   -- both formats publish `podium` and `standings` of the same shape (Throwdown: T-ID2.TD)
         and x.nm = btrim(en.display_name)
         and x.cf = coalesce(btrim(en.cafe), '')
    ) c
    cross join lateral (select app.seduh_result_key(c.event_id, c.nm, c.cf) as key) k
    left join app.seduh_result_disputes d on d.account_id = p_account and d.event_id = c.event_id and d.result_key = k.key
   where c.same_rows = 1 and c.same_entries = 1
$$;
revoke all on function app.seduh_recorded_rows(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function app.seduh_published_matches(p_event uuid, p_identity uuid)
returns table (event_id uuid, nm text, cf text, identity_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.event_id, c.nm, c.cf, c.gid
    from (
      select e.id as event_id, x.nm, x.cf, pe.global_person_id as gid,
             count(*) over (partition by pr.id, x.nm, x.cf) as same_rows,
             (select count(*) from public.event_entries en2
               where en2.event_id = e.id and btrim(en2.display_name) = x.nm
                 and coalesce(btrim(en2.cafe), '') = x.cf) as same_entries
        from public.people pe
        join public.event_entries en on en.person_id = pe.id
        join public.events e on e.id = en.event_id and e.org_id = pe.org_id
        join public.public_results pr on pr.event_id = e.id
        cross join lateral (
          select btrim(s.elem ->> 'name') as nm, coalesce(btrim(s.elem ->> 'cafe'), '') as cf
            from jsonb_array_elements(
                   case when jsonb_typeof(pr.payload -> 'standings') = 'array'
                             and jsonb_array_length(pr.payload -> 'standings') > 0
                        then pr.payload -> 'standings'
                        when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium'
                        else '[]'::jsonb end) as s(elem)
           where jsonb_typeof(s.elem) = 'object' and nullif(btrim(s.elem ->> 'name'), '') is not null
        ) x
       where pe.global_person_id is not null
         and (p_identity is null or pe.global_person_id = p_identity)
         and (p_event is null or e.id = p_event)
         and e.is_test is not true
         -- SEAM is_shadow: add `and e.is_shadow is not true` where the profile query does (MARCH-2027-BOARD-PLAN P1).
         and e.format in ('cup_taster', 'throwdown')
         and x.nm = btrim(en.display_name)
         and x.cf = coalesce(btrim(en.cafe), '')
    ) c
   where c.same_rows = 1 and c.same_entries = 1
     -- T-ID2.NM: a result the person said is not theirs is not theirs for search and results-page links either
     and not app.seduh_result_hidden(c.gid, c.event_id, app.seduh_result_key(c.event_id, c.nm, c.cf))
$$;

-- ============ the knockout record ============

-- The Throwdown knockout record of one claimed person: matches won and lost, and per opponent when that opponent may be named.
-- Read ONLY from the `matches` list of a published, non-test Throwdown payload (owner decision 2026-11-16), counting only
-- decided matches between two named competitors (the builder leaves out byes, walkovers and undecided matches; this reader
-- re-checks the shape of every element, because the payload is caller-assembled jsonb).
--   * A side is this person when the event's roster has EXACTLY ONE entry with that trimmed name and café, that entry's person is
--     linked to this identity, and the person's own recorded result for the event is shown (not disputed: "This isn't mine" on a
--     Throwdown result hides that event's matches too; owner to confirm).
--   * The other side is named only when it is, in the same way, ONE roster entry linked to a DIFFERENT claimed, open,
--     18-attested, active identity whose vis_identity AND vis_knockout_record are both 'public' and who has not disputed their
--     own result for the event. Otherwise the match counts and no name is given.
--   * A match whose two sides are both this person's entries counts for nothing.
-- Returns {won, lost, opponents:[{display_name, matches, won, lost}]}; no id of any kind. Internal: the profile door applies
-- the person's own vis_knockout_record before calling it.
create function app.seduh_knockout_record(p_account uuid, p_identity uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as materialized (
    select r.event_id, r.result_key
      from app.seduh_recorded_rows(p_account, p_identity) r
     where r.dispute_id is null and r.j ->> 'format' = 'throwdown'
  ),
  played as (
    select ev.id as event_id, ev.org_id, a.nm as a_nm, a.cf as a_cf, a.won as a_won, b.nm as b_nm, b.cf as b_cf
      from mine
      join public.events ev on ev.id = mine.event_id
      join public.public_results pr on pr.event_id = ev.id
      cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(pr.payload -> 'matches') = 'array' then pr.payload -> 'matches' else '[]'::jsonb end)
                 with ordinality as mt(elem, ord)
      cross join lateral (values (0, 1), (1, 0)) as pick(i, j)
      cross join lateral (
        select btrim(mt.elem -> 'sides' -> pick.i ->> 'name') as nm,
               coalesce(btrim(mt.elem -> 'sides' -> pick.i ->> 'cafe'), '') as cf,
               case when jsonb_typeof(mt.elem -> 'sides' -> pick.i -> 'winner') = 'boolean'
                    then (mt.elem -> 'sides' -> pick.i ->> 'winner')::boolean end as won) a
      cross join lateral (
        select btrim(mt.elem -> 'sides' -> pick.j ->> 'name') as nm,
               coalesce(btrim(mt.elem -> 'sides' -> pick.j ->> 'cafe'), '') as cf) b
     where mt.ord <= 200
       and ev.is_test is not true
       -- SEAM is_shadow: add `and ev.is_shadow is not true` with the other readers (MARCH-2027-BOARD-PLAN P1).
       and ev.format = 'throwdown'
       -- exactly two sides, both objects with a name, exactly one of them the winner
       and jsonb_typeof(mt.elem) = 'object'
       and mt.elem -> 'sides' -> 0 is not null and mt.elem -> 'sides' -> 1 is not null and mt.elem -> 'sides' -> 2 is null
       and nullif(btrim(mt.elem -> 'sides' -> 0 ->> 'name'), '') is not null
       and nullif(btrim(mt.elem -> 'sides' -> 1 ->> 'name'), '') is not null
       and jsonb_typeof(mt.elem -> 'sides' -> 0 -> 'winner') = 'boolean'
       and jsonb_typeof(mt.elem -> 'sides' -> 1 -> 'winner') = 'boolean'
       and (mt.elem -> 'sides' -> 0 -> 'winner') <> (mt.elem -> 'sides' -> 1 -> 'winner')   -- both booleans (above): exactly one true
       and (a.nm, a.cf) <> (b.nm, b.cf)
       -- side `a` is this person: their undisputed recorded result for the event carries this name and café
       and app.seduh_result_key(ev.id, a.nm, a.cf) = mine.result_key
       and exists (select 1 from public.people pe join public.event_entries en on en.person_id = pe.id
                    where pe.global_person_id = p_identity and pe.org_id = ev.org_id and en.event_id = ev.id
                      and btrim(en.display_name) = a.nm and coalesce(btrim(en.cafe), '') = a.cf)
       and (select count(*) from public.event_entries en2
             where en2.event_id = ev.id and btrim(en2.display_name) = a.nm and coalesce(btrim(en2.cafe), '') = a.cf) = 1
       -- side `b` is not also this person
       and not exists (select 1 from public.people pe3 join public.event_entries en3 on en3.person_id = pe3.id
                        where pe3.global_person_id = p_identity and pe3.org_id = ev.org_id and en3.event_id = ev.id
                          and btrim(en3.display_name) = b.nm and coalesce(btrim(en3.cafe), '') = b.cf)
  ),
  named as (
    select p.a_won, o.oid, o.display_name
      from played p
      left join lateral (
        select i2.id as oid, i2.display_name
          from public.event_entries en4
          join public.people pe4 on pe4.id = en4.person_id and pe4.org_id = p.org_id
          join app.seduh_accounts a4 on a4.identity_id = pe4.global_person_id and a4.closed_at is null and a4.adult_attested_at is not null
          join app.seduh_identities i2 on i2.id = a4.identity_id and i2.status = 'active'
          join app.seduh_profile_settings s4 on s4.account_id = a4.id
                                            and s4.vis_identity = 'public' and s4.vis_knockout_record = 'public'
         where en4.event_id = p.event_id and btrim(en4.display_name) = p.b_nm and coalesce(btrim(en4.cafe), '') = p.b_cf
           and pe4.global_person_id <> p_identity
           and (select count(*) from public.event_entries en5
                 where en5.event_id = p.event_id and btrim(en5.display_name) = p.b_nm
                   and coalesce(btrim(en5.cafe), '') = p.b_cf) = 1
           and not app.seduh_result_hidden(i2.id, p.event_id, app.seduh_result_key(p.event_id, p.b_nm, p.b_cf))
      ) o on true
  ),
  per_opp as (
    select oid, display_name, count(*)::integer as matches,
           count(*) filter (where a_won)::integer as won, count(*) filter (where not a_won)::integer as lost
      from named where oid is not null group by oid, display_name
  )
  select jsonb_build_object(
    'won',  (select count(*) from played where a_won)::integer,
    'lost', (select count(*) from played where not a_won)::integer,
    'opponents', coalesce((select jsonb_agg(jsonb_build_object('display_name', display_name, 'matches', matches, 'won', won, 'lost', lost)
                                            order by matches desc, display_name, oid)
                             from (select * from per_opp order by matches desc, display_name, oid limit 50) t), '[]'::jsonb))
$$;
revoke all on function app.seduh_knockout_record(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.public_seduh_profile(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_handle    text := lower(btrim(coalesce(p_handle, '')));
  v_acc_id    uuid;
  v_identity  uuid;
  v_found     boolean := false;
  v_name      text;
  v_country   text;
  v_founding  integer;
  v_claimed   date;
  v_vis_id    text;
  v_vis_rec   text;
  v_vis_ko    text;
  v_vis_org   text;
  v_vis_self  text;
  v_vis_crs   text;
  v_photo     text;
  v_orgrec    jsonb := '[]'::jsonb;
  v_self      jsonb := '[]'::jsonb;
  v_courses   jsonb := '[]'::jsonb;
  v_ident     jsonb;
  v_results   jsonb := '[]'::jsonb;
  v_won       integer := 0;
  v_lost      integer := 0;
  v_opps      jsonb := '[]'::jsonb;
  v_ko        jsonb;
begin
  -- Input: the same SHAPE rule as the account table. The watch list is NOT consulted here (20261121100000): a handle is permanent, a
  -- term added later must never unpublish an existing profile, and a blocked handle cannot have an account anyway. Anything else gets the empty shape below.
  if v_handle ~ '^[a-z0-9](-?[a-z0-9])*$'
     and char_length(v_handle) between 3 and 30 then
    select a.id, a.identity_id, i.display_name, i.country_code, a.founding_number,
           (a.claimed_at at time zone 'UTC')::date,
           -- a missing settings row (the account trigger makes one) fails closed
           coalesce(s.vis_identity, 'hidden'), coalesce(s.vis_recorded_results, 'hidden'),
           coalesce(s.vis_knockout_record, 'hidden'),
           coalesce(s.vis_organiser_results, 'hidden'), coalesce(s.vis_self_reported_results, 'hidden'),
           coalesce(s.vis_courses, 'hidden'),
           ph.photo_path
      into v_acc_id, v_identity, v_name, v_country, v_founding, v_claimed, v_vis_id, v_vis_rec, v_vis_ko, v_vis_org, v_vis_self,
           v_vis_crs, v_photo
      from app.seduh_accounts a
      join app.seduh_identities i on i.id = a.identity_id
      left join app.seduh_profile_settings s on s.account_id = a.id
      left join app.seduh_account_photos ph on ph.account_id = a.id
     where a.handle = v_handle
       and a.closed_at is null
       and a.adult_attested_at is not null
       and i.status = 'active';
    v_found := found;
  end if;

  if not v_found then
    return jsonb_build_object(
      'has_profile', false,
      'handle', null,
      'identity', jsonb_build_object('display_name', null, 'country_code', null, 'founding_number', null,
                                     'claimed_on', null, 'photo_url', null),
      'recorded_results', '[]'::jsonb,
      'knockout_record', jsonb_build_object('won', 0, 'lost', 0, 'opponents', '[]'::jsonb),
      'organiser_records', '[]'::jsonb,
      'self_reported', '[]'::jsonb,
      'courses', '[]'::jsonb,
      'judging_roles', '[]'::jsonb,
      'cafe_affiliations', '[]'::jsonb);
  end if;

  -- Identity block: public or hidden. A hidden block has the same keys, all null.
  if v_vis_id = 'public' then
    v_ident := jsonb_build_object('display_name', v_name, 'country_code', v_country, 'founding_number', v_founding,
                                  'claimed_on', v_claimed,
                                  -- C2: a RELATIVE path under the project's public Storage; the page prefixes its own Supabase URL
                                  'photo_url', case when v_photo is not null then app.seduh_photo_url(v_photo) end);
  else
    v_ident := jsonb_build_object('display_name', null, 'country_code', null, 'founding_number', null,
                                  'claimed_on', null, 'photo_url', null);
  end if;

  -- ============ recorded results (Cup Taster and Throwdown, from the published payload) ============
  -- The query is app.seduh_recorded_rows (the rule of the archive feed). A result the person disputed ("This isn't mine", T-ID2.NM)
  -- is dropped here at once, whatever its status; the event's own results page is not affected.
  if v_vis_rec = 'public' then
    v_results := app.seduh_recorded_results(v_acc_id, v_identity, false);
  end if;

  -- ============ knockout record (Throwdown, from the published payload only) ============
  -- app.seduh_knockout_record reads the `matches` of a published Throwdown payload (never td_matches), so the profile shows no more
  -- than the public results already hold. A hidden setting (anything but 'public') keeps the zeros.
  if v_vis_ko = 'public' then
    v_ko := app.seduh_knockout_record(v_acc_id, v_identity);
    v_won := (v_ko ->> 'won')::integer;
    v_lost := (v_ko ->> 'lost')::integer;
    v_opps := v_ko -> 'opponents';
  end if;

  -- ============ organiser records: the person's TEAM LINKS (20261122100000) ============
  -- The team result is the organiser's ("organiser_archive"); the membership is the person's own claim until the owner confirms
  -- it ('self_reported' or 'confirmed'). Only a LISTED team result shows (an unlisted row is a complete removal). 'organisers'
  -- is hidden to an anonymous caller. No id, no internal key.
  if v_vis_org = 'public' then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'competition', h.competition, 'competition_name', h.competition_name, 'edition_year', h.edition_year,
               'team_name', h.team_name, 'country_code', h.country_code, 'stage_reached', h.stage_reached,
               'placement', h.placement, 'role', m.role, 'membership', m.status, 'provenance', 'organiser_archive')
             order by h.edition_year desc, h.competition, h.team_name), '[]'::jsonb)
      into v_orgrec
      from app.seduh_team_memberships m
      join app.historical_results h on h.id = m.result_id
     where m.account_id = v_acc_id and h.listed;
  end if;

  -- ============ self-reported entries (20261122100000): never "recorded", always labelled ============
  if v_vis_self = 'public' then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'year', e.year, 'competition_name', e.competition_name, 'location', e.location, 'kind', e.kind,
               'role', e.role, 'result_text', e.result_text, 'placement', e.placement, 'note', e.note,
               'provenance', 'self_reported')
             order by e.year desc, e.created_at desc, e.id desc), '[]'::jsonb)
      into v_self
      from app.seduh_self_reported_entries e
     where e.account_id = v_acc_id;
  end if;

  -- ============ courses (this migration): only while vis_courses = 'public'; no id; `current` is decided here, in SQL ============
  if v_vis_crs = 'public' then
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'title', c.title, 'provider', c.provider, 'completed_year', c.completed_year,
               'valid_until_year', c.valid_until_year, 'level', c.level, 'note', c.note,
               'current', app.seduh_course_current(c.valid_until_year),
               -- the card's certificate: only one, only while current (the page draws the "Certified" line from this flag)
               'on_card', c.on_card and app.seduh_course_current(c.valid_until_year),
               'status', c.status, 'confirmed_by', c.confirmed_by, 'provenance', 'self_reported')
             order by c.completed_year desc, c.created_at desc, c.id desc), '[]'::jsonb)
      into v_courses
      from app.seduh_courses c
     where c.account_id = v_acc_id;
  end if;

  return jsonb_build_object(
    'has_profile', true,
    'handle', v_handle,
    'identity', v_ident,
    'recorded_results', v_results,
    'knockout_record', jsonb_build_object('won', coalesce(v_won, 0), 'lost', coalesce(v_lost, 0), 'opponents', v_opps),
    'organiser_records', v_orgrec,
    'self_reported', v_self,
    'courses', v_courses,
    'judging_roles', '[]'::jsonb,       -- SEAM: needs a judge-to-identity link (BTC judges have no people row)
    'cafe_affiliations', '[]'::jsonb);  -- SEAM: two-sided acceptance is not modelled yet
end;
$$;
