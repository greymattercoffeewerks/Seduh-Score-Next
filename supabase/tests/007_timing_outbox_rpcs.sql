-- T4.3/T4.4 follow-up: timing writes through the outbox — handoff §9, §7.1.
-- Proves: start_heat/record_heat_time/auto_max_heat are org-scoped (RLS
-- actually blocks a wrong-org caller, not just client-side trust), each is
-- idempotent via the same processed_operations ledger confirm_heat/
-- publish_session already use, record_heat_time's 'reject' vs 'overwrite'
-- conflict policies behave differently (a real tap refuses a duplicate; a
-- manual correction is allowed while the heat is still open), a status
-- mismatch (p_expected_heat_status) is caught even when the per-entry
-- null-check alone would have let a write through, the advance-to-scoring
-- transition only fires once every entry in THAT heat has a final time, and
-- auto_max_heat only touches entries still null and is a safe no-op once
-- the heat has moved past 'timing'. Runs under a real `authenticated` role
-- with RLS actually in force throughout — same discipline 005_confirm_heat.sql
-- established, for the same reason (a missing GRANT or org-scoping check
-- must surface here, not be masked by superuser bypass).
begin;
select plan(39);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- the caller below is NOT a member of Other Org

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Test Event'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000020',
   'cup_taster', 'Other Org Event');
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'Cupper One'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 'Cupper Two'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', 'Cupper Three'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e1', 'Cupper Four'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000e1', 'Cupper Five'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000e1', 'Cupper Six'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000e9', 'Other Org Cupper');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'prelims', 1, 2, 480),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e9',
   'prelims', 1, 1, 480);

-- d1: app-mode heat for start_heat + record_heat_time's 'reject' policy.
-- d2: manual-mode heat (two entries) for record_heat_time's 'overwrite' policy.
-- d3: app-mode heat, pre-seeded already 'timing', for auto_max_heat.
-- d9: Other Org's heat, for the wrong-org tests.
insert into ct_heats (id, stage_id, heat_number, timing_mode, status, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 1, 'app', 'pending', 480),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 2, 'manual', 'pending', 480),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', 3, 'app', 'timing', 480),
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000b9', 1, 'app', 'pending', 480);
update ct_heats set started_at = now() where id = '00000000-0000-0000-0000-0000000000d3';

insert into ct_heat_entries (id, heat_id, entry_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d2',
   '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d2',
   '00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d3',
   '00000000-0000-0000-0000-0000000000a5'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000d3',
   '00000000-0000-0000-0000-0000000000a6'),
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000d9',
   '00000000-0000-0000-0000-0000000000a9');

-- f5 already has a time (simulates a real tap that landed before this test's
-- own auto-max sweep runs) — proves the sweep only touches still-null entries.
update ct_heat_entries set elapsed_secs = 100, elapsed_secs_raw = 100, time_source = 'tapped'
  where id = '00000000-0000-0000-0000-0000000000f5';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ start_heat ============

select throws_ok(
  $$ select start_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000d9', now()
     ) $$,
  null,
  'start_heat: heat 00000000-0000-0000-0000-0000000000d9 not found',
  'a caller who is not a member of the heat''s org sees it as not found'
);

select throws_ok(
  $$ select start_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d2', now()
     ) $$,
  null,
  'start_heat: heat 00000000-0000-0000-0000-0000000000d2 is not an app-mode heat',
  'a manual-mode heat is refused — there is no master clock to start'
);

select lives_ok(
  $$ select start_heat(
       '00000000-0000-0000-0000-00000000f0d1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', '2026-08-28T10:00:00Z'::timestamptz
     ) $$,
  'starting a real pending app-mode heat succeeds'
);

select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  'timing',
  'the heat status flips to timing'
);
select is(
  (select started_at from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  '2026-08-28T10:00:00Z'::timestamptz,
  'started_at is exactly the client-supplied value, not a server-side now()'
);

-- A second start attempt (a different operation id — a concurrent device, or
-- a retry after this exact operation's own dedup path was somehow bypassed)
-- must be a safe no-op, not an error and not a clock restart.
select lives_ok(
  $$ select start_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', '2026-08-28T11:00:00Z'::timestamptz
     ) $$,
  'starting an already-timing heat again is a safe no-op, not an error'
);
select is(
  (select started_at from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  '2026-08-28T10:00:00Z'::timestamptz,
  'the original started_at survives untouched — the clock is never restarted mid-heat'
);

-- Replaying the EXACT SAME operation id (not just calling start_heat again
-- with a fresh one, per the test above) must be a safe no-op via the
-- processed_operations ledger's own early return — if that check were
-- broken, this would hit a real primary-key violation on the ledger insert
-- instead of silently succeeding, since '...f0d1' was already inserted by
-- the first successful call above.
select lives_ok(
  $$ select start_heat(
       '00000000-0000-0000-0000-00000000f0d1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', '2026-08-28T12:00:00Z'::timestamptz
     ) $$,
  'replaying the exact same operation id is a safe no-op via the ledger, not a primary-key violation'
);
select is(
  (select started_at from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  '2026-08-28T10:00:00Z'::timestamptz,
  'the replay did not touch started_at either'
);

-- ============ record_heat_time — 'reject' policy (a real tap) ============

select throws_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 'timing', 200, 200, false, 'tapped', now(), 'bogus'
     ) $$,
  null,
  'record_heat_time: invalid p_conflict_policy bogus',
  'an invalid conflict policy is rejected outright, before any org/existence check runs'
);

select throws_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000f9', 'timing', 200, 200, false, 'tapped', now(), 'reject'
     ) $$,
  null,
  'record_heat_time: heat entry 00000000-0000-0000-0000-0000000000f9 not found',
  'a caller who is not a member of the entry''s org sees it as not found'
);

