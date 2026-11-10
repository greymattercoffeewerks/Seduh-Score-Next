-- BTC March 2027, Build C: a seeding tie is equal POINTS (wins no longer define or order one), and the preliminary
-- finish times are readable for the tie card. See 20261110100000_btc_seeding_points_only.sql and spec section 5.
--   * equal points with different wins form ONE tie group; wins order nobody in it
--   * a tie across the 8th/9th places blocks generate_btc_bracket until the whole group is ordered
--   * a three-way tie is ordered as a whole; a half-recorded group is ignored
--   * btc_prelim_times carries each team's typed times per preliminary round; a non-member reads zero rows, anon is refused
--   * the migration's own rollback block restores the (points, wins) behaviour (it is run here, inside the transaction)
-- Fixture ids are 077-specific (prefix 0e10 / 0e40) so a parallel reviewer's database work cannot collide.
begin;
select plan(50);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000771', 'member077@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000772', 'outsider077@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000773', 'other-org077@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000781', 'Org 077', 'org-077'),
  ('00000000-0000-0000-0000-000000000782', 'Other Org 077', 'other-org-077');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-000000000771', 'organiser'),
  ('00000000-0000-0000-0000-000000000782', '00000000-0000-0000-0000-000000000773', 'organiser');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000e1077', '00000000-0000-0000-0000-000000000781', 'btc', 'Points-only event'),
  ('00000000-0000-0000-0000-0000000e4077', '00000000-0000-0000-0000-000000000781', 'btc', 'Rollback event');

-- team id: prefix p (4 hex) and an index. Z = 0 sorts FIRST by id, so if wins (or anything but the recorded
-- order) ordered the tie, Z (the fewest wins) would not be where the default id order puts it.
create function pg_temp.tid(p text, i int) returns uuid language sql as $f$
  select ('00000000-0000-0000-' || p || '-' || lpad(i::text, 12, '0'))::uuid
$f$;
create function pg_temp.mid(p text, i int) returns uuid language sql as $f$
  select ('00000000-0000-0000-' || p || '-1' || lpad(i::text, 11, '0'))::uuid
$f$;

-- Teams: F (filler, index 99, loses every match to nobody: it plays everybody and tops the table), Z (0), T1..T8.
--   T1..T6 = 40,38,36,34,32,31 tokens (45,43,41,39,37,36 points: seeds 2..7)
--   T7, T8 = 30 tokens, WIN, 35 points
--   Z      = loses both its matches (22 + 11 tokens + 2 fastest) = 35 points, 0 wins
-- so Z, T7 and T8 are level on 35 points with different wins, across the 8th/9th cut-off (seeds 8, 9, 10).
-- Time notes: Ti 8:0i (round 1), F 9:59; Z round 1 (prelim_round NULL) 9:50, round 2 7:41.
create function pg_temp.mk(p text, ev uuid) returns void language plpgsql as $f$
declare
  i int; m uuid; c int; tok int;
  toks int[] := array[40, 38, 36, 34, 32, 31, 30, 30];
begin
  insert into btc_teams (id, event_id, name) values (pg_temp.tid(p, 99), ev, 'Filler'), (pg_temp.tid(p, 0), ev, 'Z');
  insert into btc_teams (id, event_id, name) select pg_temp.tid(p, g), ev, 'T' || g from generate_series(1, 8) g;
  insert into btc_judges (id, event_id, name)
    select pg_temp.tid(p, 900 + g), ev, 'J' || g from generate_series(1, 3) g;
  for i in 1..8 loop
    tok := toks[i];
    insert into btc_matches (id, event_id, round, team1_id, team2_id, status, team1_time_note, team2_time_note)
    values (pg_temp.mid(p, i), ev, 'preliminary', pg_temp.tid(p, i), pg_temp.tid(p, 99), 'confirmed',
            '8:0' || i, '9:59')
    returning id into m;
    insert into btc_match_judges (match_id, judge_id) select m, pg_temp.tid(p, 900 + j) from generate_series(1, 3) j;
    for c in 1..15 loop
      insert into btc_cup_votes (match_id, cup_number, team1_tokens)
      values (m, c, least(3, greatest(0, tok - 3 * (c - 1))));
    end loop;
    insert into btc_match_bonuses (match_id, fastest_team_id) values (m, null);
  end loop;
  for i in 1..2 loop
    tok := case i when 1 then 22 else 11 end;
    insert into btc_matches (id, event_id, round, team1_id, team2_id, status, prelim_round, team1_time_note, team2_time_note)
    values (pg_temp.mid(p, 50 + i), ev, 'preliminary', pg_temp.tid(p, 0), pg_temp.tid(p, 99), 'confirmed',
            case i when 1 then null else 2 end, case i when 1 then '9:50' else '7:41' end, '9:59')
    returning id into m;
    insert into btc_match_judges (match_id, judge_id) select m, pg_temp.tid(p, 900 + j) from generate_series(1, 3) j;
    for c in 1..15 loop
      insert into btc_cup_votes (match_id, cup_number, team1_tokens)
      values (m, c, least(3, greatest(0, tok - 3 * (c - 1))));
    end loop;
    insert into btc_match_bonuses (match_id, fastest_team_id)
    values (m, case i when 2 then pg_temp.tid(p, 0) else null end);
  end loop;
