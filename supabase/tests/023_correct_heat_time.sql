-- Live-event finding #1 (2026-10-04): a stopped heat time can be corrected until
-- the heat is confirmed.
-- Proves: correct_heat_time is org-scoped and idempotent; it only works while
-- the heat is 'timing' or 'scoring' (a confirmed heat is locked, a pending one
-- has nothing to correct); it is compare-and-set on the value the caller was
-- shown, so a stale or queued-behind-a-newer-change correction cannot overwrite
-- what is there now; a reason is required; the correction lands as a manual
-- time with the reason on the row and in the append-only change log; the heat's
-- updated_at moves, so a confirm_heat built from a screen loaded BEFORE the
-- correction conflicts instead of silently putting the old time back; and anon
-- cannot execute it. Runs under a real `authenticated` role with RLS in force,
-- same discipline as 007_timing_outbox_rpcs.sql.
begin;
select plan(75);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org'),
  ('00000000-0000-0000-0000-000000000030', 'Second Org', 'second-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser'),
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- the caller below is NOT a member of Other Org, but IS a member of both Test Org
  -- and Second Org (so RLS alone cannot tell them which org an entry belongs to)

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
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000e1', 'Cupper Seven'),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000e1', 'Cupper Eight'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000e9', 'Other Org Cupper');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'prelims', 1, 2, 480),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e9',
   'prelims', 1, 1, 480);

-- d1: 'scoring' — both cuppers stopped (f1 200s, f2 300s).
-- d2: 'timing' — f3 stopped (150s), f4 still running (no time).
-- d3: 'confirmed' — f5 stopped (100s). Locked.
-- d4: 'pending' — f6 has no time. Nothing to correct yet.
-- d5: 'scoring' — f7 and f8 stopped (200s each); the bounds / input-hygiene tests.
-- d9: Other Org's 'scoring' heat, f9 stopped (100s), for the wrong-org tests.
insert into ct_heats (id, stage_id, heat_number, timing_mode, status, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 1, 'app', 'scoring', 480),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 2, 'app', 'timing', 480),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', 3, 'app', 'confirmed', 480),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b1', 4, 'app', 'pending', 480),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000b1', 5, 'app', 'scoring', 480),
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000b9', 1, 'app', 'scoring', 480);

insert into ct_heat_entries (id, heat_id, entry_id, station, elapsed_secs, elapsed_secs_raw, time_source) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a1', 'A', 200, 200, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a2', 'B', 300, 300, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d2',
   '00000000-0000-0000-0000-0000000000a3', 'A', 150, 150, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d2',
   '00000000-0000-0000-0000-0000000000a4', 'B', null, null, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d3',
   '00000000-0000-0000-0000-0000000000a5', 'A', 100, 100, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000d4',
   '00000000-0000-0000-0000-0000000000a6', 'A', null, null, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000d5',
   '00000000-0000-0000-0000-0000000000a7', 'A', 200, 200, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000d5',
   '00000000-0000-0000-0000-0000000000a8', 'B', 200, 200, 'tapped'),
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000d9',
   '00000000-0000-0000-0000-0000000000a9', 'A', 100, 100, 'tapped');

-- now() is fixed for the whole test transaction, so "updated_at moved" is
-- unobservable unless the heat starts from a past value. The trigger owns
-- updated_at and would overwrite it, so switch it off for this one fixture
-- write (as the table owner, before the role switch below).
alter table ct_heats disable trigger trg_ct_heats_set_updated_at;
update ct_heats set updated_at = '2026-01-01T00:00:00Z'::timestamptz
  where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2');
alter table ct_heats enable trigger trg_ct_heats_set_updated_at;

-- Reads the DETAIL a refused call attaches (the client's describeCorrectionError depends on its
-- JSON keys). A temp function so it can run under the `authenticated` role below.
create function pg_temp.detail_of(q text) returns text
language plpgsql as $f$
declare d text;
begin
  execute q;
  return 'no error';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $f$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ grants ============

