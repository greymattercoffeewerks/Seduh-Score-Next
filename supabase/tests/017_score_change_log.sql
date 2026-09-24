-- T-TRUST.1: append-only score-change log.
-- Proves: every logged table's writes are captured with who / old / new / context;
-- no-op and same-value updates and is_test events write nothing; the is_test skip
-- cannot be used as a bypass (flips are themselves logged); a change after
-- confirmation is flagged and carries its (unverified) reason; the real RPCs
-- (confirm_heat, confirm_btc_match) log correctly through the trigger; the log is
-- insert-only for every role and tamper-evident for the owner; a non-member, a member
-- of ANOTHER org, and anon each read zero of an org's rows; deleting an event neither
-- fails on nor erases its history, and the deletion itself is recorded.
begin;
select plan(51);

-- ---------- fixtures (as postgres, bypasses RLS) ----------

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

insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Real Event', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Rehearsal', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'btc', 'BTC Event', false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000020', 'btc', 'Other Org BTC', false);

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

-- 2. the context identifies the row; a superuser/SQL write has no changed_by
select is(
  (select context from score_change_log where row_id = '00000000-0000-0000-0000-000000000a01'),
  jsonb_build_object('heat_id', '00000000-0000-0000-0000-0000000000f1',
                     'entry_id', '00000000-0000-0000-0000-0000000000ee'),
  'the log row records which heat and entry it belongs to');
select is(
  (select changed_by from score_change_log where row_id = '00000000-0000-0000-0000-000000000a01'),
  null, 'a write with no signed-in user records changed_by as null');

-- 3. the same write on an is_test event is not logged
insert into ct_heat_entries (id, heat_id, entry_id, station) values
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000ef', 'Table A');
select is(
  (select count(*)::int from score_change_log where event_id = '00000000-0000-0000-0000-0000000000e2'),
  0, 'is_test events write no log rows');

-- 4. stage config and stage-entry provenance (tiebreak / coin-toss outcomes)
insert into ct_stage_entries (id, stage_id, entry_id) values
  ('00000000-0000-0000-0000-000000000a51', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ee');
update ct_stage_entries set final_position = 1, position_note = 'coin toss, witnessed'
  where id = '00000000-0000-0000-0000-000000000a51';
select is(
  (select new_value ->> 'position_note' from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000a51' and action = 'update'),
  'coin toss, witnessed', 'a stage entry''s final position / note change is logged');
update ct_stages set cutoff = 4 where id = '00000000-0000-0000-0000-0000000000b1';
select is(
  (select (new_value ->> 'cutoff') from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000b1' and table_name = 'ct_stages' and action = 'update'),
  '4', 'a stage''s cutoff change is logged');

-- 5. BTC fixtures: a match with 3 judges, plus a bracket slot
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-0000000000e3', 'Team A'),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-0000000000e3', 'Team B'),
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-0000000000e4', 'Other A'),
  ('00000000-0000-0000-0000-000000000c04', '00000000-0000-0000-0000-0000000000e4', 'Other B');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-0000000000e3', 'J1'),
  ('00000000-0000-0000-0000-000000000f02', '00000000-0000-0000-0000-0000000000e3', 'J2'),
  ('00000000-0000-0000-0000-000000000f03', '00000000-0000-0000-0000-0000000000e3', 'J3');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-0000000000e3', 'preliminary',
   '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000c02'),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-0000000000e4', 'preliminary',
   '00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000c04');
insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000f01'),
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000f02'),
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000f03');
insert into btc_bracket_slots (id, event_id, round, slot_label) values
  ('00000000-0000-0000-0000-000000000a61', '00000000-0000-0000-0000-0000000000e3', 'quarterfinal', 'qf1');
update btc_bracket_slots set team1_id = '00000000-0000-0000-0000-000000000c01'
  where id = '00000000-0000-0000-0000-000000000a61';
