-- T3.2 confirm_heat — handoff §9, §14 T3.2 AC.
-- Proves: confirming a heat flushes as one operation (no partial flush leaves
-- entries written without results), a retry after timeout does not duplicate,
-- and a conflicting updated_at surfaces both versions rather than
-- overwriting. Runs under a real `authenticated` role with RLS actually in
-- force throughout (not as the postgres superuser, which is RLS/GRANT-exempt
-- and would silently mask a missing GRANT or a missing org-scoping check —
-- exactly the gap a first version of this file had, caught by security-reviewer).
begin;
select plan(13);

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
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000e9', 'Other Org Cupper');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'prelims', 1, 2, 480),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e9',
   'prelims', 1, 1, 480);
insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 2),
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000b9', 1);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 1, 480),
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000b9', 1, 480);
insert into ct_heat_entries (id, heat_id, entry_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000d9',
   '00000000-0000-0000-0000-0000000000a9');

-- Every call below runs as this real, authenticated org member — RLS and
-- GRANTs are both actually in force, not bypassed by superuser fixtures.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ a wrong-org caller writes nothing (RLS actually blocks it) ============
-- The organiser above is a member of Test Org only. Confirming Other Org's
-- heat must fail — and fail because RLS filters the writes to zero rows
-- (confirm_heat's own `not found` check), not because of anything client-side.

select throws_ok(
  $$ select confirm_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000d9', now(),
       '[{"entry_id":"00000000-0000-0000-0000-0000000000f9","elapsed_secs":200,"elapsed_secs_raw":200,"maxed":false,
          "results":[{"set_id":"00000000-0000-0000-0000-0000000000c9","correct":true}]}]'::jsonb
     ) $$,
  null,
  'confirm_heat: heat 00000000-0000-0000-0000-0000000000d9 not found',
  'a caller who is not a member of the heat''s org sees it as not found —
   RLS on ct_heats itself filters it out before any write is attempted'
);

select is(
  (select count(*)::int from ct_results r
     join ct_heat_entries he on he.id = r.heat_entry_id
     where he.heat_id = '00000000-0000-0000-0000-0000000000d9'),
  0,
  'nothing was written to the other org''s heat'
);

-- ============ ct_results.set_id must belong to the heat's own stage ============
-- f1 belongs to heat d1 (stage b1); c9 belongs to a different stage (b9) —
-- nothing ties set_id to heat_entry_id's actual stage without the
-- check_ct_results_set_stage trigger, the same "two independently-FK'd
-- columns" gap already found and closed for live_sessions (T1.3) and
-- event_entries/person_merges (T3.1).

select throws_ok(
  $$ select confirm_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', now(),
       '[{"entry_id":"00000000-0000-0000-0000-0000000000f1","elapsed_secs":200,"elapsed_secs_raw":200,"maxed":false,
          "results":[{"set_id":"00000000-0000-0000-0000-0000000000c9","correct":true}]}]'::jsonb
     ) $$,
  null,
  'ct_results.set_id must belong to the same stage as heat_entry_id''s heat',
  'a set_id from a different stage than the heat_entry''s own heat is rejected'
);

-- ============ atomicity: an incomplete-scoring failure rolls back EVERYTHING ============
-- entry f1 has both sets scored; entry f2 is missing one — this must fail
-- strict-confirm, and f1's results (which would otherwise have succeeded on
-- their own) must NOT be left behind. A client-side sequence of separate
-- writes could not guarantee this; one transaction can.

select throws_ok(
  format(
    $$ select confirm_heat(
         gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
         '00000000-0000-0000-0000-0000000000d1', %L,
         '[
           {"entry_id":"00000000-0000-0000-0000-0000000000f1","elapsed_secs":240,"elapsed_secs_raw":240,"maxed":false,
            "results":[{"set_id":"00000000-0000-0000-0000-0000000000c1","correct":true},
                       {"set_id":"00000000-0000-0000-0000-0000000000c2","correct":false}]},
           {"entry_id":"00000000-0000-0000-0000-0000000000f2","elapsed_secs":300,"elapsed_secs_raw":300,"maxed":false,
            "results":[{"set_id":"00000000-0000-0000-0000-0000000000c1","correct":true}]}
         ]'::jsonb
       ) $$,
    (select updated_at from ct_heats where id = '00000000-0000-0000-0000-0000000000d1')
  ),
  null,
  'confirm_heat: 1 cupper(s) do not have every set scored',
  'confirm_heat rejects an incompletely-scored heat (strict confirm, §7.4)'
);

