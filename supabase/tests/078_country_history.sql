-- T-CTY.1: the country-pages database (20261113120000_country_history.sql).
-- Proves: nobody but the owner can read or write the two historical tables (no table grant, no policy: anon, signed-in
-- callers and the service role are refused); the two doors are the only way in, run by anon and signed-in callers only,
-- SECURITY DEFINER with an empty search_path and STABLE; an UNLISTED row (and its round scores) is invisible through
-- both doors, and a country whose rows are all unlisted is indistinguishable from one that was never loaded; an unknown,
-- malformed, empty or NULL country gets an empty record with the same keys as a real one, never an error; no id, path
-- or reference to the source leaks; every row carries the provenance 'organiser_archive' and nothing says 'seduh_score'
-- yet; a row without a permission reference (NULL or blank) cannot exist; the stage, round, competition, placement,
-- score and pairing rules are enforced by the database; the import's upsert updates a row instead of duplicating it;
-- and every derived figure (championships, entries, teams, matches won and lost, best finish, team years) is right on
-- a small fictional fixture.
-- All fixtures use the user-assigned ISO codes XA, XB and XC (never a real country) so the file also passes on a local
-- database into which the real results have been loaded for a hand check; every assertion is limited to those codes.
-- Fixture XA (listed): 2023 Alpha champion (1), Beta final (2); 2024 Alpha quarter-final, Epsilon quarter-final.
--   matches with a known opponent: Alpha won SF 12-9 and the final 13-12; Beta lost that final 12-13; Alpha lost a
--   QF 10-14 in 2024; Epsilon drew a QF 8-8 (counts for neither). So: 2 championships, 4 entries, 3 teams, 2 won, 2 lost.
-- Fixture XB: Shown (listed) and Hidden (unlisted, with a round score 97 that must never appear).
-- Fixture XC: one team, unlisted.
begin;
select plan(78);

-- ============ fixtures (as postgres) ============

insert into app.historical_results
  (id, competition, competition_name, edition_year, host_city, host_country_code, team_name, country_code,
   stage_reached, placement, source_ref, supplied_by, supplied_on, permission_ref, listed)
values
  ('00000000-0000-0000-0000-000000007801', 'btc', 'Fictional Cup 2023', 2023, 'Testville', 'XB', 'Alpha', 'XA', 'champion', 1,
   'fictional.csv#1', 'Fictional Federation', '2026-01-01', 'Fictional Federation, 2026-01-01: test', true),
  ('00000000-0000-0000-0000-000000007802', 'btc', 'Fictional Cup 2023', 2023, 'Testville', 'XB', 'Beta', 'XA', 'final', 2,
   'fictional.csv#2', 'Fictional Federation', '2026-01-01', 'Fictional Federation, 2026-01-01: test', true),
  ('00000000-0000-0000-0000-000000007803', 'btc', 'Fictional Cup 2024', 2024, 'Testburg', 'XB', 'Alpha', 'XA', 'quarter_final', null,
   'fictional.csv#3', 'Fictional Federation', '2026-01-01', 'Fictional Federation, 2026-01-01: test', true),
  ('00000000-0000-0000-0000-000000007804', 'btc', 'Fictional Cup 2024', 2024, 'Testburg', 'XB', 'Epsilon', 'XA', 'quarter_final', null,
   'fictional.csv#4', 'Fictional Federation', '2026-01-01', 'Fictional Federation, 2026-01-01: test', true),
  ('00000000-0000-0000-0000-000000007805', 'btc', 'Fictional Cup 2023', 2023, null, null, 'Shown', 'XB', 'preliminary', null,
   'fictional.csv#5', 'Fictional Federation', '2026-01-01', 'Fictional Federation, 2026-01-01: test', true),
  ('00000000-0000-0000-0000-000000007806', 'btc', 'Fictional Cup 2023', 2023, null, null, 'Hidden', 'XB', 'semi_final', 3,
   'fictional.csv#6', 'Fictional Federation', '2026-01-01', 'Fictional Federation, 2026-01-01: test', false),
  ('00000000-0000-0000-0000-000000007807', 'btc', 'Fictional Cup 2023', 2023, null, null, 'Lonely', 'XC', 'preliminary', null,
   'fictional.csv#7', 'Fictional Federation', '2026-01-01', 'Fictional Federation, 2026-01-01: test', false);

