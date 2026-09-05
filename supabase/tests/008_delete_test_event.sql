-- delete_test_event — user-requested "Delete event" feature (2026-09-05).
-- Proves: a wrong-org caller is rejected with the same indistinguishable
-- "not found" message a nonexistent event gets (mirrors 006_publish_session
-- .sql's own precedent), a non-member is rejected by RLS even when the
-- function's own org check is satisfied, a REAL (is_test=false) event is
-- refused with its own distinct error regardless of who's asking, and a
-- genuine test event is removed completely — including everything cascading
-- off it (proving this RPC's own DELETE actually fires, not just that the
-- schema's FKs are configured correctly in isolation). Runs under a real
-- `authenticated` role with RLS actually in force, matching
-- 005_confirm_heat.sql/006_publish_session.sql's own precedent.
begin;
select plan(12);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- the caller below is NOT a member of Other Org

insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Deletable Test Event', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Real Event', false),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000020',
   'cup_taster', 'Other Org Event', true);

-- A stage hanging off the deletable event — proves the RPC's own DELETE
-- statement genuinely cascades everything away, not merely that on delete
-- cascade is declared somewhere in the schema.
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs, cutoff) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   'prelims', 1, 8, 480, null);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ a wrong-org caller is rejected, indistinguishably from "not found" ============

select throws_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e9'
     ) $$,
  null,
  'delete_test_event: event 00000000-0000-0000-0000-0000000000e9 not found',
  'a caller cannot delete an event that belongs to a different org'
);

-- Checked as postgres, not the restricted authenticated session above —
-- events_read's own RLS already hides org 020's row from an org-010-only
-- member regardless of whether it was deleted, so checking "still exists"
-- under the SAME restricted role the throws_ok call just used would read 0
-- either way and prove nothing.
reset role;
select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e9'),
  1,
  'the wrong-org event was not deleted'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ a nonexistent event gets the identical message ============

select throws_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000fff'
     ) $$,
  null,
  'delete_test_event: event 00000000-0000-0000-0000-000000000fff not found',
  'a nonexistent event is rejected with the same message as a wrong-org one — no information leak either way'
);

-- ============ a non-member is rejected by RLS even with the event's own correct org id ============
-- Unlike the wrong-org case above (caught by this function's own check),
-- this passes org 020 as BOTH the true owning org of event e9 AND p_org_id —
-- so the function's own ownership check passes. Unlike publish_session's
-- own equivalent test (an INSERT whose WITH CHECK failure genuinely THROWS
-- 42501), a DELETE whose rows are hidden by RLS's own USING clause just
-- matches zero rows and returns normally — the row surviving is the actual
-- proof RLS backstopped this, not a thrown error.

select lives_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e9'
     ) $$,
  'the call itself does not error — RLS silently matches zero rows on DELETE, unlike INSERT'
);

-- Checked as postgres — same reasoning as above (a non-member's own session
-- can't see org 020's row regardless of whether it survives).
reset role;
select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e9'),
  1,
  'the event was NOT actually deleted — a non-member''s DELETE matched zero rows under RLS'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ a real (non-test) event is refused, even in the caller's own org ============

select throws_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2'
     ) $$,
  'P0001',
  'delete_test_event: refusing to delete a non-test event (00000000-0000-0000-0000-0000000000e2)',
  'a real event is refused with its own distinct error, never silently treated like the not-found case'
);

select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e2'),
  1,
  'the real event was not deleted'
);

-- ============ a genuine test event deletion succeeds and cascades completely ============

select lives_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  'a real org member can delete their own test event'
);

select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'the event itself is gone'
);

select is(
  (select count(*)::int from ct_stages where event_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'its stage cascaded away too — the RPC''s own DELETE actually fired, not a no-op'
);

-- ============ deleting an already-gone event is rejected the same way any nonexistent one is ============
-- Not routed through the outbox (see the migration's own comment on why) —
-- no idempotent-replay contract to honor, so a second call for the event
-- this same test just deleted is just an ordinary "not found."

select throws_ok(
  $$ select delete_test_event(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  null,
  'delete_test_event: event 00000000-0000-0000-0000-0000000000e1 not found',
  'deleting an already-deleted event is rejected the same way any nonexistent one is'
);

-- ============ untouched events remain untouched throughout ============
-- Checked as postgres — the authenticated caller's own RLS-scoped view
-- would never show org 020's surviving row regardless of the real count.

reset role;

select is(
  (select count(*)::int from events),
  2,
  'exactly the two surviving events remain — the wrong-org one and the real one, nothing else was ever removed'
);

select * from finish();
rollback;
