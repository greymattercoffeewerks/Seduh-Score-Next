-- T-BTC seeding tie rule: record_btc_seeding_tiebreak, btc_seeding_order and the replaced
-- generate_btc_bracket. See 20261010100000_btc_seeding_tiebreak.sql for the reasoning.
begin;
select plan(108);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'other-org@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000006', 'organiser');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'btc', 'Seeding Event'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000020', 'btc', 'Other Event');

-- Teams: a filler F (plays every match, so it tops the table) and T1..T11. Each Ti plays F once; Ti's tokens
-- decide its points (tokens + 5 for the win; every Ti has more than F's remainder, so every Ti wins once):
--   T1, T2 = 40 (45 points)   level at the top, not across the cut-off
--   T3 = 38, T4 = 36, T5 = 34, T6 = 32
--   T7, T8 = 30 (35 points)   level ACROSS the 8th/9th cut-off (F is seed 1, T1/T2 seeds 2/3 ... T7/T8 seeds 8/9)
--   T9, T10, T11 = 26 (31)    a THREE-way tie
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-0000000000e1', 'Filler');
insert into btc_teams (id, event_id, name)
select ('00000000-0000-0000-0000-00000000a' || lpad(i::text, 3, '0'))::uuid,
       '00000000-0000-0000-0000-0000000000e1', 'T' || i
from generate_series(1, 11) i;
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-0000000000e2', 'Elsewhere');
insert into btc_judges (id, event_id, name) select
  ('00000000-0000-0000-0000-0000000000c' || i)::uuid, '00000000-0000-0000-0000-0000000000e1', 'J' || i
from generate_series(1, 3) i;

do $$
declare
  i int; m uuid; c int; tok int;
  toks int[] := array[40, 40, 38, 36, 34, 32, 30, 30, 26, 26, 26];
begin
  for i in 1..11 loop
    tok := toks[i];
    insert into btc_matches (id, event_id, round, team1_id, team2_id, status)
    values (('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid,
            '00000000-0000-0000-0000-0000000000e1', 'preliminary',
            ('00000000-0000-0000-0000-00000000a' || lpad(i::text, 3, '0'))::uuid,
            '00000000-0000-0000-0000-00000000aaaa', 'confirmed')
    returning id into m;
    insert into btc_match_judges (match_id, judge_id)
      select m, ('00000000-0000-0000-0000-0000000000c' || j)::uuid from generate_series(1, 3) j;
    for c in 1..15 loop
      insert into btc_cup_votes (match_id, cup_number, team1_tokens)
      values (m, c, least(3, greatest(0, tok - 3 * (c - 1))));
    end loop;
    insert into btc_match_bonuses (match_id, fastest_team_id) values (m, null);
  end loop;
end $$;

-- Z: 35 points like T7/T8 but 0 wins (it lost both of its matches): level on points, NOT on wins.
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000e1', 'Z');
do $$
declare m uuid; c int; i int; tok int;
begin
  for i in 1..2 loop
    tok := case i when 1 then 22 else 11 end;
    insert into btc_matches (id, event_id, round, team1_id, team2_id, status)
    values (('00000000-0000-0000-0000-00000000020' || i)::uuid, '00000000-0000-0000-0000-0000000000e1', 'preliminary',
            '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aaaa', 'confirmed')
    returning id into m;
    insert into btc_match_judges (match_id, judge_id)
      select m, ('00000000-0000-0000-0000-0000000000c' || j)::uuid from generate_series(1, 3) j;
    for c in 1..15 loop
      insert into btc_cup_votes (match_id, cup_number, team1_tokens)
      values (m, c, least(3, greatest(0, tok - 3 * (c - 1))));
    end loop;
    insert into btc_match_bonuses (match_id, fastest_team_id)
    values (m, case i when 2 then '00000000-0000-0000-0000-00000000aa01'::uuid else null end);
  end loop;
end $$;

-- the client keys on the `hint` of a refusal, not its wording: read it from a caught error
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $f$
declare h text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, '(no hint)');
end $f$;

-- rows a statement changed (a data-modifying CTE cannot sit inside a select)
create function pg_temp.affected(p_sql text) returns int language plpgsql as $f$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $f$;

create function pg_temp.t(i int) returns uuid language sql as $f$
  select ('00000000-0000-0000-0000-00000000a' || lpad(i::text, 3, '0'))::uuid
$f$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- the view ----------
select is((select seed from btc_seeding_order where team_id = '00000000-0000-0000-0000-00000000aaaa'), 1,
  'the filler (most points) is seed 1');
select is((select seed from btc_seeding_order where team_id = pg_temp.t(1)), 2, 'T1 is seed 2 (level with T2: the default tail is team id, ascending)');
select is((select seed from btc_seeding_order where team_id = pg_temp.t(2)), 3, 'T2 is seed 3');
select is((select tied_count from btc_seeding_order where team_id = '00000000-0000-0000-0000-00000000aa01'), 1,
  'Z has the same points as T7 and T8 but fewer wins: level with nobody');
select is((select seed from btc_seeding_order where team_id = '00000000-0000-0000-0000-00000000aa01'), 10,
  'and is seeded below them (wins break the tie in the standings)');
select is((select tied_count from btc_seeding_order where team_id = pg_temp.t(7)), 2,
  'T7 shares its numbers with one other team');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(7)), false,
  'an unordered tie is not resolved');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(3)), true,
  'a team level with nobody needs no ordering');