select lives_ok(
  $$ select record_heat_time(
       '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 'timing', 200, 200, false, 'tapped', now(), 'reject'
     ) $$,
  'recording a real tap for a still-unrecorded cupper succeeds'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  200,
  'the tapped elapsed_secs is written'
);
select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  'timing',
  'the heat stays in timing — cupper f2 has not stopped yet'
);

select throws_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 'timing', 999, 999, false, 'tapped', now(), 'reject'
     ) $$,
  'P0002',
  null,
  'a second tap for the same cupper is rejected — never silently overwritten'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  200,
  'the rejected duplicate tap left the original time untouched'
);

select throws_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f2', 'pending', 250, 250, false, 'tapped', now(), 'reject'
     ) $$,
  'P0002',
  null,
  'a stale expected_heat_status is rejected even though the entry itself is still null'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f2'),
  null,
  'the rejected stale-status attempt wrote nothing'
);

select lives_ok(
  $$ select record_heat_time(
       '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f2', 'timing', 300, 300, false, 'tapped', now(), 'reject'
     ) $$,
  'recording the LAST cupper''s tap succeeds'
);
select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  'scoring',
  'the heat advances to scoring once every entry has a final time'
);

select lives_ok(
  $$ select record_heat_time(
       '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f2', 'timing', 999, 999, false, 'tapped', now(), 'reject'
     ) $$,
  'replaying the same operation id is a safe no-op, not an error'
);

-- ============ record_heat_time — 'overwrite' policy (manual entry) ============

select lives_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f3', 'pending', 200, 200, false, 'manual', now(), 'overwrite'
     ) $$,
  'a manual time for the first cupper in a still-open heat succeeds'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f3'),
  200,
  'the manual elapsed_secs is written'
);

select lives_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f3', 'pending', 210, 210, false, 'manual', now(), 'overwrite'
     ) $$,
  'correcting an already-recorded manual time succeeds — unlike a real tap, this is normal workflow'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f3'),
  210,
  'the correction actually overwrote the earlier value'
);

select lives_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f4', 'pending', 220, 220, false, 'manual', now(), 'overwrite'
     ) $$,
  'recording the second (last) cupper''s manual time succeeds'
);
select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d2'),
  'scoring',
  'the manual-mode heat advances to scoring once every entry has a final time'
);

select throws_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f3', 'pending', 999, 999, false, 'manual', now(), 'overwrite'
     ) $$,
  'P0002',
  null,
  'a correction attempted after the heat has advanced past pending is rejected — the record is frozen'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f3'),
  210,
  'the rejected late correction left the frozen value untouched'
);

-- ============ auto_max_heat ============

select throws_ok(
  $$ select auto_max_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000d9', now()
     ) $$,
  null,
  'auto_max_heat: heat 00000000-0000-0000-0000-0000000000d9 not found',
  'a caller who is not a member of the heat''s org sees it as not found'
);

select lives_ok(
  $$ select auto_max_heat(
       '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d3', now()
     ) $$,
  'sweeping a real timing heat succeeds'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f5'),
  100,
  'a cupper who already had a real tap is left untouched by the sweep'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f6'),
  480,
  'the still-unstopped cupper is maxed at the heat''s own duration_secs'
);
select is(
  (select maxed from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f6'),
  true,
  'the maxed flag is set'
);
select is(
  (select time_source from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f6'),
  'maxed',
  'the time_source records this as an auto-max, not a real tap'
);
select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d3'),
  'scoring',
  'the heat advances to scoring once the sweep leaves every entry stopped'
);

select lives_ok(
  $$ select auto_max_heat(
       '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d3', now()
     ) $$,
  'replaying the same operation id is a safe no-op, not an error'
);

select lives_ok(
  $$ select auto_max_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d3', now()
     ) $$,
  'sweeping a heat that has already left timing is a safe no-op, not an error'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f6'),
  480,
  'the no-op sweep left the already-maxed entry untouched'
);

reset role;

select * from finish();
rollback;
