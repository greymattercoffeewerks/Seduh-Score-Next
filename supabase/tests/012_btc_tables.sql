-- T-BTC.1 BTC schema + RLS — plan doc §5/§9 AC.
-- Proves: schema constraints hold, a non-member reads zero rows from every
-- btc_* table and view, anon has no table-level privilege on any of them, and
-- an org member can read/write normally.
begin;
select plan(23);

-- ---------- fixtures (as postgres, bypasses RLS) ----------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org');

insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- ...005 (outsider) is deliberately not a member of this org

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'btc', 'Test BTC Event');

insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Team A'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Team B');

insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'Judge One'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 'Judge Two'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1', 'Judge Three');

insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1',
   'preliminary', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');

insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3');

-- Cup 1: 2 of the 3 tokens to team A (b1), 1 to team B (b2) — judges are on record
-- (assigned above) but no vote is attributed to one; see T-BTC.2's per-cup-token
-- design correction in 20260922100000_btc_cup_votes_per_cup_tokens.sql.
insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
  ('00000000-0000-0000-0000-0000000000d1', 1, 2);

insert into btc_match_bonuses (match_id, fastest_team_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1');

insert into btc_bracket_slots (id, event_id, round, slot_label) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1',
   'final', 'final');

-- ---------- schema constraints ----------

select throws_ok(
  $$ insert into btc_matches (event_id, round, team1_id, team2_id) values
       ('00000000-0000-0000-0000-0000000000e1', 'preliminary',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1') $$,
  '23514',
  null,
  'btc_matches rejects a team playing itself'
);

select throws_ok(
  $$ insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
       ('00000000-0000-0000-0000-0000000000d1', 1, 1) $$,
  '23505',
  null,
  'btc_cup_votes rejects a second row for the same (match, cup)'
);

select throws_ok(
  $$ insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
       ('00000000-0000-0000-0000-0000000000d1', 2, 4) $$,
  '23514',
  null,
  'btc_cup_votes rejects a team1_tokens value above 3'
);
select throws_ok(
  $$ insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
       ('00000000-0000-0000-0000-0000000000d1', 2, -1) $$,
  '23514',
  null,
  'btc_cup_votes rejects a negative team1_tokens value'
);

select throws_ok(
  $$ update btc_match_bonuses set fastest_team_id = gen_random_uuid()
       where match_id = '00000000-0000-0000-0000-0000000000d1' $$,
  'P0001',
  'btc_match_bonuses.fastest_team_id must be a participant of the match',
  'btc_match_bonuses rejects a fastest_team_id that is not one of the match''s two teams'
);

-- ---------- non-member reads zero rows ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';

select is((select count(*)::int from btc_teams), 0, 'non-member reads zero rows: btc_teams');
select is((select count(*)::int from btc_judges), 0, 'non-member reads zero rows: btc_judges');
select is((select count(*)::int from btc_matches), 0, 'non-member reads zero rows: btc_matches');
select is((select count(*)::int from btc_match_judges), 0, 'non-member reads zero rows: btc_match_judges');
select is((select count(*)::int from btc_cup_votes), 0, 'non-member reads zero rows: btc_cup_votes');
select is((select count(*)::int from btc_match_bonuses), 0, 'non-member reads zero rows: btc_match_bonuses');
select is((select count(*)::int from btc_bracket_slots), 0, 'non-member reads zero rows: btc_bracket_slots');
select is((select count(*)::int from btc_cup_totals), 0, 'non-member reads zero rows: btc_cup_totals');
select is((select count(*)::int from btc_match_totals), 0, 'non-member reads zero rows: btc_match_totals');
select is((select count(*)::int from btc_standings), 0, 'non-member reads zero rows: btc_standings');

reset role;
reset request.jwt.claim.sub;

-- ---------- anon has no table-level privilege on any btc_* table ----------

select is(has_table_privilege('anon', 'btc_teams', 'select'), false, 'anon has no SELECT on btc_teams');
select is(has_table_privilege('anon', 'btc_matches', 'select'), false, 'anon has no SELECT on btc_matches');
select is(has_table_privilege('anon', 'btc_cup_votes', 'select'), false, 'anon has no SELECT on btc_cup_votes');
select is(has_table_privilege('anon', 'btc_matches', 'insert'), false, 'anon has no INSERT on btc_matches');

-- ---------- member reads/writes normally ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select is((select count(*)::int from btc_teams), 2, 'member reads btc_teams for their own org');
select is(
  (select total_points from btc_standings
     where team_id = '00000000-0000-0000-0000-0000000000b1'),
  null,
  'btc_standings excludes a not-yet-confirmed match (status is still pending)'
);

update btc_matches set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000d1';

select is(
  (select total_points from btc_standings
     where team_id = '00000000-0000-0000-0000-0000000000b1'),
  null,
  'btc_standings excludes a match marked confirmed that does not hold a complete set of votes (the numbers for a complete match are pinned in 014)'
);
select is(
  (select total_points from btc_standings
     where team_id = '00000000-0000-0000-0000-0000000000b2'),
  null,
  'btc_standings excludes the same incomplete match for team 2 too'
);

reset role;
reset request.jwt.claim.sub;

select * from finish();
rollback;
