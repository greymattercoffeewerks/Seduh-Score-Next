-- T-BTC.2 sub-step 5: generate_btc_bracket, create_btc_bracket_match, and
-- confirm_btc_match's bracket-advancement addition. One file: the three RPCs are one
-- integrated flow (generate the tree, create a match from a filled slot, confirm it
-- and watch the next slot fill), not three independent concerns.
begin;
select plan(39);

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
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'btc', 'Bracket Event');

insert into btc_teams (id, event_id, name) select
  ('00000000-0000-0000-0000-0000000000b' || i)::uuid, '00000000-0000-0000-0000-0000000000e1', 'Team ' || i
from generate_series(1, 8) i;
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000bf', '00000000-0000-0000-0000-0000000000e1', 'Filler');
insert into btc_judges (id, event_id, name) select
  ('00000000-0000-0000-0000-0000000000c' || i)::uuid, '00000000-0000-0000-0000-0000000000e1', 'J' || i
from generate_series(1, 3) i;

-- One confirmed preliminary match per team (b1..b8) against a shared filler, tokens
-- giving each team a strictly decreasing total (b1 highest, b8 lowest) — the filler's
-- own cumulative total across all 8 matches lands ABOVE b1's, becoming seed 1 itself;
-- b8 (the lowest of the 9) is then the one team excluded from the top-8 cut, which is
-- exactly what this fixture is for: proving the RPC seeds by points, not by which team
-- "looks real".
do $$
declare
  i int; m uuid; c int; tok int;
begin
  for i in 1..8 loop
    insert into btc_matches (id, event_id, round, team1_id, team2_id, status)
    values (('00000000-0000-0000-0000-0000000000d' || i)::uuid, '00000000-0000-0000-0000-0000000000e1',
             'preliminary', ('00000000-0000-0000-0000-0000000000b' || i)::uuid,
             '00000000-0000-0000-0000-0000000000bf', 'confirmed')
    returning id into m;
    insert into btc_match_judges (match_id, judge_id)
      select m, ('00000000-0000-0000-0000-0000000000c' || j)::uuid from generate_series(1, 3) j;
    for c in 1..15 loop
      tok := case when c <= (16 - i) then 3 else 0 end;
      insert into btc_cup_votes (match_id, cup_number, team1_tokens) values (m, c, tok);
    end loop;
    insert into btc_match_bonuses (match_id, fastest_team_id) values (m, ('00000000-0000-0000-0000-0000000000b' || i)::uuid);
  end loop;
end $$;

-- A second, tiny event used only for the "fewer than 8 teams" rejection below.
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'btc', 'Small Event');
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000ba', '00000000-0000-0000-0000-0000000000e2', 'A'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000e2', 'B');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- generate_btc_bracket: rejections ----------

select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $$,
  'P0001', 'generate_btc_bracket: at least 8 teams with a confirmed preliminary result are required',
  'fewer than 8 teams with standings is rejected'
);

select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: event not found',
  'a forged org id is reported as not found'
);

-- Add a 9th real match so a new team ties with b7 — the ACTUAL 8th-place team in this
-- fixture (bf is seed 1, b1..b7 fill seeds 2-8; b8 is the 9th, already excluded on its
-- own, so tying b8 with anyone never touches the real cutoff) — at the top-8 boundary,
-- then remove it afterward. This proves the tie check fires without permanently
-- corrupting the main fixture the rest of the file depends on.
insert into btc_teams (id, event_id, name) values ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e1', 'Tied');
insert into btc_matches (id, event_id, round, team1_id, team2_id, status)
  values ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
          '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000bf', 'confirmed');
insert into btc_match_judges (match_id, judge_id)
  select '00000000-0000-0000-0000-0000000000d9', ('00000000-0000-0000-0000-0000000000c' || j)::uuid from generate_series(1, 3) j;
insert into btc_cup_votes (match_id, cup_number, team1_tokens)
  select '00000000-0000-0000-0000-0000000000d9', c, case when c <= 9 then 3 else 0 end from generate_series(1, 15) c;
insert into btc_match_bonuses (match_id, fastest_team_id) values ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000b9');
-- b7 (i=7) has 9 full cups (16-7=9) — matching this team's own split, same fastest
-- bonus, so their totals (and wins) now tie exactly at the real 8th/9th boundary.

select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket',
  'a genuine tie at the cutoff boundary blocks generation'
);

delete from btc_cup_votes where match_id = '00000000-0000-0000-0000-0000000000d9';
delete from btc_match_judges where match_id = '00000000-0000-0000-0000-0000000000d9';
delete from btc_matches where id = '00000000-0000-0000-0000-0000000000d9';
delete from btc_teams where id = '00000000-0000-0000-0000-0000000000b9';