select is((select tied_count from btc_seeding_order where team_id = pg_temp.t(9)), 3,
  'T9 is in a group of three');

-- ---------- generation is still blocked by an unordered tie across the cut-off ----------
select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket',
  'generation refuses while the 8th/9th tie is unordered');

-- ---------- refusals ----------
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], 'x') $$),
  'seeding_event_not_found', 'a wrong org is "not found"');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7)], 'x') $$),
  'seeding_group_invalid', 'one team is not a tie');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', null, 'x') $$),
  'seeding_group_invalid', 'no teams is not a tie');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(7)], 'x') $$),
  'seeding_group_invalid', 'the same team twice is refused');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), null], 'x') $$),
  'seeding_group_invalid', 'a null team is refused');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), '00000000-0000-0000-0000-00000000bbbb'], 'x') $$),
  'seeding_group_invalid', 'a team of another event is refused');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(1), pg_temp.t(3)], 'x') $$),
  'seeding_not_tied', 'teams that are not level are refused');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), '00000000-0000-0000-0000-00000000aa01'::uuid], 'x') $$),
  'seeding_not_tied', 'level on points but not on wins is not a tie');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', '{}'::uuid[], 'x') $$),
  'seeding_group_invalid', 'an empty list is not a tie');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(9), pg_temp.t(10)], 'x') $$),
  'seeding_group_incomplete', 'two of a three-way tie is refused: every level team must be named');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], '   ') $$),
  'seeding_reason_required', 'a blank reason is refused');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], E' \t\n ') $$),
  'seeding_reason_required', 'a reason of tabs and newlines only is refused');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], repeat('x', 121)) $$),
  'seeding_reason_too_long', 'a reason over 120 characters is refused');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, repeat('x', 121)) $$,
  '23514', null, 'the table itself refuses a reason over 120 characters');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, 'x' || repeat(' ', 200)) $$,
  '23514', null, 'padding does not get a long reason past the limit (the raw value is bounded too)');
-- a preliminary match that is not confirmed yet: results can still move, so no tie can be ordered
insert into btc_matches (id, event_id, round, team1_id, team2_id, status)
values ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
        pg_temp.t(1), pg_temp.t(2), 'pending');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], 'x') $$),
  'seeding_preliminary_open', 'ties cannot be ordered while a preliminary match is unconfirmed');
delete from btc_matches where id = '00000000-0000-0000-0000-000000000301';

-- ---------- recording ----------
select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(8), pg_temp.t(7)], '  Won the cup-off  ') $$,
  'the organiser orders the tie across the cut-off: T8 above T7');
select is((select array_agg(team_id order by seed) filter (where seed in (8, 9)) from btc_seeding_order),
  array[pg_temp.t(8), pg_temp.t(7)], 'T8 is now seed 8 and T7 seed 9');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(7)), true, 'the group is resolved');
select is((select reason from btc_seeding_order where team_id = pg_temp.t(8)), 'Won the cup-off',
  'the reason is stored trimmed');
select is((select tiebreak_rank from btc_seeding_order where team_id = pg_temp.t(8)), 1::smallint, 'the first named is rank 1');
select is((select count(*)::int from btc_seeding_tiebreaks), 2, 'two rows, one per team');
select isnt((select recorded_by from btc_seeding_tiebreaks limit 1), null, 'who recorded it is kept');

