-- Build B part 1: btc_round_draws and create_btc_round (migration 20261109100000).
-- Proves (spec 4.4, the part the database can hold): a round is created whole or not at all (also when a later write
-- fails), a second call for the same round is refused, round 2 is refused until every earlier round is confirmed,
-- every team plays exactly once, 3 distinct judges per match, the seed/mode pairing, a judge from a team's own country is
-- recorded and not refused, a non-member gets the not-found refusal and reads zero rows, the table's grants, and
-- create_btc_match's new optional round. The cross-organisation matrices (040, 041) hold the other half.
begin;
select plan(66);

-- ---------- helpers (all rolled back with the transaction) ----------

create function public.t075_u(n int) returns uuid language sql immutable as $$
  select ('75000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- a match object for p_matches
create function public.t075_m(t1 int, t2 int, j1 int, j2 int, j3 int) returns jsonb language sql immutable as $$
  select jsonb_build_object('team1_id', public.t075_u(t1), 'team2_id', public.t075_u(t2),
                            'judge_ids', jsonb_build_array(public.t075_u(j1), public.t075_u(j2), public.t075_u(j3)))
$$;
-- run create_btc_round for the test organisation; returns 'ok' or the refusal's hint (never its wording)
create function public.t075_hint(p_event int, p_round int, p_mode text, p_seed text, p_matches jsonb,
                                 p_org int default 10, p_avoid boolean default true)
returns text language plpgsql as $$
declare h text;
begin
  perform * from public.create_btc_round(public.t075_u(p_org), public.t075_u(p_event), p_round::smallint, p_mode, p_seed,
                                         p_matches, p_avoid);
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function public.t075_u(int), public.t075_m(int, int, int, int, int),
  public.t075_hint(int, int, text, text, jsonb, int, boolean) to authenticated;

-- ---------- fixtures (as postgres, bypasses RLS) ----------

insert into auth.users (id, email) values
  (public.t075_u(1), 'member75@test.seduh-next'),
  (public.t075_u(2), 'outsider75@test.seduh-next');
insert into orgs (id, name, slug) values
  (public.t075_u(10), 'Org 75', 'org-75'),
  (public.t075_u(20), 'Other Org 75', 'other-org-75');
insert into org_members (org_id, user_id, role) values (public.t075_u(10), public.t075_u(1), 'organiser');

-- E = 200: six teams and six judges (countries on some); the happy path
insert into events (id, org_id, format, name) values
  (public.t075_u(200), public.t075_u(10), 'btc', 'Event 75'),
  (public.t075_u(300), public.t075_u(10), 'btc', 'Refusals 75'),
  (public.t075_u(500), public.t075_u(10), 'btc', 'Legacy 75'),
  (public.t075_u(600), public.t075_u(10), 'btc', 'Bracket 75'),
  (public.t075_u(700), public.t075_u(10), 'btc', 'Late round 75'),
  (public.t075_u(900), public.t075_u(20), 'btc', 'Other org event 75');
insert into btc_teams (id, event_id, name, country_code) values
  (public.t075_u(1), public.t075_u(200), 'T1', 'BN'), (public.t075_u(2), public.t075_u(200), 'T2', 'BN'),
  (public.t075_u(3), public.t075_u(200), 'T3', 'MY'), (public.t075_u(4), public.t075_u(200), 'T4', 'ID'),
  (public.t075_u(5), public.t075_u(200), 'T5', null), (public.t075_u(6), public.t075_u(200), 'T6', 'SG');
insert into btc_judges (id, event_id, name, country_code) values
  (public.t075_u(11), public.t075_u(200), 'J11', 'BN'), (public.t075_u(12), public.t075_u(200), 'J12', 'MY'),
  (public.t075_u(13), public.t075_u(200), 'J13', null), (public.t075_u(14), public.t075_u(200), 'J14', 'SG'),
  (public.t075_u(15), public.t075_u(200), 'J15', null), (public.t075_u(16), public.t075_u(200), 'J16', null);
-- E3 = 300: four teams, four judges, for the refusals
insert into btc_teams (id, event_id, name) values
  (public.t075_u(31), public.t075_u(300), 'R1'), (public.t075_u(32), public.t075_u(300), 'R2'),
  (public.t075_u(33), public.t075_u(300), 'R3'), (public.t075_u(34), public.t075_u(300), 'R4');
insert into btc_judges (id, event_id, name) values
  (public.t075_u(41), public.t075_u(300), 'K1'), (public.t075_u(42), public.t075_u(300), 'K2'),
  (public.t075_u(43), public.t075_u(300), 'K3'), (public.t075_u(44), public.t075_u(300), 'K4');
-- E5 = 500: an UNNUMBERED preliminary match (an older or demo event) counts as round 1
insert into btc_teams (id, event_id, name) values
  (public.t075_u(51), public.t075_u(500), 'L1'), (public.t075_u(52), public.t075_u(500), 'L2');
insert into btc_judges (id, event_id, name) values
  (public.t075_u(61), public.t075_u(500), 'LJ1'), (public.t075_u(62), public.t075_u(500), 'LJ2'), (public.t075_u(63), public.t075_u(500), 'LJ3');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  (public.t075_u(551), public.t075_u(500), 'preliminary', public.t075_u(51), public.t075_u(52));
-- E6 = 600: a bracket exists
insert into btc_teams (id, event_id, name) values
  (public.t075_u(71), public.t075_u(600), 'B1'), (public.t075_u(72), public.t075_u(600), 'B2');
insert into btc_judges (id, event_id, name) values
  (public.t075_u(81), public.t075_u(600), 'BJ1'), (public.t075_u(82), public.t075_u(600), 'BJ2'), (public.t075_u(83), public.t075_u(600), 'BJ3');
insert into btc_bracket_slots (id, event_id, round, slot_label) values (public.t075_u(691), public.t075_u(600), 'final', 'F75');
-- E7 = 700: two teams and three judges; nothing drawn (round 2 asked first)
insert into btc_teams (id, event_id, name) values
  (public.t075_u(91), public.t075_u(700), 'D1'), (public.t075_u(92), public.t075_u(700), 'D2');
insert into btc_judges (id, event_id, name) values
  (public.t075_u(95), public.t075_u(700), 'DJ1'), (public.t075_u(96), public.t075_u(700), 'DJ2'), (public.t075_u(97), public.t075_u(700), 'DJ3');
-- the other organisation's event, for the non-member
insert into btc_teams (id, event_id, name) values
  (public.t075_u(901), public.t075_u(900), 'O1'), (public.t075_u(902), public.t075_u(900), 'O2');
insert into btc_judges (id, event_id, name) values
  (public.t075_u(911), public.t075_u(900), 'OJ1'), (public.t075_u(912), public.t075_u(900), 'OJ2'), (public.t075_u(913), public.t075_u(900), 'OJ3');
-- a draw row in the other organisation, to prove a non-member reads nothing
insert into btc_round_draws (event_id, prelim_round, mode, seed, match_count)
  values (public.t075_u(900), 1, 'random', 'x', 1);

-- ---------- the object and its grants ----------

select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_btc_round'), 1,
  'create_btc_round has exactly one overload');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_btc_match'), 1,
  'and so does create_btc_match (the old 5-argument form is gone)');