end $f$;
select pg_temp.mk('0e10', '00000000-0000-0000-0000-0000000e1077');
select pg_temp.mk('0e40', '00000000-0000-0000-0000-0000000e4077');

-- a pending preliminary match (no time yet) in a third event: it must not appear in btc_prelim_times
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000e3077', '00000000-0000-0000-0000-000000000781', 'btc', 'Times event');
insert into btc_teams (id, event_id, name) values
  (pg_temp.tid('0e30', 1), '00000000-0000-0000-0000-0000000e3077', 'P1'),
  (pg_temp.tid('0e30', 2), '00000000-0000-0000-0000-0000000e3077', 'P2');
insert into btc_matches (id, event_id, round, team1_id, team2_id, status)
values (pg_temp.mid('0e30', 1), '00000000-0000-0000-0000-0000000e3077', 'preliminary',
        pg_temp.tid('0e30', 1), pg_temp.tid('0e30', 2), 'pending');
insert into btc_matches (id, event_id, round, team1_id, team2_id, status, prelim_round)
values (pg_temp.mid('0e30', 2), '00000000-0000-0000-0000-0000000e3077', 'preliminary',
        pg_temp.tid('0e30', 1), pg_temp.tid('0e30', 2), 'confirmed', 1);
-- a knockout match never appears either (a bracket slot is not a preliminary round)
insert into btc_matches (id, event_id, round, team1_id, team2_id, status, team1_time_note)
values (pg_temp.mid('0e30', 3), '00000000-0000-0000-0000-0000000e3077', 'quarterfinal',
        pg_temp.tid('0e30', 1), pg_temp.tid('0e30', 2), 'confirmed', '5:55');

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $f$
declare h text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, '(no hint)');
end $f$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000771';

-- ---------- 1. equal points with different wins are a tie, and wins order nobody ----------
select is((select total_points from btc_seeding_order where team_id = pg_temp.tid('0e10', 0)),
          (select total_points from btc_seeding_order where team_id = pg_temp.tid('0e10', 7)),
  'fixture: Z and T7 are level on points');
select isnt((select wins from btc_seeding_order where team_id = pg_temp.tid('0e10', 0)),
            (select wins from btc_seeding_order where team_id = pg_temp.tid('0e10', 7)),
  'fixture: and have different wins');
select is((select tied_count from btc_seeding_order where team_id = pg_temp.tid('0e10', 0)), 3,
  'Z, T7 and T8 form ONE tie group of three (equal points, different wins)');
select is((select tied_count from btc_seeding_order where team_id = pg_temp.tid('0e10', 7)), 3, 'T7 sees the same group');
select is((select array_agg(team_id order by seed) from btc_seeding_order where event_id = '00000000-0000-0000-0000-0000000e1077' and seed between 8 and 10),
  array[pg_temp.tid('0e10', 0), pg_temp.tid('0e10', 7), pg_temp.tid('0e10', 8)],
  'unordered, the group sits at seeds 8 to 10 in team-id order: Z (the fewest wins) is NOT pushed below the others');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.tid('0e10', 0)), false, 'and is not resolved');
select is((select wins from btc_seeding_order where team_id = pg_temp.tid('0e10', 0))::int, 0, 'wins stay in the view, for display');
select is((select count(*)::int from information_schema.columns where table_name = 'btc_seeding_tiebreaks' and column_name = 'wins'), 0,
  'the decision table no longer snapshots wins');
