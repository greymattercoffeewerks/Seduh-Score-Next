-- load_btc_demo: one call loads 8 teams, 5 judges and 28 scored preliminary matches into a TEST
-- event, and can be run again to start over. See 20261009120000_btc_load_demo.sql.
begin;
select plan(61);

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
-- e1: the TEST BTC event we load into. e2: a REAL (non-test) BTC event that must never be touched.
-- e3: a test event of another format.
insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'btc', 'Demo Event', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'btc', 'Real Event', false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Cup Event', true);
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', 'Real Team'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 'Typed By Hand');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 'Real Judge');
-- the REAL event also has a match, so a refused load can be shown to leave matches alone, not only teams
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e2', 'Real Team Two');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 'preliminary',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3');
-- e4: a SECOND test event in the SAME org (its data must survive a load into e1);
-- e5: a test event in ANOTHER org (neither org id may reach it)
insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000010', 'btc', 'Second Demo', true),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000020', 'btc', 'Foreign Demo', true);
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e4', 'Other Test Team'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000e4', 'Other Test Team Two'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000e5', 'Foreign Team');
-- e4 has EVERY kind of row a wipe could wrongly reach: a judge, a match and a bracket slot too
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000e4', 'Other Judge');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000e4', 'preliminary',
   '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a6');