select is(
  (select new_value ->> 'team1_id' from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000a61' and action = 'update'),
  '00000000-0000-0000-0000-000000000c01', 'a bracket slot''s advancement outcome is logged');

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
select ok(
  (select not (new_value ? 'station') and new_value ->> 'time_source' = 'manual'
     from score_change_log where row_id = '00000000-0000-0000-0000-000000000a01' and action = 'update'),
  'only scored columns are captured: time_source is in, station is not');

update ct_heat_entries set station = 'Table B' where id = '00000000-0000-0000-0000-000000000a01';
update ct_heat_entries set elapsed_secs = 400 where id = '00000000-0000-0000-0000-000000000a01';
select is(
  (select count(*)::int from score_change_log where row_id = '00000000-0000-0000-0000-000000000a01'),
  2, 'neither an unscored-column update nor a same-value write to a scored column writes a log row');

-- a result before the heat is confirmed is not an after-confirm change
insert into ct_results (id, heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000c1', false);
select is(
  (select after_confirm from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'insert'),
  false, 'a result recorded before confirmation is not flagged after_confirm');

-- confirm the heat: the status change is itself logged
update ct_heats set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select (old_value ->> 'status') || '->' || (new_value ->> 'status') || ':' || after_confirm::text
     from score_change_log where row_id = '00000000-0000-0000-0000-0000000000f1' and action = 'update'),
  'pending->confirmed:false', 'confirming a heat is logged, and is not itself an after-confirm change');

-- then a silent correction
update ct_results set correct = true where id = '00000000-0000-0000-0000-000000000b01';
select is(
  (select after_confirm from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'update'),
  true, 'a result change after the heat is confirmed is flagged after_confirm');
select is(
  (select reason from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'update'),
  null, 'an un-reasoned correction has a null reason');

select set_config('app.change_reason', 'judge recount', true);
update ct_results set correct = false where id = '00000000-0000-0000-0000-000000000b01';
select set_config('app.change_reason', '', true);
update ct_results set correct = true where id = '00000000-0000-0000-0000-000000000b01';
select is(
  (select count(*)::int from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and reason = 'judge recount'),
  1, 'a supplied reason is recorded on exactly the change that carried it');
select is(
  (select count(*)::int from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'update' and reason is null),
  2, 'an empty reason is stored as null, not as an empty string');

-- editing a time after confirmation goes through a different join than results
update ct_heat_entries set elapsed_secs = 410 where id = '00000000-0000-0000-0000-000000000a01';
select is(
  (select after_confirm from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000a01' and new_value ->> 'elapsed_secs' = '410'),
  true, 'a heat entry time edited after confirmation is flagged after_confirm');

-- re-opening a confirmed heat is itself logged as an after-confirm change
update ct_heats set status = 'scoring' where id = '00000000-0000-0000-0000-0000000000f1';
select is(
  (select after_confirm from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000f1' and new_value ->> 'status' = 'scoring'),
  true, 're-opening a confirmed heat is logged with after_confirm = true');

-- a deletion is logged with the old value and no new value
delete from ct_results where id = '00000000-0000-0000-0000-000000000b01';
select ok(
  (select (old_value ->> 'correct') = 'true' and new_value is null
     from score_change_log where row_id = '00000000-0000-0000-0000-000000000b01' and action = 'delete'),
  'deleting a result logs a delete row with the old value and no new value');

-- ---------- the is_test skip cannot be used as a bypass ----------
update events set is_test = true where id = '00000000-0000-0000-0000-0000000000e1';
update ct_heat_entries set elapsed_secs = 999 where id = '00000000-0000-0000-0000-000000000a01';
update events set is_test = false where id = '00000000-0000-0000-0000-0000000000e1';
select is(
  (select count(*)::int from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000e1' and table_name = 'events'),
  2, 'flipping is_test on and off leaves two log rows, so a hidden edit window is visible');

-- ---------- confirm_heat through the real RPC ----------
select set_config('t.member_before', (select count(*)::text from score_change_log
  where changed_by = '00000000-0000-0000-0000-000000000001'), false);
select confirm_heat(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-0000000000f1',
  (select updated_at from ct_heats where id = '00000000-0000-0000-0000-0000000000f1'),
  '[{"entry_id":"00000000-0000-0000-0000-000000000a01","elapsed_secs":200,"elapsed_secs_raw":200,"maxed":false,
     "results":[{"set_id":"00000000-0000-0000-0000-0000000000c1","correct":true}]}]'::jsonb);
select is(
  (select count(*)::int from score_change_log where changed_by = '00000000-0000-0000-0000-000000000001')
    - current_setting('t.member_before')::int,
  3, 'confirm_heat logs its entry time, its new result and the heat status change, attributed to the caller');

select set_config('t.member_before', (select count(*)::text from score_change_log
  where changed_by = '00000000-0000-0000-0000-000000000001'), false);
select confirm_heat(
  '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-0000000000f1',
  (select updated_at from ct_heats where id = '00000000-0000-0000-0000-0000000000f1'),
  '[{"entry_id":"00000000-0000-0000-0000-000000000a01","elapsed_secs":200,"elapsed_secs_raw":200,"maxed":false,
     "results":[{"set_id":"00000000-0000-0000-0000-0000000000c1","correct":true}]}]'::jsonb);
select is(
  (select count(*)::int from score_change_log where changed_by = '00000000-0000-0000-0000-000000000001')
    - current_setting('t.member_before')::int,
  0, 're-confirming a heat with identical values logs nothing (the ON CONFLICT upsert is a no-op)');

select confirm_heat(
  '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-0000000000f1',
  (select updated_at from ct_heats where id = '00000000-0000-0000-0000-0000000000f1'),
  '[{"entry_id":"00000000-0000-0000-0000-000000000a01","elapsed_secs":200,"elapsed_secs_raw":200,"maxed":false,
     "results":[{"set_id":"00000000-0000-0000-0000-0000000000c1","correct":false}]}]'::jsonb);