select ok(
  has_function_privilege('authenticated',
    'correct_heat_time(uuid, uuid, uuid, int, int, int, boolean, text, timestamptz)', 'execute'),
  'a signed-in user can execute correct_heat_time'
);
select ok(
  not has_function_privilege('anon',
    'correct_heat_time(uuid, uuid, uuid, int, int, int, boolean, text, timestamptz)', 'execute'),
  'anon cannot execute correct_heat_time'
);

-- ============ org scoping ============

select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000f9', 100, 90, 90, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: heat entry 00000000-0000-0000-0000-0000000000f9 not found',
  'a caller who is not a member of the entry''s org sees it as not found'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f9', 100, 90, 90, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: heat entry 00000000-0000-0000-0000-0000000000f9 not found',
  'naming the caller''s own org does not unlock another org''s entry either'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000030',
       '00000000-0000-0000-0000-0000000000f1', 200, 190, 190, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: heat entry 00000000-0000-0000-0000-0000000000f1 not found',
  'a member of two orgs cannot attribute one org''s entry to the other — the named org must be the entry''s own'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       gen_random_uuid(), 100, 90, 90, false, 'Missed the stop', now()
     ) $$,
  null,
  null,
  'an entry id that does not exist at all is refused'
);

-- ============ input validation ============

select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, 190, 190, false, '   ', now()
     ) $$,
  null,
  'correct_heat_time: a reason is required',
  'a blank reason is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, 190, 190, false, null, now()
     ) $$,
  null,
  'correct_heat_time: a reason is required',
  'a missing reason is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, 190, 190, false, repeat('x', 121), now()
     ) $$,
  null,
  'correct_heat_time: the reason is too long (120 characters at most)',
  'a reason over 120 characters is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, -1, -1, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: a corrected time needs elapsed_secs (0 or more), elapsed_secs_raw and maxed',
  'a negative corrected time is refused'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  200,
  'none of the refused corrections changed the recorded time'
);

-- ============ the happy path: a stopped time in a scoring heat ============

select lives_ok(
  $$ select correct_heat_time(
       '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, 192, 192, false,
       '  Missed the stop  ', '2026-10-06T09:00:00Z'::timestamptz
     ) $$,
  'a stopped time can be corrected while the heat is in scoring'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  192,
  'elapsed_secs is the corrected value'
);
select is(
  (select elapsed_secs_raw from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  192,
  'elapsed_secs_raw follows the corrected value'
);
select is(
  (select time_source from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  'manual',
  'a corrected time is recorded as a manual time, not a tapped one'
);
select is(
  (select time_note from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  'Missed the stop',
  'the trimmed reason is stored on the row'
);
select is(
  (select time_edited_at from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  '2026-10-06T09:00:00Z'::timestamptz,
  'time_edited_at is the client-supplied value'
);
select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  'scoring',
  'the heat stays in scoring'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f2'),
  300,
  'another cupper in the same heat is untouched'
);

-- The change log: the before/after pair, with the reason beside it.
select is(
  (select count(*)::int from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000f1'
      and table_name = 'ct_heat_entries' and action = 'update'
      and (old_value ->> 'elapsed_secs') = '200' and (new_value ->> 'elapsed_secs') = '192'),
  1,
  'the change log holds the original tapped value and the corrected one'
);
select is(
  (select old_value ->> 'time_source' from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000f1'
      and (new_value ->> 'elapsed_secs') = '192'),
  'tapped',
  'the log shows the time used to be a tapped one'
);
select is(
  (select reason from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000f1'
      and (new_value ->> 'elapsed_secs') = '192'),
  'Missed the stop',
  'the reason is in the change log'
);
select is(
  (select changed_by from score_change_log
    where row_id = '00000000-0000-0000-0000-0000000000f1'
      and (new_value ->> 'elapsed_secs') = '192'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'the change log records who made the correction'
);

-- ============ the correction invalidates a stale confirm ============

select ok(
  (select updated_at from ct_heats where id = '00000000-0000-0000-0000-0000000000d1')
    > '2026-01-01T00:00:00Z'::timestamptz,
  'the correction moved the heat''s updated_at'
);
select throws_ok(
  $$ select confirm_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', '2026-01-01T00:00:00Z'::timestamptz, '[]'::jsonb
     ) $$,
  'P0002',
  null,
  'a confirm built from a screen loaded before the correction conflicts instead of restoring the old time'
);

-- ============ compare-and-set ============

select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, 150, 150, false, 'Wrong cupper', now()
     ) $$,
  'P0002',
  null,
  'a correction made against a stale value (the screen still showed 200) is refused'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  192,
  'the refused stale correction left the current time alone'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 192, 192, 192, false, 'Wrong cupper', now()
     ) $$,
  null,
  'correct_heat_time: the corrected time is the same as the recorded time',
  'a correction to the time already recorded is refused'
);
select lives_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 192, 480, 600, true, 'Manual timekeeper''s time', now()
     ) $$,
  'a second correction against the value now shown succeeds'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  480,
  'the second correction took the clamped value'
);
select is(
  (select maxed from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  true,
  'the maxed flag follows the corrected value'
);
select is(
  (select elapsed_secs_raw from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  600,
  'the raw value is kept as supplied'
);

-- ============ idempotency ============

select lives_ok(
  $$ select correct_heat_time(
       '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 480, 100, 100, false, 'Replayed', now()
     ) $$,
  'replaying an operation id that already ran is a safe no-op'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  480,
  'the replay changed nothing'
);

-- ============ which heats can be corrected ============

select lives_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f3', 150, 140, 140, false, 'Missed the stop', now()
     ) $$,
  'a stopped cupper can be corrected while others in the same heat are still timing'
);
select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d2'),
  'timing',
  'the correction does not move a timing heat on'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f4'),
  null,
  'the cupper still running has no time, and the correction did not give them one'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f4', 0, 100, 100, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: heat entry 00000000-0000-0000-0000-0000000000f4 has no recorded time to correct',
  'a cupper who has not stopped has nothing to correct'
);