select is(has_function_privilege('anon', 'public.create_btc_round(uuid,uuid,smallint,text,text,jsonb,boolean)', 'execute'), false,
  'anon cannot execute create_btc_round');
select is(has_function_privilege('authenticated', 'public.create_btc_round(uuid,uuid,smallint,text,text,jsonb,boolean)', 'execute'), true,
  'a signed-in caller can');
select is((select prosecdef from pg_proc where proname = 'create_btc_round'), false, 'it is SECURITY INVOKER');
select is(has_function_privilege('anon', 'public.create_btc_match(uuid,text,uuid,uuid,uuid[],smallint)', 'execute'), false,
  'anon cannot execute the widened create_btc_match either');
select is((select relrowsecurity from pg_class where oid = 'public.btc_round_draws'::regclass), true, 'btc_round_draws has RLS on');
select is(has_table_privilege('anon', 'public.btc_round_draws', 'select'), false, 'anon has no privilege on the draw record');
select is(has_column_privilege('authenticated', 'public.btc_round_draws', 'created_by', 'insert'), false,
  'a client cannot name created_by');
select is(has_column_privilege('authenticated', 'public.btc_round_draws', 'created_at', 'insert'), false,
  'or created_at');
select is(has_table_privilege('authenticated', 'public.btc_round_draws', 'update'), false,
  'and nobody can update a draw record (no table or column UPDATE privilege)');