insert into app.historical_round_scores (result_id, round, r1, r2, score, opponent_team_name, opponent_score) values
  -- Alpha 2023, given out of playing order on purpose
  ('00000000-0000-0000-0000-000000007801', 'final_champion', null, null, 13, 'Beta', 12),
  ('00000000-0000-0000-0000-000000007801', 'preliminary', null, null, 20, null, null),
  ('00000000-0000-0000-0000-000000007801', 'semi_final', null, null, 12, 'Delta', 9),
  ('00000000-0000-0000-0000-000000007801', 'quarter_final', null, null, 15, null, null),
  ('00000000-0000-0000-0000-000000007802', 'final_champion', null, null, 12, 'Alpha', 13),
  ('00000000-0000-0000-0000-000000007803', 'preliminary', 5, 6, 11, null, null),
  ('00000000-0000-0000-0000-000000007803', 'quarter_final', null, null, 10, 'Gamma', 14),
  ('00000000-0000-0000-0000-000000007804', 'quarter_final', null, null, 8, 'Zeta', 8),
  ('00000000-0000-0000-0000-000000007806', 'semi_final', null, null, 97, 'Nobody', 96);

-- ============ nobody but the owner touches the tables ============

select is(
  (select count(*)::int from pg_policies where schemaname = 'app' and tablename in ('historical_results', 'historical_round_scores')),
  0, 'neither table has a policy');
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'app'::regnamespace and c.relname in ('historical_results', 'historical_round_scores') and c.relrowsecurity),
  2, 'both tables have row-level security on');
select is(
  (select coalesce(string_agg(r || '/' || t || '/' || p, ', '), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['app.historical_results', 'app.historical_round_scores']) t,
          unnest(array['select', 'insert', 'update', 'delete']) p
    where has_table_privilege(r, t, p)),
  'none', 'anon, authenticated and the service role hold no privilege on either table');

set local role anon;
select throws_ok($$ select count(*) from app.historical_results $$, '42501', null, 'anon cannot read the results table');
select throws_ok($$ select count(*) from app.historical_round_scores $$, '42501', null, 'anon cannot read the round scores table');
select throws_ok($$ insert into app.historical_results (competition) values ('btc') $$, '42501', null, 'anon cannot write the results table');
reset role;
set local role authenticated;
select throws_ok($$ select count(*) from app.historical_results $$, '42501', null, 'a signed-in caller cannot read the results table');
select throws_ok($$ update app.historical_results set listed = true $$, '42501', null, 'a signed-in caller cannot write the results table');
reset role;
set local role service_role;
select throws_ok($$ select count(*) from app.historical_results $$, '42501', null, 'even the service role cannot read the results table through the API');
reset role;

-- ============ the doors: privileges and shape ============

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('public_country_record', 'public_country_index')
      and p.prosecdef and p.provolatile = 's' and coalesce(p.proconfig @> array['search_path=""'], false)),
  'public_country_index(), public_country_record(text)',
  'both doors exist, are SECURITY DEFINER and STABLE, with search_path pinned to the empty string');
