-- delete_test_event on a BTC event with scoring data (2026-09-27 production bug).
-- Proves: a test BTC event with teams, judges, a scored match (judges, cup votes,
-- bonuses) and bracket slots deletes cleanly through delete_test_event — the events
-- cascade used to reach btc_teams/btc_judges before the rows referencing them and trip
-- the non-cascading references (btc_match_bonuses_fastest_team_id_fkey in production;
-- btc_match_judges_judge_id_fkey trips too if the bonus is removed, so a fix covering
-- only one of them stays red). Also proves: a non-member can neither delete the event
-- nor reach its BTC rows through the cleanup trigger; the team references are still
-- enforced outside an event delete; and a real BTC event's direct deletion logs its
-- matches and slots (see the migration header on why).
begin;
select plan(15);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'other-org@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000006', 'organiser');

insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'btc', 'BTC Test', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010',
   'btc', 'BTC Real', false);

insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Team 1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Team 2'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e2', 'Real 1'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000e2', 'Real 2');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'J1');

insert into btc_matches (id, event_id, round, team1_id, team2_id, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
   'preliminary', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'confirmed'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e2',
   'preliminary', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b4', 'confirmed');
insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1');
insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
  ('00000000-0000-0000-0000-0000000000d1', 1, 3);
insert into btc_match_bonuses (match_id, fastest_team_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b3');

-- A feeder slot and a slot fed by it, both holding RESTRICT references to teams.
insert into btc_bracket_slots (id, event_id, round, slot_label, team1_id, team2_id, match_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
   'semifinal', 'sf1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000d1');
insert into btc_bracket_slots (id, event_id, round, slot_label, team1_id, feeder_slot_1) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1',
   'final', 'final', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e2',
   'final', 'final', '00000000-0000-0000-0000-0000000000b3', null);

-- ============ a non-member can't delete the event or reach its BTC rows ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';

select is(
  (select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1')
  + (select count(*)::int from btc_bracket_slots where event_id = '00000000-0000-0000-0000-0000000000e1')
  + (select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'a non-member reads zero of the other org''s BTC rows'
);

select throws_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  null,
  'delete_test_event: event 00000000-0000-0000-0000-0000000000e1 not found',
  'a non-member passing their own org id is rejected'
);

select lives_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  'a non-member passing the owning org id: the call returns, but RLS matches zero rows'
);

select lives_ok(
  $$ delete from events where id = '00000000-0000-0000-0000-0000000000e1' $$,
  'a non-member''s direct delete returns, matching zero rows'
);

reset role;

select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e1')
  + (select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1')
  + (select count(*)::int from btc_bracket_slots where event_id = '00000000-0000-0000-0000-0000000000e1')
  + (select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e1'),
  6,
  'after the non-member attempts, the event, its match, both slots and both teams all survive'
);

-- ============ the team references still hold outside an event delete ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ delete from btc_teams where id = '00000000-0000-0000-0000-0000000000b3' $$,
  '23503',
  null,
  'a team a match still uses cannot be deleted on its own'
);

-- ============ a real BTC event is still refused by the RPC ============

select throws_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2'
     ) $$,
  'P0001',
  'delete_test_event: refusing to delete a non-test event (00000000-0000-0000-0000-0000000000e2)',
  'a real BTC event is refused'
);

-- ============ a test BTC event with scoring data deletes cleanly ============

select lives_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  'a test BTC event with a scored match and bracket slots deletes without an FK violation'
);

reset role;

select is((select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e1'),
          0, 'the test event is gone');
select is(
  (select count(*)::int from btc_judges where event_id = '00000000-0000-0000-0000-0000000000e1')
  + (select count(*)::int from btc_match_judges where match_id = '00000000-0000-0000-0000-0000000000d1')
  + (select count(*)::int from btc_cup_votes where match_id = '00000000-0000-0000-0000-0000000000d1'),
  0,
  'its judges, match-judge assignments and cup votes are gone'
);

select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e2'),
          1, 'the real event''s match is untouched — the cleanup is scoped to the deleted event');
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e2'),
          2, 'the real event''s teams are untouched');
select is((select count(*)::int from btc_bracket_slots where event_id = '00000000-0000-0000-0000-0000000000e2'),
          1, 'the real event''s slot is untouched');

-- ============ a direct DELETE of a real BTC event also cascades cleanly, and is logged ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ delete from events where id = '00000000-0000-0000-0000-0000000000e2' $$,
  'an org member''s direct delete of a real BTC event with a confirmed match succeeds'
);

reset role;

select results_eq(
  $$ select table_name, count(*)::int from score_change_log
     where event_id = '00000000-0000-0000-0000-0000000000e2' and action = 'delete'
     group by table_name order by table_name $$,
  $$ values ('btc_bracket_slots'::text, 1), ('btc_matches'::text, 1), ('events'::text, 1) $$,
  'the real event''s deletion logs the event, its match and its slot — not the cascaded bonus'
);

select * from finish();
rollback;