select is((select tied_count from btc_seeding_order where team_id = pg_temp.tid('0e10', 1)), 1, 'a team on its own points is level with nobody');

-- ---------- 2. a tie across the 8th/9th places blocks the bracket until ordered ----------
select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e1077') $$,
  'P0001', 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket',
  'generation refuses while the points tie across the cut-off is unordered (even though the wins differ)');

-- ---------- 3. a three-way tie is ordered as a whole ----------
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e1077',
    array[pg_temp.tid('0e10', 7), pg_temp.tid('0e10', 8)], 'x') $$),
  'seeding_group_incomplete', 'two of the three is refused: name every team that is level on points');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e1077',
    array[pg_temp.tid('0e10', 7), pg_temp.tid('0e10', 1)], 'x') $$),
  'seeding_not_tied', 'teams on different points are not a tie');
select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e1077',
       array[pg_temp.tid('0e10', 8), pg_temp.tid('0e10', 0), pg_temp.tid('0e10', 7)], 'Lowest combined time first') $$,
  'the whole group is ordered: T8, Z, T7');
select is((select array_agg(team_id order by seed) from btc_seeding_order where event_id = '00000000-0000-0000-0000-0000000e1077' and seed between 8 and 10),
  array[pg_temp.tid('0e10', 8), pg_temp.tid('0e10', 0), pg_temp.tid('0e10', 7)], 'the recorded order is the seed order');
select is((select count(*)::int from btc_seeding_tiebreaks where event_id = '00000000-0000-0000-0000-0000000e1077'), 3, 'three rows, one per team');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.tid('0e10', 0)), true, 'the group is resolved');
select is((select reason from btc_seeding_order where team_id = pg_temp.tid('0e10', 7)), 'Lowest combined time first', 'with its reason');

-- a half-recorded group is ignored: with one row gone nobody is ranked and the cut-off blocks again
delete from btc_seeding_tiebreaks where team_id = pg_temp.tid('0e10', 7);
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.tid('0e10', 8)), false, 'one row gone: the group is not resolved');
select is((select tiebreak_rank from btc_seeding_order where team_id = pg_temp.tid('0e10', 8)), null, 'and the remaining ranks show nothing');
select is((select array_agg(team_id order by seed) from btc_seeding_order where event_id = '00000000-0000-0000-0000-0000000e1077' and seed between 8 and 10),
  array[pg_temp.tid('0e10', 0), pg_temp.tid('0e10', 7), pg_temp.tid('0e10', 8)], 'and order nobody: team-id order again');
select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e1077') $$,
  'P0001', 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket',
  'and generation refuses again');

-- ---------- ordering unblocks the bracket ----------
select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e1077',
       array[pg_temp.tid('0e10', 8), pg_temp.tid('0e10', 0), pg_temp.tid('0e10', 7)], 'Lowest combined time first') $$,
  're-ordering the whole group');
select lives_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e1077') $$,
  'the bracket is generated');
