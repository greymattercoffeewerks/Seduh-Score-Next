-- T-TRUST.2a: get_scoring_record — the public, shape-only corrections summary.
-- Proves: nothing is returned for an unpublished or unknown event; only changes made
-- AFTER confirmation are reported; the actor is always the role label and never an
-- identity; no raw values (old/new, per-cupper data, user ids) leak; a replace-all
-- re-save is not reported as a correction; rehearsal-flag flips and tiebreak notes are
-- surfaced; the function is callable by anon (that is its purpose).
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.seduh-next');
insert into orgs (id, name, slug) values ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Published Event'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Unpublished Event');
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000e1', 'Cupper One');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'prelims', 1, 2, 480);
insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 2);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 1, 480);
insert into ct_heat_entries (id, heat_id, entry_id, station) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000ee', 'Table A');
insert into ct_results (id, heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000c1', false),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000c2', true);

-- a pre-confirmation edit: must NOT be reported as a correction
update ct_heat_entries set elapsed_secs = 300 where id = '00000000-0000-0000-0000-000000000a01';
update ct_heats set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000f1';
insert into ct_stage_entries (stage_id, entry_id, source, position_note) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ee', 'seed', 'coin toss, witnessed');

-- only e1 is published
insert into public_results (org_id, event_id, payload) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb);

-- ---------- nothing for unpublished / unknown ----------
set local role anon;
select is(get_scoring_record('00000000-0000-0000-0000-0000000000e2'), null,
  'an unpublished event reveals nothing');
select is(get_scoring_record(gen_random_uuid()), null, 'an unknown event id reveals nothing');
select is((get_scoring_record('00000000-0000-0000-0000-0000000000e1') ->> 'correction_count')::int, 0,
  'anon can read a published event''s record, and a clean event has zero corrections');
reset role;

-- ---------- corrections made after confirmation, as the organiser ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select set_config('app.change_reason', 'judge recount', true);
update ct_results set correct = true where id = '00000000-0000-0000-0000-000000000b01';
select set_config('app.change_reason', '', true);
update ct_heat_entries set elapsed_secs = 310 where id = '00000000-0000-0000-0000-000000000a01';
-- replace-all re-save of an unchanged result (delete + identical insert)
delete from ct_results where id = '00000000-0000-0000-0000-000000000b02';
insert into ct_results (heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000c2', true);
-- the rehearsal flag flipped on and off
update events set is_test = true where id = '00000000-0000-0000-0000-0000000000e1';
update events set is_test = false where id = '00000000-0000-0000-0000-0000000000e1';
reset role;

set local role anon;
select is((get_scoring_record('00000000-0000-0000-0000-0000000000e1') ->> 'correction_count')::int, 2,
  'two correction groups are reported: results and times');
select is(
  (select c ->> 'changes' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'area' = 'results'),
  '1', 'a replace-all re-save of an unchanged result is not counted; only the real result change is');
select is(
  (select c ->> 'reason' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'area' = 'results'),
  'judge recount', 'the stated reason is included');
select is(
  (select c ->> 'label' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'area' = 'times'),
  'Prelims · heat 1', 'the stage and heat are named');
select is(
  (select count(*)::int from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'by' <> 'Organiser'),
  0, 'the actor is always the role label');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     (get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') -> 0) k),
  array['area', 'at', 'by', 'changes', 'label', 'reason'],
  'each correction exposes exactly: when, role, area, label, count, reason — nothing else');
select is(
  (get_scoring_record('00000000-0000-0000-0000-0000000000e1'))::text ~ '(old_value|new_value|elapsed_secs|correct"|00000000-0000-0000-0000-000000000001|00000000-0000-0000-0000-000000000a01)',
  false, 'no raw values, field names, user ids or row ids appear anywhere in the record');
select is((get_scoring_record('00000000-0000-0000-0000-0000000000e1') ->> 'rehearsal_flag_changes')::int, 2,
  'rehearsal-flag flips are counted');
select is(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'placing_notes',
  '[{"stage": "Prelims", "source": "seed", "note": "coin toss, witnessed"}]'::jsonb,
  'tiebreak provenance is shown by stage and note only, with no cupper identity');
reset role;

-- ---------- pre-confirmation edits are not corrections ----------
select is(
  (select c ->> 'changes' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'area' = 'times'),
  '1', 'only the time edit made AFTER confirmation is reported; the earlier pre-confirmation edit is not');

-- ---------- access shape ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select isnt(get_scoring_record('00000000-0000-0000-0000-0000000000e1'), null,
  'a signed-in non-member can read a PUBLISHED event''s record (it is public by design)');
select is(get_scoring_record('00000000-0000-0000-0000-0000000000e2'), null,
  'but not an unpublished one');
select is((select count(*)::int from score_change_log), 0,
  'the function does not widen direct access: a non-member still reads zero rows of the log itself');
reset role;

select * from finish();
rollback;
