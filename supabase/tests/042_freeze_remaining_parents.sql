-- T-TEN.E1 finding: btc_seeding_tiebreaks and score_change_counts freeze their parent columns.
-- Run as postgres (the table owner), so a missing column privilege cannot be what refuses: it is the trigger.
-- Proves: a seeding tiebreak cannot be re-pointed at another event (of the same organisation or another one) or at
-- another team; its reason and rank can still be edited; an audit counter cannot be re-pointed at another event or
-- another table name; the counters can still be bumped with ON CONFLICT DO UPDATE, the way the definer functions do.
begin;
select plan(9);

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'A1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'A2'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'B1');
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a1', 'A one'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000a1', 'A two'),
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000b1', 'B one');
insert into btc_seeding_tiebreaks (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000a01', 10, 1, 2, 1, 'first');
insert into score_change_counts (event_id, table_name, n) values
  ('00000000-0000-0000-0000-0000000000a1', 'ct_results', 1);

select throws_ok(
  $$ update btc_seeding_tiebreaks set event_id = '00000000-0000-0000-0000-0000000000b1' $$,
  '23001', 'btc_seeding_tiebreaks.event_id is immutable',
  'a seeding tiebreak cannot be moved to another organisation''s event');
select throws_ok(
  $$ update btc_seeding_tiebreaks set event_id = '00000000-0000-0000-0000-0000000000a2' $$,
  '23001', 'btc_seeding_tiebreaks.event_id is immutable',
  'nor to another event of the same organisation');
select throws_ok(
  $$ update btc_seeding_tiebreaks set team_id = '00000000-0000-0000-0000-000000000a02' $$,
  '23001', 'btc_seeding_tiebreaks.team_id is immutable',
  'nor re-pointed at another team');
select lives_ok(
  $$ update btc_seeding_tiebreaks set reason = 'edited', tiebreak_rank = 2 $$,
  'but its reason and rank can still be edited');
select throws_ok(
  $$ update score_change_counts set event_id = '00000000-0000-0000-0000-0000000000b1' $$,
  '23001', 'score_change_counts.event_id is immutable',
  'an audit counter cannot be moved to another event');
select throws_ok(
  $$ update score_change_counts set table_name = 'ct_heats' $$,
  '23001', 'score_change_counts.table_name is immutable',
  'nor to another table name');
select lives_ok(
  $$ insert into score_change_counts (event_id, table_name, n)
       values ('00000000-0000-0000-0000-0000000000a1', 'ct_results', 1)
       on conflict (event_id, table_name) do update set n = score_change_counts.n + 1 $$,
  'but a counter can still be bumped with ON CONFLICT DO UPDATE, as the definer functions do');
select is((select n::int from score_change_counts where event_id = '00000000-0000-0000-0000-0000000000a1'), 2, 'and it counted');
select is(
  (select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid in ('btc_seeding_tiebreaks'::regclass, 'score_change_counts'::regclass)
      and not t.tgisinternal and p.proname = 'forbid_parent_change' and t.tgenabled <> 'D'),
  2,
  'one enabled freeze trigger on each of the two tables');

select * from finish();
rollback;