insert into btc_bracket_slots (event_id, round, slot_label) values
  ('00000000-0000-0000-0000-0000000000e4', 'final', 'final');

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

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- loading ----------
select is(
  (select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') ->> 'matches'),
  '28', 'loading returns the number of matches it created (every pair once: 8 teams = 28)'
);
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e1'), 8, '8 teams');
select is(
  (select count(distinct mj.judge_id)::int from btc_match_judges mj join btc_matches m on m.id = mj.match_id where m.event_id = '00000000-0000-0000-0000-0000000000e1'),
  5, 'all 5 judges are used across the matches (the rotation reaches judges 4 and 5)'
);
select is(
  (select count(distinct b.fastest_team_id)::int from btc_match_bonuses b join btc_matches m on m.id = b.match_id where m.event_id = '00000000-0000-0000-0000-0000000000e1'),
  8, 'the fastest-team bonus is spread across all 8 teams, not given to one side'
);
select is(
  (select string_agg(t.name || ':' || s.total_points || ':' || s.wins, ',' order by t.name)
     from btc_standings s join btc_teams t on t.id = s.team_id where t.event_id = '00000000-0000-0000-0000-0000000000e1'),
  'Bean Scene:248:6,Crema Crew:216:5,Drip Society:208:5,Grind House:169:3,Latte Lab:114:1,Pour Decisions:235:6,Roast Republic:161:2,Steam Team:105:0',
  'a golden fingerprint of the standings: changing the formula is a deliberate act, not an accident'
);
select is((select count(*)::int from btc_judges where event_id = '00000000-0000-0000-0000-0000000000e1'), 5, '5 judges');
select is((select count(*)::int from btc_teams where name = 'Typed By Hand'), 0, 'a team typed by hand beforehand is gone: the load replaces the roster');
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e4'), 2, 'a different test event in the same org keeps its teams: the wipe is scoped to the one event');
select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1' and round = 'preliminary' and status = 'confirmed'), 28, '28 confirmed preliminary matches');
select is((select count(*)::int from btc_cup_votes v join btc_matches m on m.id = v.match_id where m.event_id = '00000000-0000-0000-0000-0000000000e1'), 420, '15 cups for each of the 28 matches');
select is((select count(*)::int from btc_match_bonuses b join btc_matches m on m.id = b.match_id where m.event_id = '00000000-0000-0000-0000-0000000000e1'), 28, 'a fastest-team bonus on every match');
select is(
  (select count(*)::int from (
     select mj.match_id from btc_match_judges mj join btc_matches m on m.id = mj.match_id
     where m.event_id = '00000000-0000-0000-0000-0000000000e1'
     group by mj.match_id having count(distinct mj.judge_id) = 3
   ) x),
  28, 'every match has exactly 3 distinct judges'
);
select is(
  (select count(*)::int from (select a from (
      select team1_id as a from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1'
      union all select team2_id from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1') p
    group by a having count(*) = 7) y),
  8, 'every team plays every other team exactly once (7 matches each)'
);
select is(
  (select count(*)::int from (
     select team1_id, team2_id from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1'
     group by team1_id, team2_id having count(*) > 1) d),
  0, 'no pairing is repeated'
);

-- ---------- the results look real, and are ready for the bracket ----------
select is((select count(*)::int from btc_standings s join btc_teams t on t.id = s.team_id where t.event_id = '00000000-0000-0000-0000-0000000000e1' and s.played = 7), 8, 'the standings show all 8 teams with 7 played');
select is((select count(distinct s.total_points)::int from btc_standings s join btc_teams t on t.id = s.team_id where t.event_id = '00000000-0000-0000-0000-0000000000e1'), 8, 'no two teams are level on points, so seeding is unambiguous');
select is(
  (select t.name from btc_standings s join btc_teams t on t.id = s.team_id where t.event_id = '00000000-0000-0000-0000-0000000000e1' order by s.total_points desc limit 1),
  'Bean Scene', 'the strongest team tops the table'
);
select is(
  (select t.name from btc_standings s join btc_teams t on t.id = s.team_id where t.event_id = '00000000-0000-0000-0000-0000000000e1' order by s.total_points asc limit 1),
  'Steam Team', 'and the weakest is last'
);
select ok(
  (select count(*) from btc_match_scores where event_id = '00000000-0000-0000-0000-0000000000e1' and team1_tokens < team2_tokens) between 1 and 6,
  'there are a few upsets (1 to 6 of 28): a stronger team loses some matches, so it is not a clean ladder, and it is not chaos either'
);
select ok(
  (select count(*) from btc_match_scores where event_id = '00000000-0000-0000-0000-0000000000e1' and team1_tokens % 3 <> 0) >= 14,
  'scores are not all multiples of 3: the cups within a match vary (an earlier formula repeated in blocks of 5)'
);
select ok(
  (select count(*) from btc_cup_votes v join btc_matches m on m.id = v.match_id
    where m.event_id = '00000000-0000-0000-0000-0000000000e1' and v.team1_tokens in (0, 3)) > 0
  and (select count(distinct v.team1_tokens) from btc_cup_votes v join btc_matches m on m.id = v.match_id
    where m.event_id = '00000000-0000-0000-0000-0000000000e1') = 4,
  'all four cup scores (0, 1, 2 and 3 tokens) occur'
);
select lives_ok(
  $$ select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$,
  'the bracket can be generated straight after loading'
);
select is((select count(*)::int from btc_bracket_slots where event_id = '00000000-0000-0000-0000-0000000000e1'), 8, 'and has its 8 slots');

-- Take the bracket as far as it goes: a quarterfinal match, confirmed LEVEL, with a tie-break winner
-- recorded. Those are the rows the wipe has to get past (RESTRICT keys), and they must not survive it.
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010',
  (select id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  array(select id from btc_judges where event_id = '00000000-0000-0000-0000-0000000000e1' order by name limit 3));
select confirm_btc_match('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000010',
  (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1')),
  (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 3 else 0 end)) from generate_series(1, 20) c),
  null, false, false, null, null);
select record_btc_tiebreak('00000000-0000-0000-0000-000000000010',
  (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  (select team1_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
  'Sudden death');
select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1' and tiebreak_winner_team_id is not null), 1, 'a knockout match with a recorded tie-break now exists (the hardest thing for the wipe to remove)');

-- ---------- loading again starts over ----------
select set_config('test.standings1',
  (select string_agg(t.name || ':' || s.total_points || ':' || s.wins, ',' order by t.name)
     from btc_standings s join btc_teams t on t.id = s.team_id where t.event_id = '00000000-0000-0000-0000-0000000000e1'), false);
select lives_ok($$ select set_config('test.reply', load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')::text, false) $$, 'loading a second time works');
select is(current_setting('test.reply')::jsonb ->> 'teams', '8', 'the reply says 8 teams (the screen prints the server''s numbers as fact)');
select is(current_setting('test.reply')::jsonb ->> 'judges', '5', 'the reply says 5 judges');
select is(current_setting('test.reply')::jsonb ->> 'matches', '28', 'the reply says 28 matches');
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e1'), 8, 'still 8 teams, not 16');
select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1'), 28, 'still 28 matches');
select is((select count(*)::int from btc_bracket_slots where event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'the bracket generated from the first load is gone');
select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1' and round <> 'preliminary'), 0, 'and so is the knockout match, with its recorded tie-break, without a foreign-key error');
select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1' and tiebreak_winner_team_id is not null), 0, 'no tie-break survives the reload');
select is(
  (select array[(select count(*) from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e4'),
                (select count(*) from btc_judges where event_id = '00000000-0000-0000-0000-0000000000e4'),
                (select count(*) from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e4'),
                (select count(*) from btc_bracket_slots where event_id = '00000000-0000-0000-0000-0000000000e4')]::int[]),
  array[2, 1, 1, 1],
  'the other test event in the same org still has ALL its rows after the reload: teams, judge, match and bracket slot (the wipe is scoped in every table)'
);
select is(
  (select string_agg(t.name || ':' || s.total_points || ':' || s.wins, ',' order by t.name)
     from btc_standings s join btc_teams t on t.id = s.team_id where t.event_id = '00000000-0000-0000-0000-0000000000e1'),
  current_setting('test.standings1'),
  'the results are identical every time (deterministic), so a rehearsal can be repeated exactly'
);

-- a NULL p_scored is the default (scored), not silently the roster-only mode
select is((select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', null) ->> 'matches'), '28', 'a NULL p_scored loads the scored demo, like the default');

-- ---------- the roster-only mode ----------
select lives_ok($$ select set_config('test.reply', load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', false)::text, false) $$, 'the roster-only mode works');
select is(current_setting('test.reply')::jsonb ->> 'matches', '0', 'the roster-only reply says 0 matches (the screen picks its wording from this)');
select is(current_setting('test.reply')::jsonb ->> 'teams', '8', 'and still 8 teams');
select is(current_setting('test.reply')::jsonb ->> 'judges', '5', 'and 5 judges');
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e1'), 8, 'it leaves the 8 teams');
select is((select count(*)::int from btc_judges where event_id = '00000000-0000-0000-0000-0000000000e1'), 5, 'and the 5 judges');
select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'but no matches');
select is((select count(*)::int from btc_cup_votes v join btc_matches m on m.id = v.match_id where m.event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'and no votes');

-- ---------- refusals ----------
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $q$), 'demo_not_test', 'a REAL event is refused');
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e2' and name = 'Real Team'), 1, 'and its roster is untouched');
select is((select count(*)::int from btc_matches where event_id = '00000000-0000-0000-0000-0000000000e2'), 1, 'so is its match');
select is((select count(*)::int from btc_judges where event_id = '00000000-0000-0000-0000-0000000000e2'), 1, 'and its judge');
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e5') $q$), 'demo_event_not_found', 'ANOTHER org''s test event, named with my own org id, is not found');
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e5') $q$), 'demo_event_not_found', 'and named with its own org id it is just as invisible to me');
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3') $q$), 'demo_not_btc', 'an event of another format is refused');
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000dead') $q$), 'demo_event_not_found', 'an unknown event is reported as not found');
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-0000000000e1') $q$), 'demo_event_not_found', 'a forged org id is reported as not found');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $q$), 'demo_event_not_found', 'a member of ANOTHER org, using the real org id, is told the event does not exist');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is(pg_temp.hint_of($q$ select load_btc_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $q$), 'demo_event_not_found', 'a user in no org gets the identical answer');
reset role;
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e1'), 8, 'and neither attempt touched the roster');
select is((select count(*)::int from btc_teams where event_id = '00000000-0000-0000-0000-0000000000e5'), 1, 'and the other org''s test event still has its team (checked as superuser: its own org''s rows are invisible to me)');

select is(has_function_privilege('anon', 'load_btc_demo(uuid, uuid, boolean)', 'execute'), false, 'anon cannot execute load_btc_demo');
select is(has_function_privilege('authenticated', 'load_btc_demo(uuid, uuid, boolean)', 'execute'), true, 'authenticated can');
select is((select count(*)::int from score_change_log where event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'a test event writes nothing to the change log (rehearsal noise stays out of the audit trail)');

-- The event row is locked FOR UPDATE for the rest of the transaction (so is_test cannot flip mid-call and
-- two overlapping loads of one event queue). Two sessions would be needed to SEE the queueing, but the lock
-- itself is visible from here: the earlier successful loads still hold it. (Not xmax: foreign-key checks take
-- a key-share lock, so xmax is set even without FOR UPDATE.)
create extension if not exists pgrowlocks;
select ok(
  exists (select 1 from pgrowlocks('public.events') r where 'For Update' = any (r.modes)),
  'the load holds the event row FOR UPDATE until the transaction ends'
);
select * from finish();
rollback;