-- ---------- generate_btc_bracket: the real thing ----------

select is(
  (select count(*)::int from generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')),
  8, 'generates exactly 8 slots (4 QF, 2 SF, 1 final, 1 third-place)'
);

select is((select team1_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000bf'::uuid, 'qf1 seed 1 is the filler (highest cumulative total)');
select is((select team2_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b7'::uuid, 'qf1 seed 8 is team 7 (b8 excluded, the lowest of the 9)');
select is((select team1_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b3'::uuid, 'qf2 pairs seed 4 v seed 5 (b3 v b4)');
select is((select team2_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b4'::uuid, 'qf2''s other side is seed 5 (b4)');
select is((select team1_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b1'::uuid, 'qf4 pairs seed 2 v seed 7 (b1 v b6)');
select is((select team2_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b6'::uuid, 'qf4''s other side is seed 7 (b6)');
select is((select feeder_slot_1 from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          'sf1 is fed by qf1');
select is((select feeder_slot_1 from btc_bracket_slots where slot_label = 'final' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          'final is fed by sf1');
select is((select feeder_slot_1 from btc_bracket_slots where slot_label = 'third_place' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          'third-place is ALSO fed by sf1 (the same slot feeds two downstream slots)');
select is((select team1_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          null, 'sf1 starts with no teams — they come from advancement, not seeding');

select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: a bracket already exists for this event',
  'a second call for the same event is refused, making a retry after a dropped response safe'
);

-- ---------- create_btc_bracket_match ----------

select throws_ok(
  $$ select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
       (select id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]) $$,
  'P0001', 'create_btc_bracket_match: both of this slot''s teams must be known first',
  'a slot with no teams yet cannot have a match created'
);

select lives_ok(
  $$ select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
       (select id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]) $$,
  'creating a match from a fully-seeded QF slot succeeds'
);
select is((select round from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          'quarterfinal', 'the created match carries the slot''s own round');
select is((select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          '00000000-0000-0000-0000-0000000000bf'::uuid, 'the created match carries the slot''s own teams');

select throws_ok(
  $$ select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
       (select id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]) $$,
  'P0001', 'create_btc_bracket_match: this slot already has a match',
  'a second match for the same slot is refused'
);

-- Create the remaining 3 QF matches too, so the confirm-advancement tests below have
-- a match to confirm for every quarterfinal.
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
  (select id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
  (select id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
  (select id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);

-- ---------- confirm_btc_match: bracket advancement ----------

-- qf1: filler beats b7 (all 20 cups to team1). Winner must land in sf1's team1 slot
-- (sf1.feeder_slot_1 = qf1).
select lives_ok(
  $$ select confirm_btc_match('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010',
       (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1')),
       (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c),
       '00000000-0000-0000-0000-0000000000bf', false, false, null, null) $$,
  'confirming qf1 succeeds'
);
select is((select team1_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000bf'::uuid, 'qf1''s winner advances into sf1''s team1 position');

-- qf2: a genuine TOKEN TIE — 10 cups at 3, 10 at 0 gives team1=30, team2=30, and with
-- no fastest/signature bonus on either side that is a true 30-30 tie. Must NOT advance
-- anyone.
select lives_ok(
  $$ select confirm_btc_match('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000010',
       (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
       (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 3 else 0 end)) from generate_series(1, 20) c),
       null, false, false, null, null) $$,
  're-confirming qf2 with a genuine 30-30 tie succeeds as a scored match'
);
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          null, 'a tied bracket match leaves the downstream slot unresolved rather than guessing a winner');

-- qf3 and qf4, both clean wins for team1, feeding sf2.
select confirm_btc_match('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000010',
  (select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1')),
  (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c),
  '00000000-0000-0000-0000-0000000000b2', false, false, null, null);
select confirm_btc_match('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000010',
  (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1')),
  (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c),
  '00000000-0000-0000-0000-0000000000b1', false, false, null, null);

select is((select team1_id from btc_bracket_slots where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b2'::uuid, 'qf3''s winner advances into sf2''s team1 position');
select is((select team2_id from btc_bracket_slots where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b1'::uuid, 'qf4''s winner advances into sf2''s team2 position');

-- Re-confirming qf1 with the SAME winner must still succeed (sf1's own match does not
-- exist yet, and even once it does, an unchanged outcome is always safe).
select lives_ok(
  $$ select confirm_btc_match('00000000-0000-0000-0000-00000000005a', '00000000-0000-0000-0000-000000000010',
       (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1')),
       (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c),
       '00000000-0000-0000-0000-0000000000bf', false, false, null, null) $$,
  're-confirming qf1 with the same outcome succeeds'
);

-- Create and confirm sf2 (fully seeded now), sending its winner to the final and its
-- loser to third-place.
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
  (select id from btc_bracket_slots where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);
select confirm_btc_match('00000000-0000-0000-0000-00000000005b', '00000000-0000-0000-0000-000000000010',
  (select match_id from btc_bracket_slots where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
  (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c),
  '00000000-0000-0000-0000-0000000000b2', true, true, null, null);

-- sf2 is feeder_slot_2 for both 'final' and 'third_place' (sf1 is feeder_slot_1), so
-- its winner/loser land in each slot's team2_id, not team1_id.
select is((select team2_id from btc_bracket_slots where slot_label = 'final' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b2'::uuid, 'sf2''s winner advances into the final');
select is((select team2_id from btc_bracket_slots where slot_label = 'third_place' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b1'::uuid, 'sf2''s LOSER advances into third-place, not the final');

-- Now that sf2's own match exists, re-confirming qf3 with a DIFFERENT winner must be
-- refused — closing the ROADMAP.md gap: "editing a confirmed match whose winner
-- already advanced." qf3's win no longer belongs to team1 alone (it's flipped to a
-- team2-only sweep), which would change sf2.team1 away from what sf2's own match was
-- already created with.
select throws_ok(
  $$ select confirm_btc_match('00000000-0000-0000-0000-00000000005c', '00000000-0000-0000-0000-000000000010',
       (select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1')),
       (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 0)) from generate_series(1, 20) c),
       '00000000-0000-0000-0000-0000000000b5', false, false, null, null) $$,
  'P0001', 'confirm_btc_match: this match''s winner has already advanced to a match in progress — that downstream match must be removed before this result can change',
  'a changed re-confirm is refused once the downstream match already exists'
);
select is((select team1_id from btc_bracket_slots where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000b2'::uuid, 'the refused re-confirm left sf2''s team unchanged');
select is((select count(*)::int from btc_cup_votes where match_id = (select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          20, 'and left qf3''s own votes untouched — the refused confirm rolled back atomically');

-- sf1's own match still cannot be created — qf2's tie left sf1's team2 position
-- unresolved, so sf1 is not fully seeded yet.
select throws_ok(
  $$ select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
       (select id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
       array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]) $$,
  'P0001', 'create_btc_bracket_match: both of this slot''s teams must be known first',
  'sf1 still cannot get a match: qf2''s tie left its team2 position unresolved'
);

-- ---------- cross-org / non-member rejection ----------
-- The explicit p_org_id argument can't catch a caller who supplies the event's own
-- REAL org_id (it isn't secret) — RLS is what actually has to stop them. Capture a
-- real slot id now, while still authenticated as the genuine member: querying it AS
-- the other-org/outsider persona below would itself be RLS-filtered to nothing.
select set_config(
  'test.qf1_slot_id',
  (select id::text from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  false
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';

select throws_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'P0001', 'generate_btc_bracket: at least 8 teams with a confirmed preliminary result are required',
  'a real member of a DIFFERENT org, using the event''s own real org_id, is rejected (RLS hides btc_standings)'
);

select throws_ok(
  $$ select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
       current_setting('test.qf1_slot_id')::uuid,
       array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]) $$,
  'P0001', 'create_btc_bracket_match: bracket slot not found',
  'a real member of a DIFFERENT org cannot create a match from another org''s slot (RLS hides the row)'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';

select throws_ok(
  $$ select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
       current_setting('test.qf1_slot_id')::uuid,
       array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]) $$,
  'P0001', 'create_btc_bracket_match: bracket slot not found',
  'a user with no org membership at all cannot create a match from any org''s slot'
);

-- Restore the genuine member for the remaining privilege checks below.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- privileges ----------

select is(
  has_function_privilege('anon', 'generate_btc_bracket(uuid, uuid)', 'execute'),
  false, 'anon cannot execute generate_btc_bracket'
);
select is(
  has_function_privilege('anon', 'create_btc_bracket_match(uuid, uuid, uuid[])', 'execute'),
  false, 'anon cannot execute create_btc_bracket_match'
);
select is(
  has_function_privilege('authenticated', 'generate_btc_bracket(uuid, uuid)', 'execute'),
  true, 'authenticated can execute generate_btc_bracket'
);

reset role;
reset request.jwt.claim.sub;

select * from finish();
rollback;