select is(
  (select count(*)::int from ct_results where heat_entry_id = '00000000-0000-0000-0000-0000000000f1'),
  0,
  'no partial flush: entry f1''s results (which would have succeeded alone) were
   NOT left behind after the whole confirm failed on entry f2'
);

select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  'pending',
  'the heat status is untouched by the failed confirm attempt'
);

-- ============ a genuine, complete confirm succeeds and writes everything ============
-- This is also the proof that the required GRANTs actually exist — running
-- under `authenticated`, not postgres, means a missing GRANT surfaces here as
-- a real failure, not silently masked by superuser bypass.

select lives_ok(
  format(
    $$ select confirm_heat(
         '00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-000000000010',
         '00000000-0000-0000-0000-0000000000d1', %L,
         '[
           {"entry_id":"00000000-0000-0000-0000-0000000000f1","elapsed_secs":240,"elapsed_secs_raw":240,"maxed":false,
            "results":[{"set_id":"00000000-0000-0000-0000-0000000000c1","correct":true},
                       {"set_id":"00000000-0000-0000-0000-0000000000c2","correct":false}]},
           {"entry_id":"00000000-0000-0000-0000-0000000000f2","elapsed_secs":300,"elapsed_secs_raw":300,"maxed":false,
            "results":[{"set_id":"00000000-0000-0000-0000-0000000000c1","correct":true},
                       {"set_id":"00000000-0000-0000-0000-0000000000c2","correct":true}]}
         ]'::jsonb
       ) $$,
    (select updated_at from ct_heats where id = '00000000-0000-0000-0000-0000000000d1')
  ),
  'a complete confirm_heat call succeeds for a real org member, under real RLS+GRANTs'
);

select is(
  (select status from ct_heats where id = '00000000-0000-0000-0000-0000000000d1'),
  'confirmed',
  'the heat is marked confirmed after a complete, successful confirm'
);

select is(
  (select count(*)::int from ct_results r
     join ct_heat_entries he on he.id = r.heat_entry_id
     where he.heat_id = '00000000-0000-0000-0000-0000000000d1'),
  4,
  'all four results (2 cuppers x 2 sets) were written in the one operation'
);

-- ============ retry after timeout does not duplicate ============
-- Same operation id, replayed (simulating a client that never saw the ack).
-- This must be a safe no-op, not a second write and not an error.

select lives_ok(
  $$ select confirm_heat(
       '00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', now(),
       '[]'::jsonb
     ) $$,
  'replaying the same operation id is a safe no-op, not an error'
);

select is(
  (select count(*)::int from ct_results r
     join ct_heat_entries he on he.id = r.heat_entry_id
     where he.heat_id = '00000000-0000-0000-0000-0000000000d1'),
  4,
  'the retry did not duplicate any results row (still exactly 4)'
);

-- ============ conflicting updated_at surfaces both versions, never silently overwrites ============

insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 2, 480);
insert into ct_heat_entries (id, heat_id, entry_id) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d2',
   '00000000-0000-0000-0000-0000000000a1');

-- The "stale" expected_updated_at simulates a client that read this heat
-- before some other write landed. A real second write can't be used to
-- produce this inside a pgTAP test file: the whole file runs in ONE
-- transaction, and Postgres's `now()` (what app.set_updated_at() uses) is
-- transaction-STABLE — every call within one transaction returns the same
-- value, so no in-transaction UPDATE could ever actually change updated_at
-- here. Passing a deliberately wrong timestamp directly tests the same
-- comparison confirm_heat actually performs, without relying on that.
select throws_ok(
  $$ select confirm_heat(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d2', '2020-01-01T00:00:00Z'::timestamptz, '[]'::jsonb
     ) $$,
  'P0002',
  null,
  'a stale expected_updated_at is rejected rather than silently overwritten'
);

-- pgTAP assertions must be top-level SELECTs to emit their TAP line — a DO
-- block can't call them directly (PERFORM discards the return value instead
-- of emitting it), so the exception's DETAIL is captured into a temp table
-- first, then asserted on afterward.
create temporary table conflict_capture (detail text);

do $$
declare
  v_detail text;
begin
  begin
    perform confirm_heat(
      gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
      '00000000-0000-0000-0000-0000000000d2', '2020-01-01T00:00:00Z'::timestamptz, '[]'::jsonb
    );
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
  end;
  insert into conflict_capture (detail) values (v_detail);
end;
$$;

select ok(
  (select detail::jsonb ? 'current_updated_at' from conflict_capture)
    and (select detail::jsonb ? 'expected_updated_at' from conflict_capture),
  'the conflict exception carries BOTH the current server version and the
   client''s stale expected version — enough to show both, not just "failed"'
);

reset role;

select * from finish();
rollback;
