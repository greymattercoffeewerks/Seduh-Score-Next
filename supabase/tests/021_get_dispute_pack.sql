-- T-TRUST.2b: get_dispute_pack — the organiser-only exact record of one event.
-- Proves: it contains the EXACT scores and the full change log with old/new values (what the public
-- page never shows); it refuses a non-member, a member of another org, a wrong org id, and anon,
-- with one unified "not found"; it never includes another event's or another org's data, nor any
-- contact detail; it is deterministic; a test event exports with an unmistakable warning; the log cap
-- is exact at the boundary; it covers BTC tables too; and it is configured safely.
begin;
select plan(29);

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

-- a person WITH contact details, to prove they never reach the pack
insert into people (id, org_id, display_name, phone, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010', 'Cupper One', '+6738001111', 'cupper.one@example.test');

insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Real Event', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Rehearsal', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'btc', 'BTC Event', false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000020', 'cup_taster', 'Other Org Event', false),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Sibling Event', false),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Log 20000', false),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'Log 20001', false);

insert into event_entries (id, event_id, person_id, display_name) values
  ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Cupper One'),
  ('00000000-0000-0000-0000-0000000000ef', '00000000-0000-0000-0000-0000000000e2', null, 'Rehearsal Cupper'),
  ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-0000000000e4', null, 'Other Org Cupper'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e5', null, 'Sibling Cupper');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'prelims', 1, 2, 480),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e2', 'prelims', 1, 1, 480),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000e4', 'prelims', 1, 1, 480),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000e5', 'prelims', 1, 1, 480);
insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 2),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b2', 1),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000b4', 1),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000b5', 1);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 1, 480),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', 1, 480),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b4', 1, 480),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000b5', 1, 480);
insert into ct_heat_entries (id, heat_id, entry_id, station) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000ee', 'Table A'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000ef', 'Table A'),
  ('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000f0', 'Table A'),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000f1', 'Table A');
insert into ct_stage_entries (id, stage_id, entry_id) values
  ('00000000-0000-0000-0000-000000000a51', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ee'),
  ('00000000-0000-0000-0000-000000000a55', '00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000f1');
insert into ct_results (id, heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000c1', false),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000c2', true),
  ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000c3', true),
  ('00000000-0000-0000-0000-000000000b04', '00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-0000000000c4', true),
  ('00000000-0000-0000-0000-000000000b05', '00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-0000000000c5', true);

-- a BTC event with a match, votes and a bonus
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-0000000000e3', 'Team A'),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-0000000000e3', 'Team B');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000f01', '00000000-0000-0000-0000-0000000000e3', 'J1');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-0000000000e3', 'preliminary',
   '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000c02');
insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000f01');
insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
  ('00000000-0000-0000-0000-000000000d01', 1, 2), ('00000000-0000-0000-0000-000000000d01', 2, 3);
insert into btc_match_bonuses (match_id, fastest_team_id) values
  ('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-000000000c01');

insert into btc_bracket_slots (id, event_id, round, slot_label) values
  ('00000000-0000-0000-0000-000000000a61', '00000000-0000-0000-0000-0000000000e3', 'quarterfinal', 'qf1');
-- SIBLING BTC events (same org, and another org), each with one of EVERYTHING, so an unscoped
-- query in any BTC section would put a foreign row into e3's pack
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-000000000010', 'btc', 'BTC Sibling'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000020', 'btc', 'BTC Other Org');
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000c11', '00000000-0000-0000-0000-0000000000e8', 'Sib A'),
  ('00000000-0000-0000-0000-000000000c12', '00000000-0000-0000-0000-0000000000e8', 'Sib B'),
  ('00000000-0000-0000-0000-000000000c21', '00000000-0000-0000-0000-0000000000e9', 'Oth A'),
  ('00000000-0000-0000-0000-000000000c22', '00000000-0000-0000-0000-0000000000e9', 'Oth B');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000f11', '00000000-0000-0000-0000-0000000000e8', 'Sib J'),
  ('00000000-0000-0000-0000-000000000f21', '00000000-0000-0000-0000-0000000000e9', 'Oth J');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-000000000d11', '00000000-0000-0000-0000-0000000000e8', 'preliminary',
   '00000000-0000-0000-0000-000000000c11', '00000000-0000-0000-0000-000000000c12'),
  ('00000000-0000-0000-0000-000000000d21', '00000000-0000-0000-0000-0000000000e9', 'preliminary',
   '00000000-0000-0000-0000-000000000c21', '00000000-0000-0000-0000-000000000c22');
insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-000000000d11', '00000000-0000-0000-0000-000000000f11'),
  ('00000000-0000-0000-0000-000000000d21', '00000000-0000-0000-0000-000000000f21');