select is(
  (select coalesce(string_agg(p.proname || '/' || r, ', ' order by p.proname, r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('public_country_record', 'public_country_index')
      and not has_function_privilege(r, p.oid, 'execute')),
  'none', 'anon and signed-in callers can run both doors');
select is(
  (select coalesce(string_agg(p.proname, ', '), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('public_country_record', 'public_country_index')
      and (has_function_privilege('service_role', p.oid, 'execute')
           or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  'none', 'the service role and PUBLIC have no execute on either door (only the two named roles do)');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('public_country_record', 'public_country_index')
      and (select count(*) from aclexplode(p.proacl) a) <> 3),
  0, 'each door ACL is exactly the owner, anon and authenticated');
select is(
  (select coalesce(string_agg(c.relname, ', '), 'none') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relname ~* 'historical'),
  'none', 'nothing about historical results exists in public (the tables are in app, the doors are functions)');

-- the stage order function
select is(
  (select array_agg(s order by app.historical_stage_order(s) desc)
     from unnest(array['preliminary', 'champion', 'entered', 'final', 'quarter_final', 'semi_final']) s),
  array['champion', 'final', 'semi_final', 'quarter_final', 'preliminary', 'entered'],
  'the stage order function ranks champion above final above semi_final above quarter_final above preliminary above entered');
select is(app.historical_stage_order('bronze'), null::smallint, 'an unknown stage has no rank');
select is(
  (select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'app.historical_stage_order(text)', 'execute')),
  'none', 'no API role can run the stage order function');

-- ============ reading through the doors, as anon ============

create temp table t78_xa on commit drop as select public.public_country_record('XA') as r;
create temp table t78_xb on commit drop as select public.public_country_record('XB') as r;
create temp table t78_xc on commit drop as select public.public_country_record('XC') as r;
create temp table t78_zz on commit drop as select public.public_country_record('ZZ') as r;
create temp table t78_idx on commit drop as select public.public_country_index() as r;
grant select on t78_xa, t78_idx to anon;

-- the doors are run by anon itself and give the same answer
set local role anon;
select is((select public.public_country_record('XA')), (select r from t78_xa), 'anon calling the door gets the record read above');
select is((select public.public_country_index()), (select r from t78_idx), 'and the index');
reset role;

select is((select r ->> 'country_code' from t78_xa), 'XA', 'anon reads the record of a country through the door');
select is((select (r ->> 'has_record')::boolean from t78_xa), true, 'a listed country has a record');
select is(
  (select r -> 'stats' from t78_xa),
  jsonb_build_object('championships', 2, 'entries', 4, 'teams', 3, 'matches_won', 2, 'matches_lost', 2,
    'best_finish', jsonb_build_object('team_name', 'Alpha', 'competition', 'btc', 'edition_year', 2023,
                                      'stage_reached', 'champion', 'placement', 1)),
  'the derived stats are right: 2 championships, 4 entries, 3 teams, 2 matches won, 2 lost (a level score counts for neither), best finish Alpha 2023 champion');
select is(
  (select array_agg((c ->> 'edition_year')::int order by o) from t78_xa, jsonb_array_elements(r -> 'championships') with ordinality as e(c, o)),
  array[2024, 2023], 'championships are listed newest first');
select is(
  (select array_agg(t ->> 'team_name' order by o)
     from t78_xa, jsonb_array_elements(r -> 'championships' -> 1 -> 'teams') with ordinality as e(t, o)),
  array['Alpha', 'Beta'], 'within a championship the furthest team comes first');
select is(
  (select array_agg(x ->> 'round' order by o)
     from t78_xa, jsonb_array_elements(r -> 'championships' -> 1 -> 'teams' -> 0 -> 'rounds') with ordinality as e(x, o)),
  array['preliminary', 'quarter_final', 'semi_final', 'final_champion'],
  'a team''s rounds come in playing order whatever order they were inserted in');
select is(
  (select r -> 'championships' -> 1 -> 'teams' -> 0 -> 'rounds' -> 3 from t78_xa),
  jsonb_build_object('round', 'final_champion', 'r1', null, 'r2', null, 'score', 13, 'opponent_team_name', 'Beta', 'opponent_score', 12),
  'a round carries its score and its published pairing');
select is(
  (select r -> 'championships' -> 0 -> 'teams' -> 0 -> 'rounds' -> 0 from t78_xa),
  jsonb_build_object('round', 'preliminary', 'r1', 5, 'r2', 6, 'score', 11, 'opponent_team_name', null, 'opponent_score', null),
  'two summed rounds are shown as r1 and r2 beside the total');
select is(
  (select jsonb_agg(t - 'provenance' order by o) from t78_xa, jsonb_array_elements(r -> 'teams') with ordinality as e(t, o)),
  jsonb_build_array(
    jsonb_build_object('team_name', 'Alpha', 'years', jsonb_build_array(2023, 2024), 'best_stage', 'champion', 'best_placement', 1),
    jsonb_build_object('team_name', 'Beta', 'years', jsonb_build_array(2023), 'best_stage', 'final', 'best_placement', 2),
    jsonb_build_object('team_name', 'Epsilon', 'years', jsonb_build_array(2024), 'best_stage', 'quarter_final', 'best_placement', null)),
  'the teams list gives each team''s years and best stage, furthest first');
select is(
  (select r -> 'championships' -> 0 ->> 'host_city' from t78_xa), 'Testburg', 'the host city is shown');

-- listed and unlisted
select is(
  (select array_agg(t ->> 'team_name') from t78_xb, jsonb_array_elements(r -> 'teams') t),
  array['Shown'], 'an unlisted team is invisible in the record of its country');
select is(
  (select (r::text ~ '97|Hidden') from t78_xb), false, 'and so is its round score');
select is(
  (select (r ->> 'has_record')::boolean from t78_xc), false, 'a country whose every row is unlisted has no record');
select is(
  (select r -> 'stats' ->> 'entries' from t78_xc), '0', 'and its counts are zero');
select is(
  (select array_agg(c ->> 'country_code' order by c ->> 'country_code')
     from t78_idx, jsonb_array_elements(r -> 'countries') c where c ->> 'country_code' in ('XA', 'XB', 'XC')),
  array['XA', 'XB'], 'the index lists the countries with a listed row and not a country with none');
select is(
  (select c - 'country_code' from t78_idx, jsonb_array_elements(r -> 'countries') c where c ->> 'country_code' = 'XA'),
  jsonb_build_object('championships', 2, 'entries', 4, 'teams', 3, 'provenance', 'organiser_archive'),
  'the index counts are derived: 2 championships, 4 entries, 3 teams');
select is(
  (select c ->> 'entries' from t78_idx, jsonb_array_elements(r -> 'countries') c where c ->> 'country_code' = 'XB'),
  '1', 'the index counts only listed rows');
select is(
  (select array_agg(k order by k) from t78_idx, jsonb_object_keys(r) k), array['countries'], 'the index has one key');

-- unknown, malformed, empty, NULL: an empty record of the same shape, never an error
select is((select (r ->> 'has_record')::boolean from t78_zz), false, 'an unknown country has no record');
select is(
  (select array_agg(k order by k) from t78_zz, jsonb_object_keys(r) k),
  (select array_agg(k order by k) from t78_xa, jsonb_object_keys(r) k),
  'an empty record has exactly the keys of a real one');
select is(
  (select array_agg(k order by k) from t78_zz, jsonb_object_keys(r -> 'stats') k),
  (select array_agg(k order by k) from t78_xa, jsonb_object_keys(r -> 'stats') k),
  'and the same stats keys');
select is(
  (select r -> 'championships' from t78_zz), '[]'::jsonb, 'with no championships');
select is(
  (select r -> 'stats' from t78_zz),
  jsonb_build_object('championships', 0, 'entries', 0, 'teams', 0, 'matches_won', 0, 'matches_lost', 0, 'best_finish', null),
  'and zero stats');
select is(
  (select r - 'country_code' from t78_xc), (select r - 'country_code' from t78_zz),
  'a country that is entirely unlisted is indistinguishable from one never loaded (apart from the echoed code)');
set local role anon;
select lives_ok($$ select public.public_country_record('') $$, 'an empty code is not an error');
select lives_ok($$ select public.public_country_record(null) $$, 'a NULL code is not an error');
select lives_ok($$ select public.public_country_record('x''; drop table app.historical_results; --') $$, 'a hostile code is not an error');
select is((select public.public_country_record('x''; drop table') ->> 'country_code'), null, 'and it is not echoed back');
select is((select public.public_country_record(' xa ') ->> 'country_code'), 'XA', 'a code is trimmed and upper-cased');
select is((select public.public_country_record('XAB') ->> 'has_record'), 'false', 'a three-letter code matches nothing');
reset role;

-- no leak
select is(
  (select (r::text ~ '"(id|result_id|permission_ref|source_ref|supplied_on|listed|created_at|updated_at|org_id|event_id|phone|email)"') from t78_xa),
  false, 'the record carries no id, reference, date of supply, organisation or event key');
select is(
  (select (r::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|fictional\.csv|Fictional Federation, 2026') from t78_xa),
  false, 'and no uuid, no source file and no permission text appears anywhere in it');
select is(
  (select (r::text ~ '"(id|permission_ref|source_ref|listed)"') from t78_idx), false, 'the index leaks nothing either');
select is(
  (select array_agg(distinct v) from t78_xa, jsonb_path_query(r, 'strict $.**.provenance') v),
  array['"organiser_archive"'::jsonb], 'every provenance in a record is organiser_archive (no live source is wired yet)');
select is(
  (select array_agg(distinct v) from t78_idx, jsonb_path_query(r, 'strict $.**.provenance') v),
  array['"organiser_archive"'::jsonb], 'and in the index');
select is(
  (select r -> 'championships' -> 0 ->> 'supplied_by' from t78_xa), 'Fictional Federation',
  'the organiser is named as the supplier');

-- ============ the database refuses what the rules forbid ============

select throws_ok(
  $$ insert into app.historical_results (competition, competition_name, edition_year, team_name, country_code, stage_reached, source_ref, supplied_by, supplied_on, permission_ref)
     values ('btc', 'C', 2023, 'NoPermission', 'XA', 'preliminary', 'f.csv#1', 'F', '2026-01-01', null) $$,
  '23502', null, 'a row without a permission reference cannot be inserted (NULL)');
select throws_ok(
  $$ insert into app.historical_results (competition, competition_name, edition_year, team_name, country_code, stage_reached, source_ref, supplied_by, supplied_on, permission_ref)
     values ('btc', 'C', 2023, 'BlankPermission', 'XA', 'preliminary', 'f.csv#1', 'F', '2026-01-01', '   ') $$,
  '23514', null, 'nor a blank one');
select throws_ok(
  $$ update app.historical_results set permission_ref = null where id = '00000000-0000-0000-0000-000000007801' $$,
  '23502', null, 'and the reference cannot be removed from a loaded row');

create function pg_temp.try_result(p_comp text, p_year int, p_team text, p_country text, p_stage text, p_place int) returns text
language plpgsql as $$
begin
  insert into app.historical_results (competition, competition_name, edition_year, team_name, country_code, stage_reached, placement,
                                      source_ref, supplied_by, supplied_on, permission_ref)
  values (p_comp, 'C', p_year, p_team, p_country, p_stage, p_place, 'f.csv#1', 'F', '2026-01-01', 'P');
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate || ' ' || coalesce(substring(sqlerrm from 'constraint "([a-z0-9_]+)"'), sqlerrm);
end $$;

select is(pg_temp.try_result('btc', 2023, 'T1', 'XA', 'preliminary', null), 'ok', 'control: a valid row passes the checker');
select is(pg_temp.try_result('btc', 2023, 'T2', 'XA', 'bronze', null), '23514 historical_results_stage_vocab', 'an unknown stage is refused');
select is(pg_temp.try_result('xyz', 2023, 'T3', 'XA', 'preliminary', null), '23514 historical_results_competition_vocab', 'an unknown competition is refused (BTC only)');
select is(pg_temp.try_result('btc', 2023, 'T4', 'xa', 'preliminary', null), '23514 historical_results_country_shape', 'a country code must be two capital letters');
select is(pg_temp.try_result('btc', 2023, 'T5', 'XA', 'semi_final', 5), '23514 historical_results_placement_matches_stage', 'a placement above 4 is refused');
select is(pg_temp.try_result('btc', 2023, 'T6', 'XA', 'final', 1), '23514 historical_results_placement_matches_stage', 'a placement that contradicts the stage is refused');
select is(pg_temp.try_result('btc', 1999, 'T7', 'XA', 'preliminary', null), '23514 historical_results_edition_year_range', 'a year before 2000 is refused');
select is(pg_temp.try_result('btc', 2023, 'Alpha', 'XA', 'preliminary', null), '23505 historical_results_natural_key', 'the same team, country, competition and year cannot be loaded twice');

create function pg_temp.try_round(p_round text, p_r1 int, p_r2 int, p_score int, p_opp text, p_opp_score int) returns text
language plpgsql as $$
begin
  insert into app.historical_round_scores (result_id, round, r1, r2, score, opponent_team_name, opponent_score)
  values ('00000000-0000-0000-0000-000000007805', p_round, p_r1, p_r2, p_score, p_opp, p_opp_score);
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate || ' ' || coalesce(substring(sqlerrm from 'constraint "([a-z0-9_]+)"'), sqlerrm);
end $$;

select is(pg_temp.try_round('preliminary', 10, 12, 22, null, null), 'ok', 'control: a valid round passes the checker');
select is(pg_temp.try_round('wild_card', null, null, 5, null, null), '23514 historical_round_scores_round_vocab', 'an unknown round is refused');
select is(pg_temp.try_round('preliminary', 10, 12, 23, null, null), '23514 historical_round_scores_r1_r2_total', 'round one plus round two must equal the total');
select is(pg_temp.try_round('preliminary', 10, null, 10, null, null), '23514 historical_round_scores_r1_r2_pair', 'round one without round two is refused');
select is(pg_temp.try_round('semi_final', null, null, 12, 'Delta', null), '23514 historical_round_scores_opponent_pair', 'an opponent without a score is refused');
select is(pg_temp.try_round('semi_final', null, null, -1, null, null), '23514 historical_round_scores_nonnegative', 'a negative score is refused');
select is(pg_temp.try_round('quarter_final', null, null, 1, null, null) , 'ok', 'control: another round of the same result');

-- ============ the import's upsert updates, never duplicates ============

insert into app.historical_results
  (competition, competition_name, edition_year, team_name, country_code, stage_reached, placement, source_ref, supplied_by, supplied_on, permission_ref)
values ('btc', 'Fictional Cup 2024', 2024, 'Epsilon', 'XA', 'semi_final', 3, 'fictional.csv#4', 'Fictional Federation', '2026-02-02', 'Fictional Federation, 2026-02-02: corrected')
on conflict (competition, edition_year, country_code, team_name) do update
  set stage_reached = excluded.stage_reached, placement = excluded.placement, source_ref = excluded.source_ref,
      permission_ref = excluded.permission_ref;
select is(
  (select count(*)::int from app.historical_results where team_name = 'Epsilon' and country_code = 'XA' and edition_year = 2024),
  1, 're-importing a corrected row leaves one row');
select is(
  (select stage_reached || '/' || placement || '/' || listed from app.historical_results where id = '00000000-0000-0000-0000-000000007804'),
  'semi_final/3/true', 'and the same row now holds the correction (and a re-import does not touch listed)');

update app.historical_results set listed = false where id = '00000000-0000-0000-0000-000000007804';
select is(
  (select (public.public_country_record('XA') -> 'stats' ->> 'entries')::int), 3, 'unlisting a row takes it out of the record at once');
select is(
  (select (c ->> 'entries')::int from jsonb_array_elements(public.public_country_index() -> 'countries') c where c ->> 'country_code' = 'XA'),
  3, 'and out of the index');

delete from app.historical_results where id = '00000000-0000-0000-0000-000000007801';
select is(
  (select count(*)::int from app.historical_round_scores where result_id = '00000000-0000-0000-0000-000000007801'),
  0, 'owner SQL that deletes a result takes its round scores with it');

select * from finish();
rollback;
