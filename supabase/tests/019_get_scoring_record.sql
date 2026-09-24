-- T-TRUST.2a: get_scoring_record — the public, shape-only corrections summary.
-- Proves: nothing is returned for an unpublished or unknown event; only changes made
-- AFTER confirmation are reported; the actor is always the role label and never an
-- identity; no raw values, free-text notes, user ids or row ids leak; a replace-all
-- re-save is not reported as a correction but a real change in a different transaction
-- is; corrections to different heats/matches stay separate; ordering, counts, labels
-- (Cup Taster and BTC, including a deleted parent), reasons, the 200-entry cap and the
-- scale bound behave; rehearsal-flag flips are split by publication; the function is
-- callable by anon (that is its purpose) and configured safely.
--
-- Most scenarios are SYNTHETIC log rows inserted directly (as the owner) with chosen
-- txids and times, so the grouping/ordering rules can be tested independently of the
-- triggers; a few run through the real triggers to prove the two fit together.
begin;
select plan(36);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.seduh-next');
insert into orgs (id, name, slug) values ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Published Event'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Unpublished Event'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'btc', 'BTC Event'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Synthetic'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Cap'),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Scale');
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

insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-0000000000e3', 'Team A'),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-0000000000e3', 'Team B'),
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-0000000000e3', 'Team C'),
  ('00000000-0000-0000-0000-000000000c04', '00000000-0000-0000-0000-0000000000e3', 'Team D');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-0000000000e3', 'preliminary',
   '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000c02'),
  ('00000000-0000-0000-0000-000000000d02', '00000000-0000-0000-0000-0000000000e3', 'preliminary',
   '00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000c04');
insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
  ('00000000-0000-0000-0000-000000000d01', 1, 2);

-- a pre-confirmation edit must NOT be reported; then confirm the heat and match
update ct_heat_entries set elapsed_secs = 300 where id = '00000000-0000-0000-0000-000000000a01';
update ct_heats set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000f1';
update btc_matches set status = 'confirmed' where id = '00000000-0000-0000-0000-000000000d01';
-- tie-break provenance: a coin toss whose free-text note names people (must not leak)
insert into ct_stage_entries (stage_id, entry_id, source, position_note) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ee', 'coin_toss', 'Alice vs Bob, witnessed');

-- publish e1, e3, e5, e6, e7 (e2 stays unpublished)
insert into public_results (org_id, event_id, payload)
select '00000000-0000-0000-0000-000000000010', e, '{}'::jsonb
  from unnest(array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3',
                    '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e6',
                    '00000000-0000-0000-0000-0000000000e7']::uuid[]) e;

-- ---------- nothing for unpublished / unknown ----------
set local role anon;
select is(get_scoring_record('00000000-0000-0000-0000-0000000000e2'), null,
  'an unpublished event reveals nothing');
select is(get_scoring_record(gen_random_uuid()), null, 'an unknown event id reveals nothing');
select is((get_scoring_record('00000000-0000-0000-0000-0000000000e1') ->> 'correction_count')::int, 0,
  'anon can read a published event''s record, and a clean event has zero corrections');
reset role;

-- ---------- real triggers: corrections after confirmation, as the organiser ----------
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
-- a real BTC vote change after the match was confirmed
update btc_cup_votes set team1_tokens = 3 where match_id = '00000000-0000-0000-0000-000000000d01' and cup_number = 1;
reset role;

set local role anon;
select is((get_scoring_record('00000000-0000-0000-0000-0000000000e1') ->> 'correction_count')::int, 2,
  'two correction groups are reported: results and times');
select is(
  (select c ->> 'changes' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'area' = 'results'),
  '1', 'a replace-all re-save of an unchanged result is not counted; only the real result change is');
select is(
  (select (c ->> 'reason') || '/' || (c ->> 'reasoned') || '/' || (c ->> 'label')
     from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'area' = 'results'),
  'judge recount/1/Prelims · heat 1', 'the stated reason, how many records carried one, and the results label are included');
select is(
  (select c ->> 'label' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'area' = 'times'),
  'Prelims · heat 1', 'the stage and heat are named on time corrections too');
select is(
  (select count(*)::int from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') c
    where c ->> 'by' <> 'Organiser'),
  0, 'the actor is always the role label');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     (get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'corrections') -> 0) k),
  array['area', 'at', 'by', 'changes', 'label', 'reason', 'reasoned'],
  'each correction exposes exactly: when, role, area, label, records changed, reason, reasoned count — nothing else');