select is((select tgenabled::text from pg_trigger where tgrelid = 'public.btc_round_draws'::regclass and tgname = 'trg_btc_round_draws_event_immutable'),
  'O', 'event_id is frozen by an enabled trigger');

-- ---------- a non-member ----------

set local role authenticated;
set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000002';  -- the outsider

select is(public.t075_hint(900, 1, 'random', 's', jsonb_build_array(public.t075_m(901, 902, 911, 912, 913)), 20),
  'btc_round_event_not_found', 'a non-member naming the other organisation gets the standard not-found');
select is(public.t075_hint(200, 1, 'random', 's', jsonb_build_array(public.t075_m(1, 2, 11, 12, 13)), 10),
  'btc_round_event_not_found', 'a non-member naming an organisation they are not in gets the same refusal');
select is((select count(*)::int from btc_round_draws), 0, 'a non-member reads zero draw records');
select throws_ok(
  $$ insert into btc_round_draws (event_id, prelim_round, mode, seed, match_count)
       values ('75000000-0000-0000-0000-000000000200', 1, 'random', 's', 1) $$,
  '42501', null, 'and cannot insert one');
select is((select count(*)::int from btc_matches where event_id = public.t075_u(200)), 0, 'nothing was created');

-- ---------- a member ----------

set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000001';

select is(public.t075_hint(900, 1, 'random', 's', jsonb_build_array(public.t075_m(901, 902, 911, 912, 913)), 10),
  'btc_round_event_not_found', 'a member naming their organisation with another organisation''s event gets not-found');

-- argument checks
select is(public.t075_hint(300, 0, 'random', 's', jsonb_build_array(public.t075_m(31, 32, 41, 42, 43))),
  'btc_round_invalid', 'round 0 is refused');
select is(public.t075_hint(300, 1, 'lottery', 's', jsonb_build_array(public.t075_m(31, 32, 41, 42, 43))),
  'btc_round_invalid', 'an unknown mode is refused');
select is(public.t075_hint(300, 1, 'random', null, jsonb_build_array(public.t075_m(31, 32, 41, 42, 43))),
  'btc_round_seed_mode', 'a random draw without a seed is refused');
select is(public.t075_hint(300, 1, 'by_results', '', jsonb_build_array(public.t075_m(31, 32, 41, 42, 43))),
  'btc_round_seed_mode', 'an empty seed is refused');
select is(public.t075_hint(300, 1, 'manual', 'x', jsonb_build_array(public.t075_m(31, 32, 41, 42, 43))),
  'btc_round_seed_mode', 'a manual draw with a seed is refused');
select is(public.t075_hint(300, 1, 'random', 's', '[]'::jsonb), 'btc_round_matches_invalid', 'an empty match list is refused');
select is(public.t075_hint(300, 1, 'random', 's', '{"a":1}'::jsonb), 'btc_round_matches_invalid', 'a non-list is refused');