select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], repeat('y', 120)) $$,
  'recording again replaces the earlier decision (and exactly 120 characters is accepted)');
select is((select length(reason) from btc_seeding_order where team_id = pg_temp.t(7)), 120, 'the whole reason is kept');
select is((select array_agg(team_id order by seed) filter (where seed in (8, 9)) from btc_seeding_order),
  array[pg_temp.t(7), pg_temp.t(8)], 'T7 is now seed 8 and T8 seed 9');
select is((select count(*)::int from btc_seeding_tiebreaks), 2, 'still two rows after a replace');

-- ---------- a decision about one tie never orders a different one ----------
-- Move T7's result so it is no longer level with T8 (an extra cup for T7: 33 tokens, not 30): the old decision
-- must go inert, not order anything.
update btc_cup_votes set team1_tokens = 3
where match_id = '00000000-0000-0000-0000-000000000107' and cup_number = 11;
select is((select tied_count from btc_seeding_order where team_id = pg_temp.t(7)), 1,
  'fixture: T7 is no longer level with T8 once its result moves');
select is((select tiebreak_rank from btc_seeding_order where team_id = pg_temp.t(7)), null,
  'its old decision no longer applies (the numbers are not the ones that were tied)');
-- and put it back exactly as it was
update btc_cup_votes set team1_tokens = 0
where match_id = '00000000-0000-0000-0000-000000000107' and cup_number = 11;
select is((select tied_count from btc_seeding_order where team_id = pg_temp.t(7)), 2,
  'fixture restored: T7 and T8 are level again');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(7)), true,
  'and the recorded decision applies again, because it is about exactly those numbers');

-- ---------- a partly ordered group is unresolved and its remaining rank orders nothing ----------
select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(8), pg_temp.t(7)], 'T8 first') $$,
  'fixture: T8 is ordered above T7');
delete from btc_seeding_tiebreaks where team_id = pg_temp.t(7);
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(8)), false,
  'with one of its two rows gone the group is not resolved');
select is((select tiebreak_rank from btc_seeding_order where team_id = pg_temp.t(8)), null, 'and T8''s remaining rank is not shown');
select ok((select seed from btc_seeding_order where team_id = pg_temp.t(7)) < (select seed from btc_seeding_order where team_id = pg_temp.t(8)),
  'nor does it put T8 ahead of T7: the default order (team id) applies');
select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket',
  'and generation refuses again (the cut-off tie is unresolved)');
select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], repeat('y', 120)) $$,
  'fixture restored: T7 above T8 again');

-- ---------- a decision about one set of numbers never orders a tie at other numbers ----------
-- T7 and T8 (decided above) both move to 38 points together: still a pair of the same size, but NOT the
-- numbers the decision was about.
update btc_cup_votes set team1_tokens = 3
where match_id in ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000108') and cup_number = 11;
select is((select tied_count from btc_seeding_order where team_id = pg_temp.t(7)), 2, 'fixture: T7 and T8 are still a pair, at 38 points');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(7)), false,
  'the decision about the pair at 35 points does not settle the pair at 38');
select is((select tiebreak_rank from btc_seeding_order where team_id = pg_temp.t(7)), null,
  'and gives neither of them a rank');
update btc_cup_votes set team1_tokens = 0
where match_id in ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000108') and cup_number = 11;

-- ---------- a partial decision orders nothing ----------
-- T7 moves away and T6 comes down to T8's numbers (35 points, 1 win): the pair is now T6 and T8. T8 still has
-- a row that matches (same numbers, same size), T6 has none: the group is not resolved, so T8's old rank must
-- not put it ahead of T6.
update btc_cup_votes set team1_tokens = 3
where match_id = '00000000-0000-0000-0000-000000000107' and cup_number = 11;
update btc_cup_votes set team1_tokens = 0
where match_id = '00000000-0000-0000-0000-000000000106' and cup_number = 11;
select is((select tied_count from btc_seeding_order where team_id = pg_temp.t(8)), 2, 'fixture: T6 and T8 are now level');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(8)), false,
  'a half-matching decision does not resolve the group');
select is((select tiebreak_rank from btc_seeding_order where team_id = pg_temp.t(8)), null,
  'T8''s old rank is not shown');
select ok((select seed from btc_seeding_order where team_id = pg_temp.t(6)) < (select seed from btc_seeding_order where team_id = pg_temp.t(8)),
  'so the unordered pair keeps the default order (T6 before T8), not the stale rank');
