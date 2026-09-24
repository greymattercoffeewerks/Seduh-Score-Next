-- T-TRUST.1: append-only score-change log.
-- Proves: scored writes are logged with who/old/new; no-op updates and is_test events
-- are not; a change after confirmation is flagged and carries its reason; the log is
-- insert-only for every role (owner included); a non-member (and anon) reads zero
-- rows; deleting an event neither fails on nor erases its history.
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

-- Real Cup Taster event + a rehearsal (is_test) twin
insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Real Event', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Rehearsal', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'btc', 'BTC Event', false);

insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000e1', 'Cupper One'),
  ('00000000-0000-0000-0000-0000000000ef', '00000000-0000-0000-0000-0000000000e2', 'Rehearsal Cupper');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'prelims', 1, 1, 480),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e2', 'prelims', 1, 1, 480);
insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', 1);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 1, 480),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b2', 1, 480);

-- 1. a heat entry on a real event is logged as an insert
insert into ct_heat_entries (id, heat_id, entry_id, station) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000ee', 'Table A');
select is(
  (select count(*)::int from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000a01' and action = 'insert'),
  1, 'inserting a heat entry on a real event writes one insert log row');

-- 2. the same write on an is_test event is not logged
insert into ct_heat_entries (id, heat_id, entry_id, station) values
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000ef', 'Table A');
select is(
  (select count(*)::int from score_change_log where event_id = '00000000-0000-0000-0000-0000000000e2'),
  0, 'is_test events write no log rows');

-- ---------- as the org member ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

update ct_heat_entries set elapsed_secs = 400, time_source = 'manual'
 where id = '00000000-0000-0000-0000-000000000a01';
select is(
  (select new_value ->> 'elapsed_secs' from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000a01' and action = 'update'),
  '400', 'an update logs the new value');
select is(
  (select old_value -> 'elapsed_secs' from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000a01' and action = 'update'),
  'null'::jsonb, 'an update logs the old value (null before the first time was recorded)');
select is(
  (select changed_by from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000a01' and action = 'update'),
  '00000000-0000-0000-0000-000000000001'::uuid, 'the log records who made the change');

-- no-op on scored columns (station is not a scored column): nothing logged
update ct_heat_entries set station = 'Table B' where id = '00000000-0000-0000-0000-000000000a01';
select is(
  (select count(*)::int from score_change_log where row_id = '00000000-0000-0000-0000-000000000a01'),
  2, 'an update that changes no scored column writes no log row');

-- a result before the heat is confirmed: not an after-confirm change
insert into ct_results (id, heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000c1', false);
select is(
  (select after_confirm from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'insert'),
  false, 'a result recorded before confirmation is not flagged after_confirm');

-- confirm the heat, then correct the result silently
update ct_heats set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000f1';
update ct_results set correct = true where id = '00000000-0000-0000-0000-000000000b01';
select is(
  (select after_confirm from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'update'),
  true, 'a change after the heat is confirmed is flagged after_confirm');
select is(
  (select reason from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'update'),
  null, 'an un-reasoned correction has a null reason');

-- and with a reason supplied
select set_config('app.change_reason', 'judge recount', true);
update ct_results set correct = false where id = '00000000-0000-0000-0000-000000000b01';
select is(
  (select count(*)::int from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and reason = 'judge recount'),
  1, 'a supplied reason is recorded on exactly the change that carried it');
select is(
  (select count(*)::int from score_change_log where row_id = '00000000-0000-0000-0000-000000000b01'),
  3, 'the result has three log rows: insert, correction, recount');

-- member sees the log for their org
select ok(
  (select count(*) from score_change_log) >= 5, 'an org member can read the org''s log');

-- insert-only for the authenticated role
select throws_ok($$delete from score_change_log$$, '42501', null, 'authenticated cannot delete log rows');
select throws_ok($$update score_change_log set reason = 'x'$$, '42501', null, 'authenticated cannot update log rows');
select throws_ok(
  $$insert into score_change_log (org_id, event_id, table_name, row_id, action)
    values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1',
            'ct_results', gen_random_uuid(), 'insert')$$,
  '42501', null, 'authenticated cannot insert log rows directly (forged history)');

-- ---------- as a non-member ----------
reset request.jwt.claim.sub;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is((select count(*)::int from score_change_log), 0, 'a non-member reads zero log rows');

-- ---------- as anon ----------
reset role;
set local role anon;
select throws_ok($$select 1 from score_change_log$$, '42501', null, 'anon has no access to the log');
reset role;

-- ---------- append-only even for the table owner ----------
select throws_ok(
  $$update score_change_log set reason = 'tamper'$$, '42501', 'score_change_log is append-only',
  'the owner cannot update log rows');
select throws_ok(
  $$delete from score_change_log$$, '42501', 'score_change_log is append-only',
  'the owner cannot delete log rows');
select throws_ok(
  $$truncate score_change_log$$, '42501', 'score_change_log is append-only',
  'the owner cannot truncate the log');

-- ---------- BTC: vote replace-all and match state ----------
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-0000000000e3', 'Team A'),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-0000000000e3', 'Team B');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-0000000000e3', 'preliminary',
   '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000c02');
insert into btc_cup_votes (id, match_id, cup_number, team1_tokens) values
  ('00000000-0000-0000-0000-000000000e01', '00000000-0000-0000-0000-000000000d01', 1, 2);
update btc_matches set status = 'confirmed' where id = '00000000-0000-0000-0000-000000000d01';
update btc_cup_votes set team1_tokens = 3 where id = '00000000-0000-0000-0000-000000000e01';
select is(
  (select (old_value ->> 'team1_tokens') || '->' || (new_value ->> 'team1_tokens') || ':' || after_confirm::text
     from score_change_log where row_id = '00000000-0000-0000-0000-000000000e01' and action = 'update'),
  '2->3:true', 'a BTC token change after the match is confirmed logs old->new and is flagged');

-- ---------- deleting an event neither fails nor erases history ----------
create temp table _before as
  select count(*)::int as n from score_change_log where event_id = '00000000-0000-0000-0000-0000000000e1';
select lives_ok(
  $$delete from events where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'deleting an event with logged history succeeds');
select is(
  (select count(*)::int from score_change_log where event_id = '00000000-0000-0000-0000-0000000000e1'),
  (select n from _before), 'the deleted event''s history is intact and cascade deletes added no rows');

select * from finish();
rollback;