-- every team exactly once
select is(public.t075_hint(300, 1, 'random', 's', jsonb_build_array(public.t075_m(31, 32, 41, 42, 43))),
  'btc_round_incomplete', 'a round that leaves teams out is refused');
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(public.t075_m(31, 32, 41, 42, 43), public.t075_m(31, 33, 41, 42, 44))),
  'btc_round_incomplete', 'a team twice (and another left out) is refused');
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(public.t075_m(31, 32, 41, 42, 43), public.t075_m(33, 901, 41, 42, 44))),
  'btc_round_matches_invalid', 'a team of another event is refused');
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(public.t075_m(31, 31, 41, 42, 43), public.t075_m(33, 34, 41, 42, 44))),
  'btc_round_matches_invalid', 'a team playing itself is refused');

-- 3 distinct judges, of this event
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(public.t075_m(31, 32, 41, 42, 42), public.t075_m(33, 34, 41, 42, 44))),
  'btc_round_matches_invalid', 'a repeated judge is refused');
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(jsonb_build_object('team1_id', public.t075_u(31), 'team2_id', public.t075_u(32),
                        'judge_ids', jsonb_build_array(public.t075_u(41), public.t075_u(42))),
                      public.t075_m(33, 34, 41, 42, 44))),
  'btc_round_matches_invalid', 'two judges are refused');
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(public.t075_m(31, 32, 41, 42, 911), public.t075_m(33, 34, 41, 42, 44))),
  'btc_round_matches_invalid', 'a judge of another event is refused');
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(jsonb_build_object('team1_id', 'not-a-uuid', 'team2_id', public.t075_u(32),
                        'judge_ids', jsonb_build_array(public.t075_u(41), public.t075_u(42), public.t075_u(43))),
                      public.t075_m(33, 34, 41, 42, 44))),
  'btc_round_matches_invalid', 'an id that is not a uuid is refused with a hint, not a cast error');

-- all or nothing: the first match is valid, a later write fails, and NOTHING is left behind
select is((select count(*)::int from btc_matches where event_id = public.t075_u(300)), 0,
  'the refusals above created no match');
reset role;
create function public.t075_boom() returns trigger language plpgsql as $$
begin
  if new.judge_id = public.t075_u(44) then raise exception 'boom: a late write failed'; end if;
  return new;
end $$;
create trigger t075_boom before insert on btc_match_judges for each row execute function public.t075_boom();
set local role authenticated;
set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000001';
select is(public.t075_hint(300, 1, 'random', 's',
    jsonb_build_array(public.t075_m(31, 32, 41, 42, 43), public.t075_m(33, 34, 42, 43, 44))),
  'sqlstate P0001', 'a write that fails after the first match was inserted fails the whole call');
select is((select count(*)::int from btc_matches where event_id = public.t075_u(300)), 0, '...and creates no match');
select is((select count(*)::int from btc_round_draws where event_id = public.t075_u(300)), 0, '...and no draw record');
reset role;
drop trigger t075_boom on btc_match_judges;
set local role authenticated;
set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000001';

-- round 2 asked before anything exists, and in the legacy event
select is(public.t075_hint(700, 2, 'random', 's', jsonb_build_array(public.t075_m(91, 92, 95, 96, 97))),
  'btc_prior_round_open', 'round 2 is refused when round 1 was never drawn');
select is(public.t075_hint(500, 1, 'random', 's', jsonb_build_array(public.t075_m(51, 52, 61, 62, 63))),
  'btc_round_exists', 'an unnumbered preliminary match counts as round 1: round 1 cannot be drawn over it');
select is(public.t075_hint(500, 2, 'random', 's', jsonb_build_array(public.t075_m(51, 52, 61, 62, 63))),
  'btc_prior_round_open', 'and round 2 waits for it to be confirmed');
reset role;
insert into btc_round_draws (event_id, prelim_round, mode, seed, match_count) values (public.t075_u(700), 1, 'random', 'x', 1);
set local role authenticated;
set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000001';
select is(public.t075_hint(700, 1, 'random', 's', jsonb_build_array(public.t075_m(91, 92, 95, 96, 97))),
  'btc_round_exists', 'a draw record with no matches left also blocks the round (a redraw deletes both)');