select ok(
  (select after_confirm and changed_by = '00000000-0000-0000-0000-000000000001'
     from score_change_log
    where table_name = 'ct_results' and action = 'update'
      and context ->> 'heat_entry_id' = '00000000-0000-0000-0000-000000000a01'
      and (new_value ->> 'correct') = 'false' and (old_value ->> 'correct') = 'true'
    order by id desc limit 1),
  'a correction re-confirmed through confirm_heat logs old/new, the caller, and after_confirm = true');

-- ---------- confirm_btc_match through the real RPC ----------
select confirm_btc_match(
  '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000d01',
  (select updated_at from btc_matches where id = '00000000-0000-0000-0000-000000000d01'),
  (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 2) order by c) from generate_series(1, 15) c),
  '00000000-0000-0000-0000-000000000c01', false, false, '8:42', null);
select is(
  (select count(*)::int from score_change_log
    where table_name = 'btc_cup_votes' and action = 'insert' and after_confirm = false
      and changed_by = '00000000-0000-0000-0000-000000000001'),
  15, 'a first confirm_btc_match logs one insert per cup, none flagged after_confirm');
select is(
  (select row_id from score_change_log
    where table_name = 'btc_match_bonuses' and event_id = '00000000-0000-0000-0000-0000000000e3'),
  '00000000-0000-0000-0000-000000000d01'::uuid, 'bonus rows are logged against their match id (their primary key)');
select is(
  (select (old_value ->> 'status') || '->' || (new_value ->> 'status') || ':' || after_confirm::text
     from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000d01' and table_name = 'btc_matches' and action = 'update'
      and new_value ->> 'status' = 'confirmed'),
  'pending->confirmed:false', 'confirming a BTC match is logged as pending -> confirmed, not after-confirm');

-- re-saving the identical match: replace-all churn, flagged after_confirm
select confirm_btc_match(
  '00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000d01',
  (select updated_at from btc_matches where id = '00000000-0000-0000-0000-000000000d01'),
  (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 2) order by c) from generate_series(1, 15) c),
  '00000000-0000-0000-0000-000000000c01', false, false, '8:42', null);
select is(
  (select count(*)::int from score_change_log
    where table_name = 'btc_cup_votes' and after_confirm = true),
  30, 'an unchanged BTC re-confirm logs a delete and an insert per cup, all flagged after_confirm (documented churn)');

-- a token changed after the match is confirmed: direct write, old -> new, flagged
update btc_cup_votes set team1_tokens = 3
 where match_id = '00000000-0000-0000-0000-000000000d01' and cup_number = 1;
select is(
  (select (old_value ->> 'team1_tokens') || '->' || (new_value ->> 'team1_tokens') || ':' || after_confirm::text
     from score_change_log
    where table_name = 'btc_cup_votes' and action = 'update'
      and context = jsonb_build_object('match_id', '00000000-0000-0000-0000-000000000d01', 'cup_number', 1)),
  '2->3:true', 'a token change after the match is confirmed logs old -> new and is flagged');