insert into btc_cup_votes (match_id, cup_number, team1_tokens) values
  ('00000000-0000-0000-0000-000000000d11', 1, 1), ('00000000-0000-0000-0000-000000000d21', 1, 1);
insert into btc_match_bonuses (match_id, fastest_team_id) values
  ('00000000-0000-0000-0000-000000000d11', '00000000-0000-0000-0000-000000000c11'),
  ('00000000-0000-0000-0000-000000000d21', '00000000-0000-0000-0000-000000000c21');
insert into btc_bracket_slots (id, event_id, round, slot_label) values
  ('00000000-0000-0000-0000-000000000a71', '00000000-0000-0000-0000-0000000000e8', 'quarterfinal', 'qf1'),
  ('00000000-0000-0000-0000-000000000a72', '00000000-0000-0000-0000-0000000000e9', 'quarterfinal', 'qf1');

-- confirm the real heat, then make a reasoned correction after confirmation, as the organiser
update ct_heat_entries set elapsed_secs = 300 where id = '00000000-0000-0000-0000-000000000a01';
update ct_heats set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000d1';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select set_config('app.change_reason', 'judge recount', true);
update ct_results set correct = true where id = '00000000-0000-0000-0000-000000000b01';
select set_config('app.change_reason', '', true);
update ct_heat_entries set elapsed_secs = 310 where id = '00000000-0000-0000-0000-000000000a01';