select is(public.t075_hint(600, 1, 'random', 's', jsonb_build_array(public.t075_m(71, 72, 81, 82, 83))),
  'btc_round_bracket_exists', 'a round cannot be drawn once the bracket exists');

-- ---------- the happy path: round 1 ----------

select is(
  (select count(*)::int from create_btc_round(public.t075_u(10), public.t075_u(200), 1::smallint, 'random', 'seed-r1',
    jsonb_build_array(public.t075_m(1, 2, 13, 15, 16), public.t075_m(3, 4, 13, 14, 15), public.t075_m(5, 6, 11, 12, 13)))),
  3, 'round 1 creates 3 matches');
select is((select count(*)::int from btc_matches where event_id = public.t075_u(200) and prelim_round = 1 and round = 'preliminary'), 3,
  'each carries prelim_round 1');
select is((select count(*)::int from (select team1_id from btc_matches where event_id = public.t075_u(200)
    union all select team2_id from btc_matches where event_id = public.t075_u(200)) x), 6, 'six team places');
select is((select count(distinct t)::int from (select team1_id t from btc_matches where event_id = public.t075_u(200)
    union all select team2_id from btc_matches where event_id = public.t075_u(200)) x), 6, 'every team exactly once');
select is((select min(c)::int from (select count(*) c from btc_match_judges mj join btc_matches m on m.id = mj.match_id
    where m.event_id = public.t075_u(200) group by m.id) x), 3, 'every match has 3 judges');
select is((select string_agg(team1_id::text, ',' order by created_at, id) from btc_matches where event_id = public.t075_u(200)),
  public.t075_u(1)::text || ',' || public.t075_u(3)::text || ',' || public.t075_u(5)::text,
  'the matches come back in draw order (1, 3, 5)');
select is((select count(distinct created_at)::int from btc_matches where event_id = public.t075_u(200)), 3,
  'created_at is distinct per match, so that order is stored and not a tie');
select is((select mode || '/' || seed || '/' || match_count || '/' || avoid_rematches || '/' || conflict_ticks::text
    from btc_round_draws where event_id = public.t075_u(200) and prelim_round = 1),
  'random/seed-r1/3/true/[]', 'the draw record holds the mode, seed, count, avoidance and no conflicts');
select is((select created_by from btc_round_draws where event_id = public.t075_u(200) and prelim_round = 1),
  public.t075_u(1), 'created_by is the caller (a database default)');
reset role;
select cmp_ok((select count(*)::int from score_change_log where org_id = public.t075_u(10) and table_name = 'btc_matches'), '>=', 3,
  'a real event logs each created match in the change log');
set local role authenticated;
set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000001';

-- a second call for the same round is refused, and creates nothing more
select is(public.t075_hint(200, 1, 'random', 'another', jsonb_build_array(public.t075_m(1, 3, 13, 15, 16),
    public.t075_m(2, 5, 13, 14, 15), public.t075_m(4, 6, 11, 12, 13))),
  'btc_round_exists', 'a second call for the same round is refused');
select is((select count(*)::int from btc_matches where event_id = public.t075_u(200)), 3, '...and creates nothing');

-- round 2 waits for round 1 to be confirmed
select is(public.t075_hint(200, 2, 'by_results', 'seed-r2', jsonb_build_array(public.t075_m(1, 3, 11, 13, 15),
    public.t075_m(2, 5, 13, 14, 16), public.t075_m(4, 6, 12, 13, 15))),
  'btc_prior_round_open', 'round 2 is refused until round 1 is confirmed');
reset role;
update btc_matches set status = 'confirmed' where event_id = public.t075_u(200) and status = 'pending' and id in (
  select id from btc_matches where event_id = public.t075_u(200) order by created_at limit 2);