select is(
  (get_scoring_record('00000000-0000-0000-0000-0000000000e1'))::text ~ '(old_value|new_value|elapsed_secs|correct"|Alice|Bob|00000000-0000-0000-0000-000000000001|00000000-0000-0000-0000-000000000a01)',
  false, 'no raw values, field names, free-text notes, user ids or row ids appear anywhere in the record');
select is(
  (get_scoring_record('00000000-0000-0000-0000-0000000000e1') ->> 'rehearsal_flag_changes')::int
    || '/' || (get_scoring_record('00000000-0000-0000-0000-0000000000e1') ->> 'rehearsal_flag_changes_after_publish')::int,
  '2/0', 'rehearsal-flag flips are counted, and none happened after publication here');
select is(get_scoring_record('00000000-0000-0000-0000-0000000000e1') -> 'placings',
  '[{"count": 1, "stage": "Prelims", "decided_by": "coin toss"}]'::jsonb,
  'a coin-toss placing is shown by stage, category and count only; the organiser''s note is not returned');
-- BTC through the real triggers
select is(
  (select (c ->> 'area') || '/' || (c ->> 'label') from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e3') -> 'corrections') c),
  'votes/Preliminary match', 'a BTC vote changed after confirmation is reported, labelled by round, through the real trigger');
reset role;

-- ---------- synthetic scenarios on event e5 (owner inserts, chosen txids and times) ----------
insert into score_change_log
  (org_id, event_id, table_name, row_id, action, old_value, new_value, context, after_confirm, reason, txid, changed_at)
values
  -- A: two separate transactions on the same heat's times: two groups, ordered by time
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','ct_heat_entries','00000000-0000-0000-0000-000000000a01','update','{"elapsed_secs":1}','{"elapsed_secs":2}','{"heat_id":"00000000-0000-0000-0000-0000000000f1","entry_id":"00000000-0000-0000-0000-0000000000ee"}',true,null,101,'2026-02-01 10:05+00'),
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','ct_heat_entries','00000000-0000-0000-0000-000000000a01','update','{"elapsed_secs":2}','{"elapsed_secs":3}','{"heat_id":"00000000-0000-0000-0000-0000000000f1","entry_id":"00000000-0000-0000-0000-0000000000ee"}',true,null,102,'2026-02-01 10:01+00'),
  -- B: one transaction, two result records for one heat; one carries a reason, one does not
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','ct_results','00000000-0000-0000-0000-000000000b01','update','{"correct":false}','{"correct":true}','{"heat_entry_id":"00000000-0000-0000-0000-000000000a01","set_id":"00000000-0000-0000-0000-0000000000c1"}',true,'recount',103,'2026-02-01 11:00+00'),
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','ct_results','00000000-0000-0000-0000-000000000b02','update','{"correct":true}','{"correct":false}','{"heat_entry_id":"00000000-0000-0000-0000-000000000a01","set_id":"00000000-0000-0000-0000-0000000000c2"}',true,null,103,'2026-02-01 11:00+00'),
  -- C: replace-all re-save, identical values, one transaction: dropped
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_cup_votes','00000000-0000-0000-0000-0000000000a1','delete','{"team1_tokens":2}',null,'{"match_id":"00000000-0000-0000-0000-000000000d01","cup_number":1}',true,null,104,'2026-02-01 12:00+00'),
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_cup_votes','00000000-0000-0000-0000-0000000000a2','insert',null,'{"team1_tokens":2}','{"match_id":"00000000-0000-0000-0000-000000000d01","cup_number":1}',true,null,104,'2026-02-01 12:00+00'),
  -- D: same values but in DIFFERENT transactions: a real removal then a real re-add, NOT a re-save
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_cup_votes','00000000-0000-0000-0000-0000000000a3','delete','{"team1_tokens":2}',null,'{"match_id":"00000000-0000-0000-0000-000000000d01","cup_number":2}',true,null,105,'2026-02-01 12:10+00'),
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_cup_votes','00000000-0000-0000-0000-0000000000a4','insert',null,'{"team1_tokens":2}','{"match_id":"00000000-0000-0000-0000-000000000d01","cup_number":2}',true,null,106,'2026-02-01 12:20+00'),
  -- E: one transaction, votes on TWO different matches: two separate corrections
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_cup_votes','00000000-0000-0000-0000-0000000000a5','update','{"team1_tokens":1}','{"team1_tokens":2}','{"match_id":"00000000-0000-0000-0000-000000000d01","cup_number":3}',true,null,107,'2026-02-01 13:00+00'),
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_cup_votes','00000000-0000-0000-0000-0000000000a6','update','{"team1_tokens":1}','{"team1_tokens":2}','{"match_id":"00000000-0000-0000-0000-000000000d02","cup_number":3}',true,null,107,'2026-02-01 13:00+00'),
  -- F: stage-level label
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','ct_stages','00000000-0000-0000-0000-0000000000b1','update','{"cutoff":4}','{"cutoff":3}','{"kind":"prelims","ordinal":1}',true,null,108,'2026-02-01 14:00+00'),
  -- G: parent since deleted: label null, still counted
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','ct_heat_entries','00000000-0000-0000-0000-0000000000a7','update','{"elapsed_secs":1}','{"elapsed_secs":2}','{"heat_id":"00000000-0000-0000-0000-00000000dead","entry_id":"00000000-0000-0000-0000-0000000000ee"}',true,null,109,'2026-02-01 15:00+00'),
  -- H: bracket slot
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_bracket_slots','00000000-0000-0000-0000-0000000000a8','update','{"team1_id":null}','{"team1_id":"x"}','{"round":"quarterfinal","slot_label":"qf1"}',true,null,110,'2026-02-01 16:00+00'),
  -- I: bonus
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','btc_match_bonuses','00000000-0000-0000-0000-000000000d02','update','{"fastest_team_id":null}','{"fastest_team_id":"x"}','{"match_id":"00000000-0000-0000-0000-000000000d02"}',true,null,111,'2026-02-01 17:00+00'),
  -- J: a hostile reason is returned verbatim (escaping is the renderer's job, documented)
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','ct_heat_entries','00000000-0000-0000-0000-0000000000a9','update','{"elapsed_secs":1}','{"elapsed_secs":2}','{"heat_id":"00000000-0000-0000-0000-0000000000f1","entry_id":"00000000-0000-0000-0000-0000000000ee"}',true,'<script>alert(1)</script>',112,'2026-02-01 18:00+00'),
  -- K: rehearsal flips: one before publication, one after; even flagged after_confirm they are not corrections
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','events','00000000-0000-0000-0000-0000000000e5','update','{"is_test":false}','{"is_test":true}','{}',true,null,113, now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-0000000000e5','events','00000000-0000-0000-0000-0000000000e5','update','{"is_test":true}','{"is_test":false}','{}',true,null,114, now() + interval '1 hour');

set local role anon;
select is((get_scoring_record('00000000-0000-0000-0000-0000000000e5') ->> 'correction_count')::int, 12,
  'the synthetic event yields exactly 12 corrections (re-save dropped; cross-transaction, cross-match and parent-deleted ones kept)');
select is(
  (select array_agg((c ->> 'at')::timestamptz order by ord) from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') with ordinality t(c, ord) where ord <= 2),
  array['2026-02-01 10:01+00', '2026-02-01 10:05+00']::timestamptz[],
  'corrections are ordered by time, and two transactions on one heat are two entries');
select is(
  (select (c ->> 'changes') || '/' || (c ->> 'reason') || '/' || (c ->> 'reasoned')
     from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c
    where c ->> 'area' = 'results'),
  '2/recount/1', 'two records in one correction are counted as 2, the reason shown, and 1 of the 2 carried it');
select is(
  (select count(*)::int from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c
    where c ->> 'area' = 'votes' and c ->> 'label' = 'Preliminary match'),
  4, 'votes: the same-transaction re-save is dropped (0), the cross-transaction pair stays (2), and two matches in one transaction stay separate (2)');
select is(
  (select (c ->> 'reasoned') || '/' || coalesce(c ->> 'reason', 'none')
     from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c
    where c ->> 'area' = 'times' and (c ->> 'at')::timestamptz = '2026-02-01 10:01+00'),
  '0/none', 'a correction with no stated reason reports zero reasoned records and no reason');
select is(
  (select c ->> 'label' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c where c ->> 'area' = 'stage settings'),
  'Prelims', 'a stage-level correction is labelled by stage');
select is(
  (select count(*)::int from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c where c ->> 'label' is null),
  1, 'a correction whose heat has since been deleted is still counted, with a null label');
select is(
  (select c ->> 'label' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c where c ->> 'area' = 'bracket'),
  'Bracket · Quarterfinal', 'a bracket-slot correction is labelled by round');
select is(
  (select c ->> 'label' from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c where c ->> 'area' = 'bonuses'),
  'Preliminary match', 'a bonus correction is labelled by its match round');
select ok(
  exists (select 1 from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c
           where c ->> 'reason' = '<script>alert(1)</script>'),
  'a hostile reason is returned verbatim as data (the renderer must escape it)');
select is(
  (select count(*)::int from jsonb_array_elements(get_scoring_record('00000000-0000-0000-0000-0000000000e5') -> 'corrections') c where c ->> 'area' is null),
  0, 'rehearsal-flag log rows never appear as corrections, even when flagged after_confirm');
select is(
  (get_scoring_record('00000000-0000-0000-0000-0000000000e5') ->> 'rehearsal_flag_changes')::int
    || '/' || (get_scoring_record('00000000-0000-0000-0000-0000000000e5') ->> 'rehearsal_flag_changes_after_publish')::int,
  '2/1', 'rehearsal flips are split into all and those after publication');
reset role;

-- ---------- the 200-entry cap, and a scale bound ----------
insert into score_change_log
  (org_id, event_id, table_name, row_id, action, old_value, new_value, context, after_confirm, txid, changed_at)
select '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e6', 'ct_heat_entries',
       gen_random_uuid(), 'update', '{"elapsed_secs":1}', '{"elapsed_secs":2}',
       '{"heat_id":"00000000-0000-0000-0000-0000000000f1","entry_id":"00000000-0000-0000-0000-0000000000ee"}',
       true, 1000 + g, '2026-03-01'::timestamptz + g * interval '1 second'
  from generate_series(1, 250) g;
set local role anon;
select is(
  (get_scoring_record('00000000-0000-0000-0000-0000000000e6') ->> 'correction_count')::int
    || '/' || jsonb_array_length(get_scoring_record('00000000-0000-0000-0000-0000000000e6') -> 'corrections')
    || '/' || (get_scoring_record('00000000-0000-0000-0000-0000000000e6') ->> 'truncated'),
  '250/200/true', 'more than 200 corrections: the list is capped at 200, the true total is reported, and truncated says so');
reset role;

insert into score_change_log
  (org_id, event_id, table_name, row_id, action, old_value, new_value, context, after_confirm, txid, changed_at)
select '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e7', 'btc_cup_votes',
       gen_random_uuid(), case when g % 2 = 0 then 'delete' else 'insert' end,
       case when g % 2 = 0 then '{"team1_tokens":1}'::jsonb end,
       case when g % 2 = 1 then '{"team1_tokens":1}'::jsonb end,
       jsonb_build_object('match_id', '00000000-0000-0000-0000-000000000d01', 'cup_number', g / 2),
       true, 2000 + (g % 40), now() + g * interval '1 millisecond'
  from generate_series(1, 8000) g;
select set_config('t.t0', clock_timestamp()::text, false);
set local role anon;
select isnt(get_scoring_record('00000000-0000-0000-0000-0000000000e7'), null, 'the scale event returns a record');
reset role;
select ok(clock_timestamp() - current_setting('t.t0')::timestamptz < interval '2.5 seconds',
  '8,000 log rows (mixed replace-all churn) are summarised well inside anon''s 3-second statement timeout');

-- ---------- large free-text values cannot slow the public read ----------
-- An organiser writing megabyte notes through the real trigger: the log must store a bounded
-- copy, and the public function must stay fast (cost must not scale with bytes written).
do $$
begin
  for i in 1..40 loop
    update btc_matches set team1_time_note = repeat('x', 1000000) || i
     where id = '00000000-0000-0000-0000-000000000d01';
  end loop;
end $$;
select ok(
  (select max(length(new_value ->> 'team1_time_note')) <= 501
     from score_change_log where event_id = '00000000-0000-0000-0000-0000000000e3' and table_name = 'btc_matches'),
  'the log stores a bounded copy of a megabyte-sized note');
select set_config('t.t1', clock_timestamp()::text, false);
set local role anon;
select isnt(get_scoring_record('00000000-0000-0000-0000-0000000000e3'), null, 'the record is still returned after megabyte-sized note edits');
reset role;
select ok(clock_timestamp() - current_setting('t.t1')::timestamptz < interval '2.5 seconds',
  'and stays well inside anon''s 3-second statement timeout');

-- ---------- privileges and configuration ----------
select is((select prosecdef and provolatile = 's' and proconfig = array['search_path=""']
             from pg_proc where proname = 'get_scoring_record'),
  true, 'the function is security definer, stable, with search_path pinned to empty');
select is((select proacl::text ~ '(^\{|,)=X' from pg_proc where proname = 'get_scoring_record'),
  false, 'execute is not granted to PUBLIC');
select is(has_function_privilege('anon', 'get_scoring_record(uuid)', 'execute'), true,
  'anon can execute it (its purpose)');

-- ---------- access shape ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select isnt(get_scoring_record('00000000-0000-0000-0000-0000000000e1'), null,
  'a signed-in non-member can read a PUBLISHED event''s record (it is public by design)');
select is(get_scoring_record('00000000-0000-0000-0000-0000000000e2'), null,
  'but not an unpublished one, and a non-member still reads zero rows of the log itself: ' ||
  (select count(*)::text from score_change_log));
reset role;

select * from finish();
rollback;