select is((select team2_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000e1077'),
  pg_temp.tid('0e10', 8), 'qf1 is seed 1 v seed 8, and seed 8 is the team the organiser put first (T8)');
select is((select team1_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000e1077'),
  pg_temp.tid('0e10', 99), 'and seed 1 is the filler (most points)');

-- ---------- 4. the times for the tie card ----------
select is((select count(*)::int from btc_prelim_times where event_id = '00000000-0000-0000-0000-0000000e1077' and team_id = pg_temp.tid('0e10', 0)), 2,
  'Z has one row per confirmed preliminary match');
select is((select string_agg(prelim_round || '=' || coalesce(time_note, 'none'), ',' order by prelim_round)
             from btc_prelim_times where event_id = '00000000-0000-0000-0000-0000000e1077' and team_id = pg_temp.tid('0e10', 0)),
  '1=9:50,2=7:41', 'its round 1 (an unnumbered match reads as round 1) and round 2 times, as typed');
select is((select string_agg(prelim_round || '=' || time_note, ',') from btc_prelim_times
            where event_id = '00000000-0000-0000-0000-0000000e1077' and team_id = pg_temp.tid('0e10', 7)),
  '1=8:07', 'T7 has its round 1 time, from the side it played on (team 1)');
select is((select string_agg(time_note, ',') from btc_prelim_times
            where event_id = '00000000-0000-0000-0000-0000000e1077' and team_id = pg_temp.tid('0e10', 99) and prelim_round = 2),
  '9:59', 'the filler, always team 2, gets its time from the team 2 side');
select is((select count(*)::int from btc_prelim_times where event_id = '00000000-0000-0000-0000-0000000e3077'), 2,
  'a pending match and a knockout match give no rows: only the confirmed preliminary one (two sides)');
select is((select count(*)::int from btc_prelim_times where event_id = '00000000-0000-0000-0000-0000000e3077' and time_note is null), 2,
  'a confirmed match with no typed time is a row with a null time (the card says "no time")');

-- ---------- who may read it ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000772';
select is((select count(*)::int from btc_prelim_times), 0, 'an outsider reads zero rows of btc_prelim_times');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000773';
select is((select count(*)::int from btc_prelim_times), 0, 'a member of another organisation reads zero rows');
select is((select count(*)::int from btc_prelim_times where event_id = '00000000-0000-0000-0000-0000000e1077'), 0,
  'even when they name the event');
set local role anon;
select throws_ok($$ select count(*) from btc_prelim_times $$, '42501', null, 'anon cannot read btc_prelim_times');
reset role;
select is(has_table_privilege('anon', 'btc_prelim_times', 'select'), false, 'anon has no select privilege on the view');
select is(has_table_privilege('authenticated', 'btc_prelim_times', 'select'), true, 'authenticated has select');
select is(has_table_privilege('authenticated', 'btc_prelim_times', 'insert'), false, 'and nothing else: the view is read-only');
select is((select reloptions::text from pg_class where relname = 'btc_prelim_times'), '{security_invoker=true}',
  'the view is security_invoker, so the caller''s own row-level security applies');
select is((select count(*)::int from btc_prelim_times where event_id = '00000000-0000-0000-0000-0000000e1077'), 20,
  'as the owner, all ten confirmed matches show two sides each (the owner is exempt from row-level security)');

-- ---------- 5. the rollback restores the (points, wins) behaviour ----------
-- The migration's rollback block, uncommented. (The fixture event 0e40 has no decisions and no bracket.)
drop view if exists btc_prelim_times;
drop view if exists btc_seeding_order;
delete from btc_seeding_tiebreaks;   -- decisions made on points alone cannot be read as (points, wins) ones
alter table btc_seeding_tiebreaks drop constraint if exists btc_seeding_tiebreaks_event_points_rank_key;
alter table btc_seeding_tiebreaks add column wins int not null;
alter table btc_seeding_tiebreaks add unique (event_id, total_points, wins, tiebreak_rank);
grant insert (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
  on btc_seeding_tiebreaks to authenticated;

create view btc_seeding_order
  with (security_invoker = true) as
with counted as (
  select
    s.event_id,
    s.team_id,
    s.played,
    s.wins,
    s.total_points,
    count(*) over (partition by s.event_id, s.total_points, s.wins) as tied_count
  from btc_standings s
),
joined as (
  select
    c.*,
    t.tiebreak_rank,
    t.reason,
    count(t.tiebreak_rank) over (partition by c.event_id, c.total_points, c.wins) as ranked_count
  from counted c
  left join btc_seeding_tiebreaks t
    on t.event_id = c.event_id
   and t.team_id = c.team_id
   and t.total_points = c.total_points
   and t.wins = c.wins
   and t.group_size = c.tied_count
),
resolved as (
  select
    j.*,
    (j.tied_count = 1 or j.ranked_count = j.tied_count) as group_resolved
  from joined j
)
select
  event_id,
  team_id,
  played,
  wins,
  total_points,
  tied_count::int as tied_count,
  -- a rank and its reason exist only as part of a COMPLETE decision for this exact group
  case when group_resolved then tiebreak_rank end as tiebreak_rank,
  case when group_resolved then reason end as reason,
  group_resolved,
  (row_number() over (
    partition by event_id
    order by total_points desc, wins desc,
             case when group_resolved then tiebreak_rank end asc nulls last, team_id
  ))::int as seed
from resolved;

revoke all on btc_seeding_order from anon, authenticated;
grant select on btc_seeding_order to authenticated;
CREATE OR REPLACE FUNCTION public.record_btc_seeding_tiebreak(p_org_id uuid, p_event_id uuid, p_team_ids uuid[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_points int;
  v_max_points int;
  v_wins int;
  v_max_wins int;
  v_found int;
  v_group_size int;
begin
  -- Same not-found shape as generate_btc_bracket, plus an explicit membership test: org_id_for_event answers for
  -- any caller, so without it a non-member would learn "that event is in this org" from the next refusal.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'record_btc_seeding_tiebreak: event not found' using hint = 'seeding_event_not_found';
  end if;

  -- Serialises with generate_btc_bracket (same key) and with a second recording for the same event.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'record_btc_seeding_tiebreak: the bracket already exists, so the seeds are fixed'
      using hint = 'seeding_bracket_exists';
  end if;

  if exists (
    select 1 from public.btc_matches
    where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
  ) then
    raise exception 'record_btc_seeding_tiebreak: every preliminary match must be confirmed first'
      using hint = 'seeding_preliminary_open';
  end if;

  if p_team_ids is null
     or coalesce(array_length(p_team_ids, 1), 0) < 2
     or exists (select 1 from unnest(p_team_ids) as x where x is null)
     or (select count(distinct x) from unnest(p_team_ids) as x) <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: name at least two different teams'
      using hint = 'seeding_group_invalid';
  end if;

  -- Every named team must have a standing in this event; the numbers they share are the tie being broken.
  select count(*), min(total_points), max(total_points), min(wins), max(wins)
    into v_found, v_points, v_max_points, v_wins, v_max_wins
  from public.btc_seeding_order
  where event_id = p_event_id and team_id = any (p_team_ids);
  if v_found <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: a named team has no standing in this event'
      using hint = 'seeding_group_invalid';
  end if;
  if v_points <> v_max_points or v_wins <> v_max_wins then
    raise exception 'record_btc_seeding_tiebreak: those teams are not level on points and wins'
      using hint = 'seeding_not_tied';
  end if;

  -- The group must be COMPLETE: every team level with them is named, none left to an arbitrary tail.
  select count(*)::int into v_group_size
  from public.btc_seeding_order
  where event_id = p_event_id and total_points = v_points and wins = v_wins;
  if v_group_size <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: name every team that is level, not some of them'
      using hint = 'seeding_group_incomplete';
  end if;

  if v_reason is null then
    raise exception 'record_btc_seeding_tiebreak: a reason is required' using hint = 'seeding_reason_required';
  end if;
  if char_length(v_reason) > 120 then
    raise exception 'record_btc_seeding_tiebreak: the reason is too long (120 characters at most)'
      using hint = 'seeding_reason_too_long';
  end if;

  -- Replace any earlier decision for these teams, and any earlier decision for this very tie.
  delete from public.btc_seeding_tiebreaks
  where event_id = p_event_id
    and (team_id = any (p_team_ids) or (total_points = v_points and wins = v_wins));

  insert into public.btc_seeding_tiebreaks
    (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
  select p_event_id, t.team_id, v_points, v_wins, array_length(p_team_ids, 1)::smallint, t.ord::smallint, v_reason
  from unnest(p_team_ids) with ordinality as t(team_id, ord);
end;
$function$;
CREATE OR REPLACE FUNCTION public.generate_btc_bracket(p_org_id uuid, p_event_id uuid)
 RETURNS SETOF btc_bracket_slots
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_seed uuid[8];
  v_qf uuid[4];
  v_sf uuid[2];
begin
  -- The explicit membership test (new here, as in record_btc_seeding_tiebreak): org_id_for_event answers for any
  -- caller, so without it a non-member could confirm that an event belongs to an org from the next refusal, and
  -- would queue on the advisory lock below before anything stopped them.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'generate_btc_bracket: event not found';
  end if;

  -- Serializes two near-simultaneous calls for the same event (e.g. a double-click on
  -- "Generate bracket"): without this, both could pass the "already exists" check below
  -- before either inserts: the unique (event_id, slot_label) constraint would still stop
  -- the second insert, but as a raw constraint violation rather than the friendly error
  -- this function means to give. Released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'generate_btc_bracket: a bracket already exists for this event';
  end if;

  if exists (
    select 1 from public.btc_matches
    where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
  ) then
    raise exception 'generate_btc_bracket: every preliminary match must be confirmed first';
  end if;

  if (select count(*) from public.btc_standings where event_id = p_event_id) < 8 then
    raise exception 'generate_btc_bracket: at least 8 teams with a confirmed preliminary result are required';
  end if;

  -- A tie across the 8th/9th boundary that nobody has ordered is a real "who actually qualified" question
  -- this function refuses to guess at. The organiser orders the tied teams (record_btc_seeding_tiebreak)
  -- and retries.
  if exists (
    select 1
    from public.btc_seeding_order r8
    join public.btc_seeding_order r9 on r9.event_id = r8.event_id and r9.seed = r8.seed + 1
    where r8.event_id = p_event_id
      and r8.seed = 8
      and r8.total_points = r9.total_points
      and r8.wins = r9.wins
      and not r8.group_resolved
  ) then
    raise exception 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket';
  end if;

  -- The seed order is btc_seeding_order's. team_id is its final, arbitrary-but-deterministic tiebreak: reached only
  -- for teams level on points and wins that nobody has ordered and that are NOT across the 8th/9th boundary (which
  -- the check above refused), so they still get a stable seed order rather than an undefined one.
  select array_agg(team_id order by seed) into v_seed
  from public.btc_seeding_order
  where event_id = p_event_id and seed <= 8;

  insert into public.btc_bracket_slots (event_id, round, slot_label, seed_1, seed_2, team1_id, team2_id)
  values
    (p_event_id, 'quarterfinal', 'qf1', 1, 8, v_seed[1], v_seed[8]),
    (p_event_id, 'quarterfinal', 'qf2', 4, 5, v_seed[4], v_seed[5]),
    (p_event_id, 'quarterfinal', 'qf3', 3, 6, v_seed[3], v_seed[6]),
    (p_event_id, 'quarterfinal', 'qf4', 2, 7, v_seed[2], v_seed[7]);

  -- RETURNING INTO can't target a scalar/array across a multi-row INSERT (plpgsql
  -- raises "query returned more than one row"), so the 4 new ids are re-selected here.
  select array_agg(id order by slot_label) into v_qf
  from public.btc_bracket_slots
  where event_id = p_event_id and slot_label in ('qf1', 'qf2', 'qf3', 'qf4');

  insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
  values
    (p_event_id, 'semifinal', 'sf1', v_qf[1], v_qf[2]), -- qf1, qf2
    (p_event_id, 'semifinal', 'sf2', v_qf[3], v_qf[4]); -- qf3, qf4

  select array_agg(id order by slot_label) into v_sf
  from public.btc_bracket_slots
  where event_id = p_event_id and slot_label in ('sf1', 'sf2');

  insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
  values
    (p_event_id, 'final', 'final', v_sf[1], v_sf[2]),
    (p_event_id, 'third_place', 'third_place', v_sf[1], v_sf[2]);

  return query select * from public.btc_bracket_slots where event_id = p_event_id;
end;
$function$;


select is((select count(*)::int from information_schema.columns where table_name = 'btc_seeding_tiebreaks' and column_name = 'wins'), 1,
  'rollback: the snapshot has wins again');
select is((select count(*)::int from pg_class where relname = 'btc_prelim_times'), 0, 'rollback: btc_prelim_times is gone');
select ok((select prosrc ~ 'r8\.wins = r9\.wins' from pg_proc where proname = 'generate_btc_bracket'),
  'rollback: the cut-off check compares wins again');
select ok((select prosrc ~ 'v_wins' from pg_proc where proname = 'record_btc_seeding_tiebreak'),
  'rollback: the recording RPC is the (points, wins) one');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000771';
select is((select tied_count from btc_seeding_order where team_id = pg_temp.tid('0e40', 0)), 1,
  'rollback: Z (35 points, 0 wins) is level with nobody again');
select is((select tied_count from btc_seeding_order where team_id = pg_temp.tid('0e40', 7)), 2,
  'rollback: T7 is level only with T8 (35 points, 1 win)');
select is((select seed from btc_seeding_order where team_id = pg_temp.tid('0e40', 0)), 10,
  'rollback: wins order the standings again, Z is seed 10');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e4077',
    array[pg_temp.tid('0e40', 7), pg_temp.tid('0e40', 0)], 'x') $$),
  'seeding_not_tied', 'rollback: level on points but not on wins is not a tie');
select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000781', '00000000-0000-0000-0000-0000000e4077',
       array[pg_temp.tid('0e40', 8), pg_temp.tid('0e40', 7)], 'x') $$,
  'rollback: the (points, wins) pair can be recorded');
select is((select wins from btc_seeding_tiebreaks where team_id = pg_temp.tid('0e40', 7))::int, 1, 'rollback: with its wins snapshot');

select * from finish();
rollback;