set local role authenticated;
set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000001';
select is(public.t075_hint(200, 2, 'by_results', 'seed-r2', jsonb_build_array(public.t075_m(1, 3, 11, 13, 15),
    public.t075_m(2, 5, 13, 14, 16), public.t075_m(4, 6, 12, 13, 15))),
  'btc_prior_round_open', 'and still refused while one round 1 match is unconfirmed');
reset role;
update btc_matches set status = 'confirmed' where event_id = public.t075_u(200);
set local role authenticated;
set local request.jwt.claim.sub = '75000000-0000-0000-0000-000000000001';

-- round 2: a judge from a team's own country is recorded, not refused
select is(public.t075_hint(200, 2, 'by_results', 'seed-r2', jsonb_build_array(public.t075_m(1, 3, 11, 13, 15),
    public.t075_m(2, 5, 13, 14, 16), public.t075_m(4, 6, 12, 13, 14)), 10, false),
  'ok', 'round 2 is created once round 1 is confirmed, with a judge from a team''s own country');
select is((select conflict_ticks #>> '{0,judge_id}' from btc_round_draws where event_id = public.t075_u(200) and prelim_round = 2),
  public.t075_u(11)::text, 'the database recorded the conflict (judge 11 of Brunei on a Brunei team)');
select is((select jsonb_array_length(conflict_ticks) || '/' || (conflict_ticks #>> '{0,match}') || '/' || avoid_rematches
    from btc_round_draws where event_id = public.t075_u(200) and prelim_round = 2),
  '2/1/false', 'two conflicts, the first in match 1, and the avoid setting is kept');
select is((select (conflict_ticks #>> '{1,match}') || '/' || (conflict_ticks #>> '{1,judge_id}') || '/' || (conflict_ticks #>> '{1,team_id}')
    from btc_round_draws where event_id = public.t075_u(200) and prelim_round = 2),
  '3/' || public.t075_u(14)::text || '/' || public.t075_u(6)::text,
  'the second is judge 14 (SG) on team 6 (SG), the SECOND team of match 3: both teams of a match are checked');
select is((select count(*)::int from btc_matches where event_id = public.t075_u(200) and prelim_round = 2), 3, 'round 2 has its 3 matches');

-- a hand-made correction match carries its round, and only a preliminary match may
select is((select prelim_round::int from create_btc_match(public.t075_u(200), 'preliminary', public.t075_u(1), public.t075_u(3),
    array[public.t075_u(11), public.t075_u(12), public.t075_u(13)], 2::smallint)), 2,
  'create_btc_match with a round number stores it');
select is((select prelim_round from create_btc_match(public.t075_u(200), 'preliminary', public.t075_u(1), public.t075_u(3),
    array[public.t075_u(11), public.t075_u(12), public.t075_u(13)])), null,
  'and without one it is still null (the five-argument call is unchanged)');
select throws_ok(
  $$ select create_btc_match('75000000-0000-0000-0000-000000000200', 'quarterfinal',
       '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000003',
       array['75000000-0000-0000-0000-000000000011'::uuid, '75000000-0000-0000-0000-000000000012'::uuid,
             '75000000-0000-0000-0000-000000000013'::uuid], 2::smallint) $$,
  'P0001', 'create_btc_match: only a preliminary match has a round number', 'a knockout match with a round number is refused');

-- a member cannot edit a draw record, and a delete is how an organiser redraws
select throws_ok(
  $$ update btc_round_draws set mode = 'manual' where event_id = '75000000-0000-0000-0000-000000000200' $$,
  '42501', null, 'a member cannot update a draw record');
delete from btc_round_draws where event_id = public.t075_u(200) and prelim_round = 2;
select is((select count(*)::int from btc_round_draws where event_id = public.t075_u(200) and prelim_round = 2), 0,
  'a member can delete one (the organiser''s way to redraw a round)');

select * from finish();
rollback;