-- put both back exactly as they were
update btc_cup_votes set team1_tokens = 0
where match_id = '00000000-0000-0000-0000-000000000107' and cup_number = 11;
update btc_cup_votes set team1_tokens = 2
where match_id = '00000000-0000-0000-0000-000000000106' and cup_number = 11;
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(7)), true, 'fixture restored: T7 and T8 are decided again');

-- ---------- a decision about a bigger group never settles a smaller one ----------
select lives_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(10), pg_temp.t(9), pg_temp.t(11)], 'Three-way cup-off') $$,
  'the three-way tie T9, T10, T11 is ordered');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(9)), true, 'the three-way group is resolved');
-- T11's result moves, so T9 and T10 are now a TWO-team tie: the three-team decision must not settle it
update btc_cup_votes set team1_tokens = 3
where match_id = '00000000-0000-0000-0000-000000000111' and cup_number = 11;
select is((select tied_count from btc_seeding_order where team_id = pg_temp.t(9)), 2, 'fixture: T9 and T10 are now a pair');
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(9)), false,
  'the decision about three teams does not settle the pair');
select is((select tiebreak_rank from btc_seeding_order where team_id = pg_temp.t(9)), null,
  'and gives neither of them a rank');
update btc_cup_votes set team1_tokens = 0
where match_id = '00000000-0000-0000-0000-000000000111' and cup_number = 11;
select is((select group_resolved from btc_seeding_order where team_id = pg_temp.t(9)), true,
  'fixture restored: the three-way decision applies again to exactly that group');
-- put the three-way tie back as nobody has ordered it (members may delete a decision)
delete from btc_seeding_tiebreaks where team_id in (pg_temp.t(9), pg_temp.t(10), pg_temp.t(11));
select is((select count(*)::int from btc_seeding_tiebreaks), 2, 'only the T7/T8 decision is left');

-- ---------- storage guards ----------
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000bbbb', 1, 1, 2, 1, 'x') $$,
  '23503', null, 'a team of another event cannot be given a decision (composite foreign key)');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 0, 'x') $$,
  '23514', null, 'a rank of zero is refused');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, '  ') $$,
  '23514', null, 'a blank reason is refused');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(1), 35, 1, 2, 1, 'x') $$,
  '23505', null, 'two teams cannot hold the same rank in one tie');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 3, 'x') $$,
  '23514', null, 'a rank beyond the size of the group is refused');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 1, 1, 'x') $$,
  '23514', null, 'a group of one is not a tie (group_size at least 2)');
-- the audit fields are the database's own: a member cannot supply or rewrite them
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason, recorded_by)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, 'x', '00000000-0000-0000-0000-000000000006') $$,
  '42501', null, 'recorded_by cannot be supplied on a direct insert');
select throws_ok(
  $$ update btc_seeding_tiebreaks set recorded_by = null $$,
  '42501', null, 'recorded_by cannot be rewritten');
select throws_ok(
  $$ update btc_seeding_tiebreaks set recorded_at = '2020-01-01' $$,
  '42501', null, 'recorded_at cannot be rewritten');
select throws_ok(
  $$ update btc_seeding_tiebreaks set group_size = 9 $$,
  '42501', null, 'the snapshot (group_size) cannot be rewritten directly either');
select throws_ok($$ update btc_seeding_tiebreaks set team_id = pg_temp.t(3) $$, '42501', null, 'a decision cannot be moved to another team');
select throws_ok($$ update btc_seeding_tiebreaks set event_id = '00000000-0000-0000-0000-0000000000e2' $$, '42501', null, 'nor to another event');
select throws_ok($$ update btc_seeding_tiebreaks set total_points = 1 $$, '42501', null, 'the snapshot points cannot be rewritten');
select throws_ok($$ update btc_seeding_tiebreaks set wins = 1 $$, '42501', null, 'the snapshot wins cannot be rewritten');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason, recorded_at)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, 'x', '2020-01-01') $$,
  '42501', null, 'recorded_at cannot be supplied on a direct insert');