update btc_matches set status = 'scoring' where id = '00000000-0000-0000-0000-000000000d01';
select is(
  (select after_confirm from score_change_log
    where row_id = '00000000-0000-0000-0000-000000000d01' and table_name = 'btc_matches'
      and new_value ->> 'status' = 'scoring'),
  true, 're-opening a confirmed BTC match is logged with after_confirm = true');

-- ---------- tenancy: own org only ----------
select is(
  (select count(*)::int from score_change_log where org_id <> '00000000-0000-0000-0000-000000000010'),
  0, 'a member of org 1 reads none of another org''s log rows');
select ok(
  (select count(*) from score_change_log where org_id = '00000000-0000-0000-0000-000000000010') > 10,
  'and does read their own org''s log');

-- ---------- insert-only for the authenticated role ----------
select throws_ok($$delete from score_change_log$$, '42501', 'permission denied for table score_change_log', 'authenticated cannot delete log rows');
select throws_ok($$update score_change_log set reason = 'x'$$, '42501', 'permission denied for table score_change_log', 'authenticated cannot update log rows');
select throws_ok(
  $$insert into score_change_log (org_id, event_id, table_name, row_id, action)
    values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1',
            'ct_results', gen_random_uuid(), 'insert')$$,
  '42501', 'permission denied for table score_change_log', 'authenticated cannot insert log rows directly (forged history)');

-- ---------- a member of ANOTHER org ----------
reset request.jwt.claim.sub;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is(
  (select count(*)::int from score_change_log where org_id = '00000000-0000-0000-0000-000000000010'),
  0, 'a member of org 2 reads none of org 1''s log rows');
select is(
  (select count(*)::int from score_change_log),
  1, 'a member of org 2 reads exactly their own org''s one row');

-- ---------- a non-member ----------
reset request.jwt.claim.sub;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is((select count(*)::int from score_change_log), 0, 'a non-member reads zero log rows');
reset role;
select ok((select count(*) from score_change_log where org_id = '00000000-0000-0000-0000-000000000010') > 10,
  'while the log the non-member could not read was in fact well populated');

-- ---------- anon and service_role ----------
set local role anon;
select throws_ok($$select 1 from score_change_log$$, '42501', 'permission denied for table score_change_log', 'anon has no access to the log');
reset role;
set local role service_role;
select throws_ok(
  $$insert into score_change_log (org_id, event_id, table_name, row_id, action)
    values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1',
            'ct_results', gen_random_uuid(), 'insert')$$,
  '42501', 'permission denied for table score_change_log', 'service_role cannot forge log rows either');
reset role;

-- ---------- append-only even for the table owner (tamper-evident) ----------
select throws_ok($$update score_change_log set reason = 'tamper'$$, '42501', 'score_change_log is append-only', 'the owner cannot update log rows');
select throws_ok($$delete from score_change_log$$, '42501', 'score_change_log is append-only', 'the owner cannot delete log rows');
select throws_ok($$truncate score_change_log$$, '42501', 'score_change_log is append-only', 'the owner cannot truncate the log');

-- ---------- deleting an event neither fails nor erases history ----------
select set_config('t.e1_scored_before', (select count(*)::text from score_change_log
  where event_id = '00000000-0000-0000-0000-0000000000e1' and table_name <> 'events'), false);
select isnt(current_setting('t.e1_scored_before')::int, 0, 'the event has logged scoring history before it is deleted');
select lives_ok(
  $$delete from events where id = '00000000-0000-0000-0000-0000000000e1'$$,
  'deleting an event with logged history succeeds');
select is(
  (select count(*)::int from score_change_log
    where event_id = '00000000-0000-0000-0000-0000000000e1' and table_name <> 'events'),
  current_setting('t.e1_scored_before')::int,
  'the deleted event''s scoring history is intact and its cascade added no scored rows');
select is(
  (select count(*)::int from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000e1' and table_name = 'events' and action = 'delete'),
  1, 'the deletion of a real event is itself recorded');
select lives_ok(
  $$delete from events where id = '00000000-0000-0000-0000-0000000000e2'$$,
  'deleting a rehearsal (is_test) event succeeds');
select is(
  (select count(*)::int from score_change_log where event_id = '00000000-0000-0000-0000-0000000000e2'),
  0, 'deleting a rehearsal event writes no log rows');

select * from finish();
rollback;