-- ---------- the pack holds the exact record ----------
select is((get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') ->> 'pack_version')::int, 1,
  'the pack is versioned');
select is(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'event' ->> 'name',
  'Real Event', 'it identifies the event');
select is(
  (select (c ->> 'entries') || '/' || (c ->> 'stages') || '/' || (c ->> 'sets') || '/' || (c ->> 'stage_entries') || '/' || (c ->> 'heats') || '/' || (c ->> 'heat_entries') || '/' || (c ->> 'results')
     from (select get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'counts' as c) q),
  '1/1/2/1/1/1/2', 'every Cup Taster section holds this event only (1 entry, 1 stage, 2 sets, 1 stage entry, 1 heat, 1 heat entry, 2 results) — sibling events with rows in every one of those tables do not leak in');
select is(
  (select (c ->> 'btc_teams') || '/' || (c ->> 'btc_judges') || '/' || (c ->> 'btc_matches') || '/' || (c ->> 'btc_match_judges') || '/' || (c ->> 'btc_cup_votes') || '/' || (c ->> 'btc_match_bonuses') || '/' || (c ->> 'btc_bracket_slots')
     from (select get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3') -> 'counts' as c) q),
  '2/1/1/1/2/1/1', 'every BTC section holds this event only (2 teams, 1 judge, 1 match, 1 match judge, 2 votes, 1 bonus, 1 bracket slot) — a sibling BTC event in the same org and one in another org, each with a row in every table, do not leak in');
select is(
  get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3')::text ~ '(Sib A|Sib J|Oth A|Oth J|BTC Sibling|BTC Other Org)',
  false, 'no name from a sibling or other-org BTC event appears anywhere in this BTC event''s pack');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'event') k),
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns where table_schema = 'public' and table_name = 'events'),
  'the event section is exactly events'' columns; adding a column to events fails this test until someone decides it is fit for a dispute party');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'cup_taster' -> 'entries' -> 0) k),
  array['bib', 'cafe', 'created_at', 'display_name', 'event_id', 'id', 'person_id', 'withdrawn'],
  'an entry carries exactly these columns (names, cafe, bib, withdrawn — never contact details); a new column fails this test until reviewed');
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') ->> 'warning') is null
    and abs(extract(epoch from now() - (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') ->> 'generated_at')::timestamptz)) < 5
    and (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'event' ->> 'org_id') = '00000000-0000-0000-0000-000000000010'
    and (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') ->> 'is_test') = 'false',
  true, 'a live event carries no test warning, a real generation time, its org id and is_test = false');
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'cup_taster' -> 'heat_entries' -> 0 ->> 'elapsed_secs'),
  '310', 'the exact recorded time is in the pack (the public page never shows this)');
select is(
  (select array_agg((r ->> 'correct')::boolean order by ord)
     from jsonb_array_elements(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'cup_taster' -> 'results') with ordinality t(r, ord)),
  array[true, true], 'the exact right/wrong for every set is in the pack, in set order');

-- ---------- the full change log with old and new values ----------
select ok(
  (select bool_or((l ->> 'table_name') = 'ct_results' and (l ->> 'action') = 'update'
                  and (l -> 'old_value' ->> 'correct') = 'false' and (l -> 'new_value' ->> 'correct') = 'true'
                  and (l ->> 'after_confirm') = 'true' and (l ->> 'reason') = 'judge recount'
                  and (l ->> 'changed_by') = '00000000-0000-0000-0000-000000000001')
     from jsonb_array_elements(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'change_log') l),
  'the log carries a post-confirmation correction with its old and new value, stated reason, and who made it');
select is(
  (select bool_and((l ->> 'event_id') = '00000000-0000-0000-0000-0000000000e1')
     from jsonb_array_elements(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') -> 'change_log') l),
  true, 'every logged change in the pack belongs to this event');

-- ---------- what must never be in it ----------
select is(
  get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')::text ~ '(6738001111|cupper.one@example|Sibling Cupper|Other Org Cupper|Rehearsal Cupper)',
  false, 'no contact details, and nothing from another event or another org, appear anywhere in the pack');

-- ---------- access: one unified refusal ----------
select throws_ok($$select get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e4')$$,
  'P0001', null, 'the right org id for the wrong (another org''s) event is refused');
select throws_ok($$select get_dispute_pack('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e1')$$,
  'P0001', null, 'a wrong org id for a real event is refused');
select throws_ok($$select get_dispute_pack('00000000-0000-0000-0000-000000000010', gen_random_uuid())$$,
  'P0001', null, 'an unknown event is refused with the same error');

reset request.jwt.claim.sub;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select throws_ok($$select get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')$$,
  'P0001', 'get_dispute_pack: event 00000000-0000-0000-0000-0000000000e1 not found', 'a signed-in non-member is refused');
reset request.jwt.claim.sub;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select throws_ok($$select get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')$$,
  'P0001', 'get_dispute_pack: event 00000000-0000-0000-0000-0000000000e1 not found', 'a member of another org is refused');
reset role;
set local role anon;
select throws_ok($$select get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')$$,
  '42501', null, 'anon cannot execute it at all');
reset role;
reset request.jwt.claim.sub;

-- ---------- test events export with a warning; BTC is covered ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') ->> 'is_test')
    || '/' || (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') ->> 'warning'),
  'true/TEST DATA — NOT A LIVE EVENT', 'a rehearsal event exports with an unmistakable test-data warning');
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') -> 'counts' ->> 'results') || '/'
    || (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') -> 'counts' ->> 'change_log_rows_in_pack'),
  '1/0', 'the rehearsal event still exports its scores, with an empty log (rehearsals are not logged)');
select is(
  (select (c ->> 'btc_matches') || '/' || (c ->> 'btc_cup_votes')
     from (select get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3') -> 'counts' as c) q),
  '1/2', 'a BTC event exports its matches and per-cup votes through the same function');
select is(
  jsonb_array_length(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3') -> 'btc' -> 'match_bonuses')
    || '/' || jsonb_array_length(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3') -> 'btc' -> 'teams'),
  '1/2', 'and its bonuses and teams');
reset role;

-- ---------- deterministic ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') - 'generated_at'),
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') - 'generated_at'),
  'two exports of the same event are identical apart from the timestamp');
reset role;

-- ---------- the log cap is exact ----------
insert into score_change_log
  (org_id, event_id, table_name, row_id, action, old_value, new_value, context, after_confirm, txid, changed_at)
select '00000000-0000-0000-0000-000000000010', e.ev, 'ct_results', gen_random_uuid(), 'update',
       '{"correct":false}', '{"correct":true}', '{}', true, e.base + g, '2026-07-01'::timestamptz + g * interval '1 second'
  from (values ('00000000-0000-0000-0000-0000000000e6'::uuid, 100000, 20000),
               ('00000000-0000-0000-0000-0000000000e7'::uuid, 200000, 20001)) as e(ev, base, n)
  cross join lateral generate_series(1, e.n) g;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e6') ->> 'change_log_total')
    || '/' || jsonb_array_length(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e6') -> 'change_log')
    || '/' || (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e6') ->> 'change_log_truncated'),
  '20000/20000/false', 'exactly 20,000 log rows are all included and not marked truncated');
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e7') ->> 'change_log_total')
    || '/' || jsonb_array_length(get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e7') -> 'change_log')
    || '/' || (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e7') ->> 'change_log_truncated'),
  '20001/20000/true', '20,001 rows are cut to the oldest 20,000, the true total is reported, and it says truncated');
select is(
  (get_dispute_pack('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e7') -> 'change_log' -> 0 ->> 'changed_at')::timestamptz,
  '2026-07-01 00:00:01+00'::timestamptz, 'the truncated log keeps the OLDEST rows, oldest first');
reset role;

-- ---------- configuration ----------
select is((select not prosecdef and provolatile = 's' and proconfig = array['search_path=""']
             from pg_proc where proname = 'get_dispute_pack'),
  true, 'it is security invoker (the caller''s own RLS applies), stable, with search_path pinned to empty');
select is((select proacl::text ~ '(^\{|,)=X' from pg_proc where proname = 'get_dispute_pack'),
  false, 'execute is not granted to PUBLIC');

select * from finish();
rollback;