-- ---------- a tie nobody ordered elsewhere never blocks generation ----------
select lives_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'generation proceeds: the cut-off tie is ordered (the T1/T2 and T9/T10/T11 ties are not, and do not block)');
select is((select team2_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  pg_temp.t(7), 'qf1 is seed 1 v seed 8, and seed 8 is the team the latest decision put there (T7)');
select is((select seed_1 || '/' || seed_2 from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  '1/8', 'the slot says seeds 1 and 8');

-- ---------- once the bracket exists the seeds are fixed, for direct writes too ----------
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, 'x') $$,
  '42501', null, 'a member cannot insert a decision once the bracket exists (row-level security)');
select is(pg_temp.affected($$ update btc_seeding_tiebreaks set reason = 'changed' $$), 0,
  'a member updates no decision once the bracket exists');
select is(pg_temp.affected($$ delete from btc_seeding_tiebreaks $$), 0,
  'a member deletes no decision once the bracket exists');
select is((select count(*)::int from btc_seeding_tiebreaks), 2, 'both decisions are still there');
select is((select array_agg(seed order by seed) from btc_seeding_order where team_id in (pg_temp.t(7), pg_temp.t(8))),
  array[8, 9], 'and the view still agrees with the slots');

-- ---------- once the bracket exists the seeds are fixed ----------
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(1), pg_temp.t(2)], 'x') $$),
  'seeding_bracket_exists', 'a decision cannot be recorded after the bracket exists');

-- ---------- who may see and write it ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is((select count(*)::int from btc_seeding_tiebreaks), 0, 'an outsider reads zero decisions');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, 'x') $$,
  '42501', null, 'an outsider cannot write a decision directly (row-level security)');
select is(pg_temp.affected($$ update btc_seeding_tiebreaks set reason = 'changed' $$), 0,
  'an outsider updates no decision');
select is(pg_temp.affected($$ delete from btc_seeding_tiebreaks $$), 0,
  'an outsider deletes no decision');
select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: event not found', 'an outsider cannot run generate_btc_bracket (not found, before any lock)');
select is((select count(*)::int from btc_seeding_order), 0, 'an outsider reads zero rows of the view');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], 'x') $$),
  'seeding_event_not_found', 'an outsider cannot record: not found');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is((select count(*)::int from btc_seeding_tiebreaks), 0, 'a member of another org reads zero decisions');
select is((select count(*)::int from btc_seeding_order), 0, 'a member of another org reads zero rows of the view');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], 'x') $$),
  'seeding_event_not_found', 'a member of another org cannot record: not found');
select is(pg_temp.hint_of($$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], 'x') $$),
  'seeding_event_not_found', 'a member naming their OWN org with another org''s event is refused (the org/event pairing is checked on its own)');
select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: event not found', 'nor generate with their own org id for this event');
select throws_ok(
  $$ insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
     values ('00000000-0000-0000-0000-0000000000e1', pg_temp.t(3), 43, 1, 2, 1, 'x') $$,
  '42501', null, 'a member of another org cannot write a decision directly (row-level security)');

-- anon really is refused (not just "has no privilege on paper")
set local role anon;
select throws_ok($$ select count(*) from btc_seeding_tiebreaks $$, '42501', null, 'anon cannot read the table');
select throws_ok($$ select count(*) from btc_seeding_order $$, '42501', null, 'anon cannot read the view');
select throws_ok(
  $$ select record_btc_seeding_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', array[pg_temp.t(7), pg_temp.t(8)], 'x') $$,
  '42501', null, 'anon cannot run the recording RPC');
reset role;
select ok((select prosrc ~ 'pg_advisory_xact_lock\(hashtext\(p_event_id::text\)\)' from pg_proc where proname = 'record_btc_seeding_tiebreak'),
  'recording takes the per-event lock');
select ok((select prosrc ~ 'pg_advisory_xact_lock\(hashtext\(p_event_id::text\)\)' from pg_proc where proname = 'generate_btc_bracket'),
  'generating takes the same per-event lock, so the two cannot interleave');
select is(has_function_privilege('anon', 'record_btc_seeding_tiebreak(uuid, uuid, uuid[], text)', 'execute'), false,
  'anon has no execute privilege on the recording RPC');
select is(has_table_privilege('anon', 'btc_seeding_order', 'select'), false, 'anon has no select privilege on the view');
select is(has_column_privilege('authenticated', 'btc_seeding_tiebreaks', 'recorded_by', 'insert'), false,
  'members have no insert privilege on recorded_by');
select is(has_column_privilege('authenticated', 'btc_seeding_tiebreaks', 'tiebreak_rank', 'update'), true,
  'members may update a rank');

select * from finish();
rollback;
