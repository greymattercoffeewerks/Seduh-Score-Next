-- T-BTC.2 scoring, part 3: BTC rows cannot reference another event's teams, judges or
-- matches. Every write below is done as a real org member under RLS, the exact shape
-- security-reviewer used to demonstrate the gap.
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member-a@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-000000000020', 'Org B', 'org-b');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'btc', 'Event A'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'btc', 'Event A2'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000020', 'btc', 'Event B');
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'A1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'A2'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', 'A3'),
  ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000e2', 'B1'),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e2', 'B2');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'JA'),
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000e2', 'JB');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000e2', 'preliminary',
   '00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000b9');

-- org B's own bracket slot, for the feeder-slot probe
insert into btc_bracket_slots (id, event_id, round, slot_label) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', 'semifinal', 'sfB');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ insert into btc_matches (event_id, round, team1_id, team2_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'preliminary',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3') $$,
  'a match whose teams both belong to its event is accepted'
);
select throws_ok(
  $$ insert into btc_matches (event_id, round, team1_id, team2_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'preliminary',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b8') $$,
  'P0001', 'btc_matches: both teams must belong to the match''s event',
  'a member cannot create a match against another event''s team'
);
select throws_ok(
  $$ update btc_matches set team2_id = '00000000-0000-0000-0000-0000000000b8'
       where id = '00000000-0000-0000-0000-0000000000d1' $$,
  'P0001', 'btc_matches: both teams must belong to the match''s event',
  'nor re-point an existing match at another event''s team'
);

select throws_ok(
  $$ insert into btc_matches (event_id, round, team1_id, team2_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'preliminary',
        '00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000b1') $$,
  'P0001', 'btc_matches: both teams must belong to the match''s event',
  'nor put another event''s team in the team 1 position'
);

select lives_ok(
  $$ insert into btc_match_judges (match_id, judge_id) values
       ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1') $$,
  'a judge from the match''s own event can be assigned'
);
select throws_ok(
  $$ insert into btc_match_judges (match_id, judge_id) values
       ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c9') $$,
  'P0001', 'btc_match_judges: the judge must belong to the match''s event',
  'a judge from another event cannot be assigned'
);

select lives_ok(
  $$ insert into btc_bracket_slots (event_id, round, slot_label, team1_id, match_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'final', 'final',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1') $$,
  'a bracket slot whose team and match belong to its event is accepted'
);
select throws_ok(
  $$ insert into btc_bracket_slots (event_id, round, slot_label, team1_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'semifinal', 'sf1',
        '00000000-0000-0000-0000-0000000000b8') $$,
  'P0001', 'btc_bracket_slots: team1 must belong to the slot''s event',
  'a bracket slot cannot hold another event''s team'
);
select throws_ok(
  $$ insert into btc_bracket_slots (event_id, round, slot_label, match_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'semifinal', 'sf2',
        '00000000-0000-0000-0000-0000000000d9') $$,
  'P0001', 'btc_bracket_slots: the resolved match must belong to the slot''s event',
  'a bracket slot cannot point at another event''s match'
);

select throws_ok(
  $$ insert into btc_bracket_slots (event_id, round, slot_label, team2_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'semifinal', 'sf4',
        '00000000-0000-0000-0000-0000000000b9') $$,
  'P0001', 'btc_bracket_slots: team2 must belong to the slot''s event',
  'nor another event''s team in the team 2 position'
);
select throws_ok(
  $$ insert into btc_bracket_slots (event_id, round, slot_label, feeder_slot_1) values
       ('00000000-0000-0000-0000-0000000000e1', 'final', 'final2',
        '00000000-0000-0000-0000-0000000000f1') $$,
  'P0001', 'btc_bracket_slots: feeder slot 1 must belong to the slot''s event',
  'a bracket slot cannot be fed by another event''s slot'
);

select throws_ok(
  $$ update btc_teams set event_id = '00000000-0000-0000-0000-0000000000e3'
       where id = '00000000-0000-0000-0000-0000000000b3' $$,
  'P0001', 'btc_teams: a row cannot be moved to another event',
  'a team cannot be re-parented to another event once matches may reference it'
);
select throws_ok(
  $$ update btc_judges set event_id = '00000000-0000-0000-0000-0000000000e3'
       where id = '00000000-0000-0000-0000-0000000000c1' $$,
  'P0001', 'btc_judges: a row cannot be moved to another event',
  'nor a judge'
);

reset role;
reset request.jwt.claim.sub;

select is(
  (select count(*)::int from btc_matches
     where event_id = '00000000-0000-0000-0000-0000000000e1'
       and (team1_id = '00000000-0000-0000-0000-0000000000b8'
         or team2_id = '00000000-0000-0000-0000-0000000000b8'
         or team2_id = '00000000-0000-0000-0000-0000000000b9')),
  0, 'no cross-event reference was left behind by any rejected write'
);

select * from finish();
rollback;