select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f5', 100, 90, 90, false, 'Missed the stop', now()
     ) $$,
  'P0002',
  'CONFLICT: heat 00000000-0000-0000-0000-0000000000d3 is confirmed, its times can no longer be corrected',
  'a confirmed heat''s times are locked'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f5'),
  100,
  'the refused correction left the confirmed time alone'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f6', 0, 100, 100, false, 'Missed the stop', now()
     ) $$,
  'P0002',
  null,
  'a pending heat is refused'
);

-- ============ the new time is checked against the heat (reject-only) ============

select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 200, 481, 481, true, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: the corrected time cannot exceed the heat duration (480 seconds)',
  'a time longer than the heat is refused, not re-clamped'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 200, 100, 100, true, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: maxed must be true exactly when the time equals the heat duration',
  'maxed on a time short of the duration is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 200, 480, 480, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: maxed must be true exactly when the time equals the heat duration',
  'a time equal to the duration without maxed is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 200, 100, 90, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: elapsed_secs_raw cannot be below elapsed_secs',
  'a raw value below the stored time is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 200, 180, 400, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: elapsed_secs_raw must equal elapsed_secs unless the time is a max',
  'a raw value above the time is refused unless the time is a max - clampElapsed never produces one'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f7'),
  200,
  'none of the out-of-range corrections changed the recorded time'
);
select lives_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 200, 480, 480, true, 'Missed the stop', now()
     ) $$,
  'a time exactly equal to the heat duration, marked maxed, is accepted'
);
select is(
  (select maxed from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f7'),
  true,
  'and it is stored as a max time'
);
select lives_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f8', 200, 0, 0, false, 'Wrong cupper', now()
     ) $$,
  'a 0-second correction is allowed - the lower bound is 0, not 1'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f8'),
  0,
  'and 0 is what is stored'
);

-- ============ input hygiene ============

select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 480, null, 100, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: a corrected time needs elapsed_secs (0 or more), elapsed_secs_raw and maxed',
  'a null corrected time is refused - it must never erase a recorded time'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f7'),
  480,
  'the recorded time survived the null attempt'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 480, 100, null, false, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: a corrected time needs elapsed_secs (0 or more), elapsed_secs_raw and maxed',
  'a null raw value is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 480, 100, 100, null, 'Missed the stop', now()
     ) $$,
  null,
  'correct_heat_time: a corrected time needs elapsed_secs (0 or more), elapsed_secs_raw and maxed',
  'a null maxed flag is refused'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', null, 100, 100, false, 'Missed the stop', now()
     ) $$,
  'P0002',
  null,
  'a null expected time never matches a recorded one - the compare-and-set cannot be skipped'
);
select throws_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 480, 100, 100, false, E' \t\r\n ', now()
     ) $$,
  null,
  'correct_heat_time: a reason is required',
  'a reason of only tabs and line breaks is blank too'
);
select lives_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 480, 470, 470, false, repeat('x', 120), now()
     ) $$,
  'a reason of exactly 120 characters is accepted'
);
select is(
  (select char_length(time_note) from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f7'),
  120,
  'and all 120 characters are stored'
);
select lives_ok(
  $$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f7', 470, 460, 460, false, '   ' || repeat('y', 120) || E'\t ', now()
     ) $$,
  'a 120-character reason padded with spaces and a tab is accepted - the limit is on the trimmed text'
);
select is(
  (select time_note from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f7'),
  repeat('y', 120),
  'and the padding is trimmed off what is stored'
);
select lives_ok(
  $$ select correct_heat_time(
       '00000000-0000-0000-0000-00000000c0f2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f8', 0, 10, 10, false, 'Wrong cupper', null
     ) $$,
  'a missing edit timestamp is accepted'
);
select ok(
  (select time_edited_at is not null from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f8'),
  'and is filled in rather than stored as null'
);
select is(
  (select kind from processed_operations where id = '00000000-0000-0000-0000-00000000c0f2'),
  'correct_heat_time',
  'the ledger records the operation kind'
);
select is(
  (select nullif(current_setting('app.change_reason', true), '')),
  null,
  'the change reason is cleared after the write, so later statements cannot inherit it'
);

-- ============ a corrected row is only changed by another correction ============

select throws_ok(
  $$ select record_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f8', 'scoring', 777, 777, false, 'manual', now(), 'overwrite'
     ) $$,
  'P0002',
  null,
  'a manual re-entry cannot replace a corrected time, even though both are manual'
);
select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f8'),
  10,
  'the correction is still what is recorded'
);

-- ============ what the client reads out of a refusal ============

select is(
  (pg_temp.detail_of($q$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f5', 100, 90, 90, false, 'Missed the stop', now()
     ) $q$)::jsonb) ->> 'current_status',
  'confirmed',
  'a refusal for a confirmed heat carries current_status = confirmed (the client says "locked" from it)'
);
select is(
  (pg_temp.detail_of($q$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, 150, 150, false, 'Wrong cupper', now()
     ) $q$)::jsonb) ->> 'current_elapsed_secs',
  '480',
  'a stale-time refusal carries current_elapsed_secs (the client names the time that is there now)'
);
select is(
  (pg_temp.detail_of($q$ select correct_heat_time(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000f1', 200, 150, 150, false, 'Wrong cupper', now()
     ) $q$)::jsonb) ->> 'expected_elapsed_secs',
  '200',
  '…and expected_elapsed_secs, the value the caller was shown'
);
select ok(
  (select updated_at from ct_heats where id = '00000000-0000-0000-0000-0000000000d2')
    > '2026-01-01T00:00:00Z'::timestamptz,
  'correcting a time in a heat that is still TIMING bumps its updated_at too, not only in scoring'
);
select ok(
  (select array_to_string(proconfig, ',') from pg_proc where proname = 'correct_heat_time') like '%search_path%',
  'the function pins its search_path'
);

-- ============ grants and the untouched other org ============

select ok(
  has_function_privilege('service_role',
    'correct_heat_time(uuid, uuid, uuid, int, int, int, boolean, text, timestamptz)', 'execute'),
  'service_role can execute it, like the sibling timing RPCs'
);

reset role;

select is(
  (select elapsed_secs from ct_heat_entries where id = '00000000-0000-0000-0000-0000000000f9'),
  100,
  'the other org''s entry was never changed by any refused attempt'
);
select is(
  (select count(*)::int from processed_operations where org_id = '00000000-0000-0000-0000-000000000020'),
  0,
  'and no operation was ever recorded against the other org'
);

select * from finish();
rollback;
